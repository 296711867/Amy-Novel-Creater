import { describe, expect, it, vi } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyConnectionPragmas,
  createGuardedClient,
  probeWriteLock,
} from "../../src/main/db/client-guard";
import { NovelDatabase } from "../../src/main/db/database";

const NEVER = new Promise<never>(() => {});

function isWriteStatement(sql: string): boolean {
  return /\b(insert|update|delete|create|alter|drop|begin)\b/i.test(sql);
}

/**
 * 可遥控的"卡死"客户端：armHang() 后所有写语句永久挂起（复现 AN-036
 * 线上形态：读正常、写挂起），读语句继续透传内层真实客户端。
 */
function flappyClient(inner: Client): {
  wrapper: Client;
  armHang: () => void;
} {
  let hung = false;
  return {
    armHang: () => {
      hung = true;
    },
    wrapper: {
      execute: (stmt: Parameters<Client["execute"]>[0]) => {
        const sql = typeof stmt === "string" ? stmt : String(stmt?.sql ?? "");
        return hung && isWriteStatement(sql)
          ? NEVER
          : inner.execute(stmt);
      },
      executeMultiple: (sql: string) =>
        hung && isWriteStatement(sql) ? NEVER : inner.executeMultiple(sql),
      batch: (
        stmts: Parameters<Client["batch"]>[0],
        mode?: Parameters<Client["batch"]>[1],
      ) =>
        hung && (mode === "write" || isWriteStatement(String(stmts[0])))
          ? NEVER
          : inner.batch(stmts, mode),
      // 测试中多个包装器共享同一内层连接；swapClient 会关闭旧包装器，
      // 不能连带关掉内层（生产环境的 factory 每次创建全新连接）。
      close: () => {},
    } as unknown as Client,
  };
}

describe("AN-036 数据库写锁防线", () => {
  it("连接 PRAGMA：WAL + busy_timeout=5000 + synchronous=NORMAL", async () => {
    const client = createClient({
      url: `file:${join(tmpdir(), `an036-pragma-${Date.now()}.db`)}`,
    });
    await applyConnectionPragmas(client);
    const journal = String(
      (await client.execute("PRAGMA journal_mode")).rows[0]?.journal_mode,
    ).toLowerCase();
    const busyTimeout = Number(
      (await client.execute("PRAGMA busy_timeout")).rows[0]?.timeout,
    );
    const synchronous = Number(
      (await client.execute("PRAGMA synchronous")).rows[0]?.synchronous,
    );
    client.close();
    expect(journal).toBe("wal");
    expect(busyTimeout).toBe(5000);
    expect(synchronous).toBe(1); // NORMAL
  });

  it("守卫客户端：挂起操作在超时后抛可读错误并触发 onStall", async () => {
    const onStall = vi.fn();
    const hung = {
      execute: () => NEVER,
      executeMultiple: () => NEVER,
      batch: () => NEVER,
      close: () => {},
    } as unknown as Client;
    const guarded = createGuardedClient(hung, { timeoutMs: 40, onStall });
    await expect(guarded.execute("INSERT INTO t VALUES (1)")).rejects.toThrow(
      /数据库操作超时.*写入锁挂起/,
    );
    await expect(
      guarded.batch([{ sql: "UPDATE t SET x=1" }], "write"),
    ).rejects.toThrow(/超时/);
    expect(onStall).toHaveBeenCalled();
  });

  it("守卫客户端：正常操作透传结果", async () => {
    const fine = createClient({ url: "file::memory:" });
    await fine.execute("CREATE TABLE t (id INTEGER)");
    const guarded = createGuardedClient(fine, { timeoutMs: 1000 });
    await guarded.execute("INSERT INTO t VALUES (1)");
    const rows = await guarded.execute("SELECT COUNT(*) AS n FROM t");
    expect(Number(rows.rows[0]?.n)).toBe(1);
    fine.close();
  });

  it("写锁探测：健康连接 true，挂起连接 false", async () => {
    const healthy = createClient({ url: "file::memory:" });
    expect(await probeWriteLock(healthy, 1000)).toBe(true);
    healthy.close();
    const hung = {
      execute: () => NEVER,
      executeMultiple: () => NEVER,
      batch: () => NEVER,
      close: () => {},
    } as unknown as Client;
    expect(await probeWriteLock(hung, 50)).toBe(false);
  });

  it(
    "端到端：写入挂起 → IPC 层快速失败 → 自动重开连接 → 数据继续可写",
    async () => {
      // 所有包装器共享同一个内层库：重开连接后数据仍在。
      const inner = createClient({ url: "file::memory:" });
      let current: ReturnType<typeof flappyClient> | null = null;
      const factory = () => {
        current = flappyClient(inner);
        return current.wrapper;
      };
      const recoveries: Array<{ reconnected: boolean; message: string }> = [];
      const db = await NovelDatabase.open(":memory:", {
        clientFactory: factory,
        timeoutMs: 80,
        onRecovery: (reconnected, message) =>
          recoveries.push({ reconnected, message }),
      });

      const created = await db.createNovel({
        title: "写锁测试",
        genre: "科幻",
        premise: "AN-036",
        targetChapters: 2,
        chapterWords: 1000,
      });
      const novel = created.novel;
      expect(novel).toBeTruthy();

      // 模拟线上形态：读正常、写全部挂起。
      current!.armHang();
      await expect(
        db.saveBibleSection({
          novelId: novel.id,
          kind: "intent",
          content: "第一次",
        }),
      ).rejects.toThrow(/数据库操作超时/);

      // 恢复循环异步进行：等待重开完成（探测 3s 超时 + 重建）。
      const deadline = Date.now() + 10_000;
      while (recoveries.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      expect(recoveries.at(-1)?.reconnected).toBe(true);
      expect(db.stallRecoveryCount).toBeGreaterThan(0);
      expect(await db.checkWritable()).toBe(true);

      // 新连接写入成功，且旧数据可读。
      await db.saveBibleSection({
        novelId: novel.id,
        kind: "intent",
        content: "重开连接后的写入",
      });
      const sections = await db.listBibleSections(novel.id);
      expect(
        sections.some((s) => s.content === "重开连接后的写入"),
      ).toBe(true);
      db.close();
      inner.close();
    },
    30_000,
  );
});
