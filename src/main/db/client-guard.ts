import type { Client } from "@libsql/client";

/**
 * AN-036 主进程 SQLite 写锁挂起防线。
 *
 * 两次线上形态：读全部正常、所有写入 IPC 永久挂起（≥30 分钟不返回、
 * 不报错）。busy_timeout 只能处理 SQLITE_BUSY 快速失败，治不了 Promise
 * 级挂起，因此这里在 Client 外包两层：
 *
 * 1. 连接卫生：WAL + busy_timeout + synchronous NORMAL，排除 journal
 *    竞态并让锁冲突快速失败而不是排队；
 * 2. 操作超时：execute/batch 挂起超过阈值时抛出可读错误（而不是永久
 *    等待），调用方（IPC→渲染层巡航）立即看到失败并暂停，配合已验证
 *    的"重启零损失断点续跑"预案；同时回调 onStall 触发自动重开连接。
 */

export const DB_WRITE_TIMEOUT_MS = 20_000;

/** 探测写锁是否可用：BEGIN IMMEDIATE 要求立刻拿到 RESERVED 锁。 */
export async function probeWriteLock(client: Client, timeoutMs: number): Promise<boolean> {
  try {
    await withTimeout(
      client.execute("BEGIN IMMEDIATE"),
      timeoutMs,
      "probe BEGIN IMMEDIATE",
    );
    await client.execute("COMMIT");
    return true;
  } catch {
    return false;
  }
}

export async function applyConnectionPragmas(client: Client): Promise<void> {
  // WAL 对 :memory: 数据库无效（返回 memory），对文件库是持久属性，重复设置无害。
  await client.execute("PRAGMA journal_mode=WAL");
  await client.execute("PRAGMA busy_timeout=5000");
  await client.execute("PRAGMA synchronous=NORMAL");
  await client.execute("PRAGMA foreign_keys=ON");
}

export function dbStallError(label: string, timeoutMs: number): Error {
  return new Error(
    `数据库操作超时（${label}，>${timeoutMs}ms）：疑似写入锁挂起，` +
      "系统将自动重连数据库；若稍后仍失败，请重启应用（巡航支持断点续跑，已写入的数据不会丢失）",
  );
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(dbStallError(label, timeoutMs));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function sqlLabel(sql: unknown): string {
  const text = typeof sql === "string" ? sql : String((sql as { sql?: string })?.sql ?? "");
  return text.replace(/\s+/g, " ").slice(0, 60) || "unknown statement";
}

export type GuardedClientOptions = {
  timeoutMs?: number;
  /** 任一操作超时（疑似锁挂起）时回调；用于触发连接重建。 */
  onStall?: () => void;
};

/**
 * 返回行为等同 Client 的守卫代理：所有语句/批操作带超时。
 * 只包装仓库层实际用到的方法，transaction 透传原实现（当前未使用）。
 */
export function createGuardedClient(
  raw: Client,
  options: GuardedClientOptions = {},
): Client {
  const timeoutMs = options.timeoutMs ?? DB_WRITE_TIMEOUT_MS;
  const guard = <T>(promise: Promise<T>, label: string): Promise<T> =>
    withTimeout(promise, timeoutMs, label, options.onStall);
  const client: Client = {
    execute: (stmt: Parameters<Client["execute"]>[0]) =>
      guard(
        raw.execute(stmt),
        typeof stmt === "string" ? stmt : `execute ${sqlLabel(stmt)}`,
      ),
    executeMultiple: (sql: Parameters<Client["executeMultiple"]>[0]) =>
      guard(raw.executeMultiple(sql), `executeMultiple ${sqlLabel(sql)}`),
    batch: (stmts: Parameters<Client["batch"]>[0], mode?: Parameters<Client["batch"]>[1]) =>
      guard(
        raw.batch(stmts, mode),
        `batch(${Array.isArray(stmts) ? stmts.length : 1} stmts, ${mode ?? "deferred"})`,
      ),
    transaction: ((...args: unknown[]) =>
      // 透传 libsql 原生事务 API（当前仓库层未使用，仅保接口完整）
      (raw as unknown as Client).transaction(...(args as []))) as Client["transaction"],
    close: () => raw.close(),
  };
  return client as unknown as Client;
}
