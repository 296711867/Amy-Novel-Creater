/**
 * AN-012 安全策略测试：IPC 写通道守卫、导航策略与 CSP。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  arr,
  id,
  IpcValidationError,
  num,
  obj,
  oneOf,
  optional,
  str,
  validateIpcArgs,
} from "../../src/main/ipc/ipc-guard";
import { IPC_WRITE_GUARDS } from "../../src/main/ipc/ipc-write-guards";
import { IPC_CHANNELS } from "@shared/ipc-contract";
import {
  appNavigationBase,
  isAllowedNavigation,
  windowOpenDecision,
} from "../../src/main/window-security";

const allChannels = Object.values(IPC_CHANNELS) as string[];

describe("IPC 写通道守卫", () => {
  it("守卫表键全部是真实通道，写通道全部有守卫", () => {
    for (const channel of Object.keys(IPC_WRITE_GUARDS))
      expect(allChannels).toContain(channel);
    for (const channel of [
      IPC_CHANNELS.createNovel,
      IPC_CHANNELS.saveChapter,
      IPC_CHANNELS.deleteNovel,
      IPC_CHANNELS.generateNovelPlan,
      IPC_CHANNELS.createWorkflowRun,
      IPC_CHANNELS.updateWorkflowRun,
      IPC_CHANNELS.saveModelProfile,
      IPC_CHANNELS.acceptChapterCandidate,
      IPC_CHANNELS.createGenerationDraft,
      IPC_CHANNELS.startBackgroundBatch,
      IPC_CHANNELS.generateChapter,
    ])
      expect(IPC_WRITE_GUARDS[channel]).toBeDefined();
  });

  it("类型攻击与垃圾输入在进入 handler 前被拒绝", () => {
    const expectRejected = (channel: string, args: unknown[]) => {
      expect(() =>
        validateIpcArgs(channel, IPC_WRITE_GUARDS[channel], args),
      ).toThrow(IpcValidationError);
    };
    // 原型污染/脚本注入载荷不能绕过形状检查。
    expectRejected(IPC_CHANNELS.saveChapter, [
      { chapterId: { "__proto__": "x" }, title: "a", outline: "b", content: "c" },
    ]);
    expectRejected(IPC_CHANNELS.saveChapter, ["not-an-object"]);
    expectRejected(IPC_CHANNELS.deleteNovel, [""]);
    expectRejected(IPC_CHANNELS.deleteNovel, [1234]);
    expectRejected(IPC_CHANNELS.generateNovelPlan, ["n1", "structure;drop"]);
    expectRejected(IPC_CHANNELS.updateWorkflowRun, [
      { id: "r1", status: "hacked" },
    ]);
    expectRejected(IPC_CHANNELS.createNovel, [
      { title: "t", genre: "g", premise: "p", targetChapters: 3.5, chapterWords: 1000 },
    ]);
    expectRejected(IPC_CHANNELS.createGenerationDraft, [
      "n1",
      {
        startChapter: 0,
        endChapter: 5,
        chapterWords: 1000,
        continuityCheck: true,
        maxRetries: 2,
        approvalMode: "candidate",
        outputTokenBudget: 6000,
      },
    ]);
  });

  it("合法参数原样放行，saveModelProfile 不检查密钥值", () => {
    expect(() =>
      validateIpcArgs(IPC_CHANNELS.saveChapter, IPC_WRITE_GUARDS[IPC_CHANNELS.saveChapter], [
        { chapterId: "c1", title: "", outline: "", content: "" },
      ]),
    ).not.toThrow();
    expect(() =>
      validateIpcArgs(
        IPC_CHANNELS.saveModelProfile,
        IPC_WRITE_GUARDS[IPC_CHANNELS.saveModelProfile],
        [
          {
            name: "智谱",
            provider: "glm",
            modelId: "GLM-5.2",
            baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
            apiKey: "secret-value-never-logged",
          },
        ],
      ),
    ).not.toThrow();
    // 可选参数缺省时放行。
    expect(() =>
      validateIpcArgs(
        IPC_CHANNELS.generateNovelPlan,
        IPC_WRITE_GUARDS[IPC_CHANNELS.generateNovelPlan],
        ["n1", "structure"],
      ),
    ).not.toThrow();
  });

  it("守卫组合子的边界行为", () => {
    const checks: Array<[boolean, unknown]> = [
      [id()("x", "p") === true, " ok "],
      [id()("", "p") !== true, ""],
      [num({ int: true })(1.5, "p") !== true, 1.5],
      [num({ min: 1 })(0, "p") !== true, 0],
      [arr(id())(["a", "b"], "p") === true, ["a", "b"]],
      [arr(id())(["a", 2], "p") !== true, ["a", 2]],
      [oneOf(["a", "b"] as const)("c", "p") !== true, "c"],
      [optional(num())(undefined, "p") === true, undefined],
      [obj({ a: id() })({ a: "x", extra: 1 }, "p") === true, { a: "x" }],
      [obj({ a: id() })({ b: "x" }, "p") !== true, { b: "x" }],
      [str()(0, "p") !== true, 0],
    ];
    for (const [passed] of checks) expect(passed).toBe(true);
    expect(() => str()(Symbol("x") as unknown as string, "p")).not.toThrow();
  });
});

describe("窗口导航安全策略", () => {
  const devBase = appNavigationBase({
    isDev: true,
    devServerUrl: "http://localhost:5173",
  });
  const fileBase = appNavigationBase({
    isDev: false,
    rendererDirFileUrl: "file:///C:/app/out/renderer/",
  });

  it("开发与生产各自得到带分隔符的应用前缀", () => {
    expect(devBase).toBe("http://localhost:5173/");
    expect(fileBase).toBe("file:///C:/app/out/renderer/");
    expect(
      appNavigationBase({ isDev: true, rendererDirFileUrl: "file:///x/" }),
    ).toBeNull();
  });

  it("只允许应用自身页面导航", () => {
    expect(isAllowedNavigation("http://localhost:5173/", devBase)).toBe(true);
    expect(isAllowedNavigation("http://localhost:5173/#/novels", devBase)).toBe(true);
    expect(isAllowedNavigation("http://evil.example/", devBase)).toBe(false);
    expect(isAllowedNavigation("http://localhost:5174/", devBase)).toBe(false);
    expect(isAllowedNavigation("file:///C:/app/out/renderer/index.html", fileBase)).toBe(true);
    // 同前缀目录逃逸被分隔符挡住。
    expect(isAllowedNavigation("file:///C:/app/out/renderer-evil/x.html", fileBase)).toBe(false);
    expect(isAllowedNavigation("file:///C:/Windows/system32/", fileBase)).toBe(false);
    expect(isAllowedNavigation("about:blank", fileBase)).toBe(false);
    expect(isAllowedNavigation("http://localhost:5173/", null)).toBe(false);
  });

  it("新窗口一律拒绝，外链转系统浏览器", () => {
    expect(
      windowOpenDecision("https://github.com/amy", devBase),
    ).toEqual({ action: "deny", openExternally: true });
    expect(
      windowOpenDecision("http://localhost:5173/#/x", devBase),
    ).toEqual({ action: "deny" });
    expect(windowOpenDecision("javascript:alert(1)", devBase)).toEqual({
      action: "deny",
    });
    expect(windowOpenDecision("file:///C:/Windows/", fileBase)).toEqual({
      action: "deny",
    });
  });
});

describe("CSP", () => {
  const readCsp = (file: string) =>
    readFileSync(join(process.cwd(), file), "utf8").match(
      /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
    )?.[1];

  it("双端入口都配置 CSP，脚本源只允许自身", () => {
    for (const file of ["index.html", "src/renderer/index.html"]) {
      const csp = readCsp(file);
      expect(csp, file).toBeDefined();
      expect(csp).toContain("script-src 'self'");
      expect(csp).not.toContain("unsafe-eval");
      expect(csp!.match(/script-src[^;]*/)?.[0]).not.toContain("unsafe-inline");
      expect(csp).toContain("default-src 'self'");
    }
  });

  it("Web 入口放开模型端点与本机服务；Electron 入口不放开任何网络", () => {
    const webConnect = readCsp("index.html")!.match(/connect-src[^;]*/)?.[0] ?? "";
    expect(webConnect).toContain("https:");
    expect(webConnect).toContain("http://localhost:*");
    expect(webConnect).toContain("http://127.0.0.1:*");

    const electronConnect =
      readCsp("src/renderer/index.html")!.match(/connect-src[^;]*/)?.[0] ?? "";
    expect(electronConnect).not.toContain("https:");
    expect(electronConnect).toContain("ws://localhost:*");
  });
});
