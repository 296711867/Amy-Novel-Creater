// @vitest-environment jsdom
/**
 * AN-026/AN-028：自动审阅（自动接受候选稿与正史建议并连续创作）回归。
 *
 * 覆盖作者委托审阅的完整循环与安全边界：
 * 1. 候选稿未接受前不碰正史建议（顺序与人工一致，走同一门禁）；
 * 2. 接受候选稿 → 全部正史建议以 ai_candidate 来源写入 → 批次自动继续下一章；
 * 3. 本批次全部完成后自动关闭并提示；
 * 4. 连续失败达到上限自动停止，避免无人值守时反复烧 token；
 * 5. AN-028：新角色建议自动建档、单条失败不阻断、批次状态可见（横幅）、
 *    开关持久化断点续跑、同一作品同时只有一个未完结批次。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => {
  const now = "2026-08-31T00:00:00.000Z";
  const novel = {
    id: "n1",
    title: "自动审阅测试",
    genre: "悬疑",
    premise: "p",
    targetWords: 6000,
    targetChapters: 2,
    chapterWords: 3000,
    cycleSize: 10,
    status: "writing" as const,
    createdAt: now,
    updatedAt: now,
  };
  const chapters = [
    {
      id: "c1",
      novelId: "n1",
      position: 1,
      volumeId: null,
      title: "第一章",
      outline: "o",
      status: "candidate",
      targetWords: 3000,
      content: "旧正文",
      wordCount: 3,
      updatedAt: now,
    },
    {
      id: "c2",
      novelId: "n1",
      position: 2,
      volumeId: null,
      title: "第二章",
      outline: "o",
      status: "outline",
      targetWords: 3000,
      content: "",
      wordCount: 0,
      updatedAt: now,
    },
  ];
  const candidates = [
    {
      id: "cd1",
      novelId: "n1",
      chapterId: "c1",
      profileId: "p1",
      contextHash: "h",
      content: "雾灯在暴雨里亮着。",
      wordCount: 9,
      status: "candidate",
      inputTokens: 100,
      outputTokens: 20,
      cachedTokens: 0,
      createdAt: now,
      updatedAt: now,
    },
  ];
  const proposals = [
    {
      id: "fp1",
      candidateId: "cd1",
      chapterId: "c1",
      kind: "foreshadow" as const,
      title: "灯油来自记忆",
      payload: { detail: "灯油原料是守灯人的回忆", status: "developing" },
      status: "proposed",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "fp2",
      candidateId: "cd1",
      chapterId: "c1",
      kind: "timeline" as const,
      title: "夜航开始",
      payload: {
        storyTime: "第一夜",
        detail: "船离开雾灯港",
        participants: ["沈灯"],
      },
      status: "proposed",
      createdAt: now,
      updatedAt: now,
    },
  ];
  return {
    now,
    novel,
    chapters,
    candidates,
    proposals: proposals as Array<{
      id: string;
      candidateId: string;
      chapterId: string;
      kind: string;
      title: string;
      payload: Record<string, unknown>;
      status: string;
      createdAt: string;
      updatedAt: string;
    }>,
    /** AN-028：圣经外新角色的状态建议（自动建档路径）。 */
    newCharacterProposal: {
      id: "fp3",
      candidateId: "cd1",
      chapterId: "c1",
      kind: "character_state" as const,
      title: "阿雾获救",
      payload: {
        characterName: "阿雾",
        summary: "被沈灯从沉船里救下的少年",
        location: "雾灯港",
        appearance: "湿透的粗布衣",
        outfit: "",
        identity: "渔家孤儿",
        physical: "呛水后虚弱",
        emotional: "惊魂未定",
        knowledge: [],
        goals: ["报恩"],
        inventory: ["半块船牌"],
        skills: [],
      },
      status: "proposed",
      createdAt: now,
      updatedAt: now,
    },
    /** AN-028：无法解析的坏建议（单条失败不阻断整批）。 */
    brokenProposal: {
      id: "fp4",
      candidateId: "cd1",
      chapterId: "c1",
      kind: "character_state" as const,
      title: "残缺记录",
      payload: { summary: "缺 characterName" },
      status: "proposed",
      createdAt: now,
      updatedAt: now,
    },
    findings: [] as Array<{
      id: string;
      candidateId: string;
      chapterId: string;
      severity: "error" | "warning" | "info";
      status: "open" | "resolved" | "dismissed";
      message: string;
      evidence: string;
      createdAt: string;
      updatedAt: string;
    }>,
    batches: [
      {
        id: "b1",
        novelId: "n1",
        status: "paused",
        policy: {
          startChapter: 1,
          endChapter: 2,
          chapterWords: 3000,
          continuityCheck: true,
          maxRetries: 2,
          approvalMode: "candidate" as const,
          outputTokenBudget: 6000,
        },
        outputTokensUsed: 100,
        awaitingReview: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    jobs: [
      {
        id: "j1",
        batchId: "b1",
        chapterId: "c1",
        position: 1,
        status: "candidate_ready",
        attempt: 1,
        candidateId: "cd1",
        inputTokens: 100,
        outputTokens: 20,
        error: "",
        updatedAt: now,
      },
      {
        id: "j2",
        batchId: "b1",
        chapterId: "c2",
        position: 2,
        status: "queued",
        attempt: 0,
        candidateId: null,
        inputTokens: 0,
        outputTokens: 0,
        error: "",
        updatedAt: now,
      },
    ],
    calls: {
      startBackgroundBatch: [] as string[],
      saveForeshadowThread: [] as unknown[],
      saveTimelineEvent: [] as unknown[],
      saveStoryEntity: [] as unknown[],
      saveCharacterState: [] as unknown[],
      acceptChapterCandidate: [] as string[],
      acceptAttempts: [] as string[],
      appendGenerationEvent: [] as string[],
    },
    /** 人物状态（listCharacterStates 数据源）；全局校验用。 */
    states: [] as Array<Record<string, unknown>>,
    failAccept: false,
  };
});

vi.mock("@renderer/platform/web-platform", () => ({
  platform: {
    host: "electron",
    ready: () => Promise.resolve(),
    listNovels: () => Promise.resolve([backend.novel]),
    listChapters: () => Promise.resolve(backend.chapters),
    getChapter: (id: string) =>
      Promise.resolve(backend.chapters.find((item) => item.id === id)),
    listChapterCandidates: (chapterId: string) =>
      Promise.resolve(
        backend.candidates.filter((item) => item.chapterId === chapterId),
      ),
    acceptChapterCandidate: (id: string) => {
      backend.calls.acceptAttempts.push(id);
      if (backend.failAccept)
        return Promise.reject(new Error("模型网关异常"));
      backend.calls.acceptChapterCandidate.push(id);
      const item = backend.candidates.find((value) => value.id === id)!;
      item.status = "accepted";
      backend.chapters
        .filter((chapter) => chapter.id === item.chapterId)
        .forEach((chapter) => {
          chapter.status = "accepted";
          chapter.content = item.content;
          chapter.wordCount = item.wordCount;
        });
      return Promise.resolve({ ...item });
    },
    rejectChapterCandidate: (id: string) => {
      const item = backend.candidates.find((value) => value.id === id)!;
      item.status = "rejected";
      return Promise.resolve({ ...item });
    },
    listFindings: () =>
      Promise.resolve(
        backend.findings.map((item) => ({ ...item })),
      ),
    listFactProposals: (candidateId: string) =>
      Promise.resolve(
        backend.proposals.filter((item) => item.candidateId === candidateId),
      ),
    updateFactProposal: (id: string, status: string) => {
      const item = backend.proposals.find((value) => value.id === id)!;
      item.status = status;
      // 镜像 AN-003：候选审阅完成且建议全部处理 → candidate_ready 任务收敛 completed。
      const candidate = backend.candidates.find(
        (value) => value.id === item.candidateId,
      );
      if (
        candidate &&
        candidate.status === "accepted" &&
        backend.proposals
          .filter((value) => value.candidateId === candidate.id)
          .every((value) => value.status !== "proposed")
      ) {
        const job = backend.jobs.find((value) => value.candidateId === candidate.id);
        if (job && job.status === "candidate_ready") job.status = "completed";
      }
      return Promise.resolve({ ...item });
    },
    saveForeshadowThread: (input: unknown) => {
      backend.calls.saveForeshadowThread.push(input);
      return Promise.resolve(input);
    },
    saveCharacterState: (input: unknown) => {
      backend.calls.saveCharacterState.push(input);
      return Promise.resolve(input);
    },
    saveStoryEntity: (input: {
      novelId: string;
      type: string;
      name: string;
    }) => {
      backend.calls.saveStoryEntity.push(input);
      return Promise.resolve({
        id: "e-auto",
        novelId: input.novelId,
        type: input.type,
        name: input.name,
        summary: "",
        aliases: [],
        profile: {},
        status: "active",
        createdAt: backend.now,
        updatedAt: backend.now,
      });
    },
    createGenerationDraft: (novelId: string) =>
      Promise.resolve({
        id: "b2",
        estimate: { estimatedContextTokens: 0, estimatedOutputTokens: 0 },
        novelId,
      }),
    saveTimelineEvent: (input: unknown) => {
      backend.calls.saveTimelineEvent.push(input);
      return Promise.resolve(input);
    },
    listStoryEntities: () =>
      Promise.resolve([
        {
          id: "e1",
          novelId: "n1",
          type: "character",
          name: "沈灯",
          summary: "守灯少年",
          aliases: [] as string[],
          profile: { tier: "protagonist" },
          status: "active",
          createdAt: backend.now,
          updatedAt: backend.now,
        },
      ]),
    listTimelineEvents: () => Promise.resolve([]),
    listCharacterStates: () =>
      Promise.resolve(backend.states.map((item) => ({ ...item }))),
    listForeshadowThreads: () => Promise.resolve([]),
    listGenerationBatches: () =>
      Promise.resolve(backend.batches.map((item) => ({ ...item }))),
    listGenerationJobs: (batchId: string) =>
      Promise.resolve(
        backend.jobs
          .filter((item) => item.batchId === batchId)
          .map((item) => ({ ...item })),
      ),
    // 镜像真实恢复语义：主进程重新接管批次，状态回到 running 并清除等待审核标记。
    startBackgroundBatch: (batchId: string) => {
      backend.calls.startBackgroundBatch.push(batchId);
      const batch = backend.batches.find((item) => item.id === batchId);
      if (batch) {
        batch.status = "running";
        batch.awaitingReview = false;
      }
      return Promise.resolve();
    },
    appendGenerationEvent: (input: { message: string }) => {
      backend.calls.appendGenerationEvent.push(input.message);
      return Promise.resolve({
        ...input,
        id: `e${backend.calls.appendGenerationEvent.length}`,
        createdAt: new Date().toISOString(),
      });
    },
  },
}));

import { useNovelStore } from "@renderer/store/novel-store";

const store = useNovelStore;

function enableAuto() {
  store.setState({
    autoReview: { n1: { enabled: true, message: "" } },
  });
}

describe("自动审阅（AN-026）", () => {
  beforeEach(() => {
    backend.candidates[0].status = "candidate";
    backend.chapters[0].status = "candidate";
    backend.chapters[0].content = "旧正文";
    backend.chapters[1].status = "outline";
    backend.proposals.length = 2;
    backend.proposals.forEach((item) => {
      item.status = "proposed";
    });
    backend.batches[0].status = "paused";
    backend.batches[0].awaitingReview = true;
    backend.jobs[0].status = "candidate_ready";
    backend.jobs[1].status = "queued";
    backend.calls.startBackgroundBatch.length = 0;
    backend.calls.saveForeshadowThread.length = 0;
    backend.calls.saveTimelineEvent.length = 0;
    backend.calls.saveStoryEntity.length = 0;
    backend.calls.saveCharacterState.length = 0;
    backend.calls.acceptChapterCandidate.length = 0;
    backend.calls.acceptAttempts.length = 0;
    backend.calls.appendGenerationEvent.length = 0;
    backend.findings.length = 0;
    backend.failAccept = false;
    window.localStorage.removeItem("amy-novel:auto-review");
    store.setState({
      chapters: {},
      entities: {},
      timelineEvents: {},
      foreshadowThreads: {},
      characterStates: {},
      candidates: {},
      factProposals: {},
      findings: {},
      batches: [],
      jobs: {},
      autoReview: {},
    });
  });

  afterEach(() => {
    store.getState().setAutoReview("n1", false);
  });

  it("完整循环：接受候选稿 → 接受全部正史建议 → 自动继续下一章 → 完成后自动关闭", async () => {
    enableAuto();

    // 第 1 轮：只接受候选稿，不越权先写正史建议（顺序与人工审阅一致）。
    await store.getState().tickAutoReview("n1");
    expect(backend.candidates[0].status).toBe("accepted");
    expect(backend.chapters[0]).toMatchObject({
      status: "accepted",
      content: "雾灯在暴雨里亮着。",
    });
    expect(backend.calls.saveForeshadowThread).toHaveLength(0);
    expect(backend.calls.saveTimelineEvent).toHaveLength(0);

    // 第 2 轮：全部正史建议以 ai_candidate 来源写入正史记忆，任务按门禁收敛。
    await store.getState().tickAutoReview("n1");
    expect(backend.proposals.map((item) => item.status)).toEqual([
      "accepted",
      "accepted",
    ]);
    expect(backend.calls.saveForeshadowThread).toHaveLength(1);
    expect(backend.calls.saveForeshadowThread[0]).toMatchObject({
      novelId: "n1",
      title: "灯油来自记忆",
      source: "ai_candidate",
    });
    expect(backend.calls.saveTimelineEvent).toHaveLength(1);
    expect(backend.jobs[0].status).toBe("completed");
    // 建议刚处理完的当轮不抢跑恢复，留运行器先收敛。
    expect(backend.calls.startBackgroundBatch).toHaveLength(0);

    // 第 3 轮：无待审内容且批次在等待审核 → 自动点“继续生成下一章”。
    await store.getState().tickAutoReview("n1");
    expect(backend.calls.startBackgroundBatch).toEqual(["b1"]);
    expect(backend.batches[0]).toMatchObject({
      status: "running",
      awaitingReview: false,
    });

    // 模拟运行器写完第 2 章并整批收敛。
    backend.jobs[1].status = "completed";
    backend.batches[0].status = "completed";
    await store.getState().tickAutoReview("n1");
    expect(store.getState().autoReview["n1"]).toMatchObject({
      enabled: false,
    });
    expect(store.getState().autoReview["n1"]?.message).toContain("全部完成");

    // 自动动作全部留痕到活动日志。
    expect(
      backend.calls.appendGenerationEvent.some((message) =>
        message.includes("候选稿"),
      ),
    ).toBe(true);
    expect(
      backend.calls.appendGenerationEvent.some((message) =>
        message.includes("2 条正史建议"),
      ),
    ).toBe(true);
  });

  it("安全边界：连续失败达到上限自动停止，不无限重试", async () => {
    backend.failAccept = true;
    enableAuto();
    for (let round = 0; round < 3; round++)
      await store.getState().tickAutoReview("n1");
    const state = store.getState().autoReview["n1"];
    expect(state?.enabled).toBe(false);
    expect(state?.message).toContain("连续 3 次失败");
    // 停止后不再尝试。
    backend.failAccept = false;
    await store.getState().tickAutoReview("n1");
    expect(backend.calls.acceptAttempts).toHaveLength(3);
    expect(backend.calls.acceptChapterCandidate).toHaveLength(0);
  });

  it("候选稿被人工拒绝时让位，不自动重写", async () => {
    backend.candidates[0].status = "rejected";
    enableAuto();
    await store.getState().tickAutoReview("n1");
    expect(store.getState().autoReview["n1"]?.enabled).toBe(false);
    expect(backend.calls.startBackgroundBatch).toHaveLength(0);
    expect(backend.calls.acceptChapterCandidate).toHaveLength(0);
  });

  it("质量门：存在未解决 error 级检查问题时暂停并交还人工", async () => {
    backend.findings.push({
      id: "f1",
      candidateId: "cd1",
      chapterId: "c1",
      severity: "error",
      status: "open",
      message: "主角位置与上一章矛盾",
      evidence: "第 1 章在灯塔，本章在港口",
      createdAt: backend.now,
      updatedAt: backend.now,
    });
    enableAuto();
    await store.getState().tickAutoReview("n1");
    expect(backend.candidates[0].status).toBe("candidate");
    expect(backend.calls.acceptAttempts).toHaveLength(0);
    expect(store.getState().autoReview["n1"]?.enabled).toBe(false);
    expect(store.getState().autoReview["n1"]?.message).toContain("error");
  });

  it("全局门（AN-027）：确定性校验发现 error 时自动接受暂停", async () => {
    // 悬空状态：characterStates 里存在指向不存在人物的状态 → error 级发现。
    backend.states.length = 0;
    backend.states.push({
      id: "s-ghost",
      novelId: "n1",
      characterId: "ghost",
      chapterId: "c1",
      summary: "孤儿状态",
      location: "雾灯港",
      appearance: "",
      outfit: "",
      identity: "",
      physical: "",
      emotional: "",
      knowledge: [],
      goals: [],
      inventory: [],
      skills: [],
      source: "manual",
      createdAt: backend.now,
      updatedAt: backend.now,
    });
    enableAuto();
    await store.getState().tickAutoReview("n1");
    expect(backend.calls.acceptAttempts).toHaveLength(0);
    expect(backend.candidates[0].status).toBe("candidate");
    const state = store.getState().autoReview["n1"];
    expect(state?.enabled).toBe(false);
    expect(state?.message).toContain("全局一致性校验");
    backend.states.length = 0;
  });

  it("setAutoReview 开关：状态与提示文案同步", () => {
    store.getState().setAutoReview("n1", true, "已开启");
    expect(store.getState().autoReview["n1"]).toEqual({
      enabled: true,
      message: "已开启",
    });
    store.getState().setAutoReview("n1", false);
    expect(store.getState().autoReview["n1"]?.enabled).toBe(false);
  });

  it("AN-035 收尾模式：批次 completed 但仍有候选未入正史时继续处理，不提前收工", async () => {
    backend.candidates[0].status = "accepted"; // 第 1 章已完成
    backend.jobs[0].status = "completed";
    backend.batches[0].status = "completed"; // 批次已收敛（无门禁批次先生成后审阅）
    backend.batches[0].awaitingReview = false;
    // 第 2 章候选就绪待接受（jobs[1] candidate_ready → cd1? 需要第二个候选）。
    backend.candidates.push({
      ...backend.candidates[0],
      id: "cd2",
      chapterId: "c2",
      status: "candidate",
    });
    backend.jobs[1].status = "candidate_ready";
    backend.jobs[1].candidateId = "cd2";
    enableAuto();
    await store.getState().tickAutoReview("n1");
    // 不因"批次已完成"提前自停，而是继续接受剩余候选。
    expect(store.getState().autoReview["n1"]?.enabled).toBe(true);
    expect(backend.candidates.find((item) => item.id === "cd2")?.status).toBe("accepted");
    expect(backend.calls.acceptAttempts).toContain("cd2");
  });

  it("AN-028 新角色：自动模式为圣经外角色建档并接受状态建议；人工路径仍拦截", async () => {
    backend.proposals.push(backend.newCharacterProposal);
    // 人工路径：不带 autoCreateCharacter 时保持原有门禁，要求先建档。
    backend.candidates[0].status = "accepted";
    await store.getState().loadQuality("cd1");
    await expect(
      store.getState().reviewFactProposal("cd1", "fp3", true),
    ).rejects.toThrow("未找到角色");
    expect(backend.calls.saveStoryEntity).toHaveLength(0);

    // 自动路径：接受候选稿 → 自动建档 → 状态建议写入，自动模式不掉线。
    backend.candidates[0].status = "candidate";
    backend.proposals.forEach((item) => {
      item.status = "proposed";
    });
    enableAuto();
    await store.getState().tickAutoReview("n1");
    await store.getState().tickAutoReview("n1");
    expect(backend.calls.saveStoryEntity).toHaveLength(1);
    expect(backend.calls.saveStoryEntity[0]).toMatchObject({
      novelId: "n1",
      type: "character",
      name: "阿雾",
    });
    expect(backend.calls.saveCharacterState[0]).toMatchObject({
      characterId: "e-auto",
      source: "ai_candidate",
    });
    expect(
      backend.proposals.find((item) => item.id === "fp3")?.status,
    ).toBe("accepted");
    expect(store.getState().autoReview["n1"]?.enabled).toBe(true);
  });

  it("AN-028 部分失败：坏建议不阻断整批；持续失败到上限仍自动停", async () => {
    backend.proposals.push(backend.newCharacterProposal, backend.brokenProposal);
    backend.candidates[0].status = "accepted";
    backend.jobs[0].status = "candidate_ready";
    enableAuto();
    await store.getState().tickAutoReview("n1");
    // 好建议照常入正史，坏建议保持 proposed 并在活动日志里说明。
    expect(backend.proposals.map((item) => item.status)).toEqual([
      "accepted",
      "accepted",
      "accepted",
      "proposed",
    ]);
    expect(store.getState().autoReview["n1"]?.enabled).toBe(true);
    expect(
      backend.calls.appendGenerationEvent.some((message) =>
        message.includes("待人工处理"),
      ),
    ).toBe(true);

    // 只剩坏建议后按原有失败上限自动停，提示指明是哪条建议。
    for (let round = 0; round < 3; round++)
      await store.getState().tickAutoReview("n1");
    const state = store.getState().autoReview["n1"];
    expect(state?.enabled).toBe(false);
    expect(state?.message).toContain("残缺记录");
  });

  it("AN-028 状态可见：批次暂停/排队且无待审内容时，横幅说明现状而非静默", async () => {
    backend.candidates[0].status = "accepted";
    backend.jobs[0].status = "completed";
    backend.batches[0].status = "paused";
    backend.batches[0].awaitingReview = false;
    enableAuto();
    await store.getState().tickAutoReview("n1");
    expect(store.getState().autoReview["n1"]?.enabled).toBe(true);
    expect(store.getState().autoReview["n1"]?.message).toContain("已暂停");

    backend.batches[0].status = "queued";
    await store.getState().tickAutoReview("n1");
    expect(store.getState().autoReview["n1"]?.message).toContain("排队");
    expect(store.getState().autoReview["n1"]?.enabled).toBe(true);
  });

  it("AN-029 运行器丢失接管：批次 running 但无任务在生成时重新接管（重启恢复）", async () => {
    // 场景一：应用重启后批次停在 running，任务退回 queued 无人推进。
    backend.candidates[0].status = "accepted";
    backend.jobs[0].status = "queued";
    backend.jobs[1].status = "queued";
    backend.batches[0].status = "running";
    backend.batches[0].awaitingReview = false;
    enableAuto();
    await store.getState().tickAutoReview("n1");
    expect(backend.calls.startBackgroundBatch).toEqual(["b1"]);

    // 场景二：任务卡在 generating 且长时间无更新（运行器随重启丢失）。
    backend.calls.startBackgroundBatch.length = 0;
    backend.jobs[0].status = "generating";
    backend.jobs[0].updatedAt = new Date(
      Date.now() - 10 * 60_000,
    ).toISOString();
    await store.getState().tickAutoReview("n1");
    expect(backend.calls.startBackgroundBatch).toEqual(["b1"]);

    // 场景三：任务在正常生成（刚更新过）则只报状态，不抢跑。
    backend.calls.startBackgroundBatch.length = 0;
    backend.jobs[0].updatedAt = new Date().toISOString();
    await store.getState().tickAutoReview("n1");
    expect(backend.calls.startBackgroundBatch).toHaveLength(0);
    expect(store.getState().autoReview["n1"]?.message).toContain(
      "正在生成章节正文",
    );
  });

  it("AN-028 持久化：开关写入 localStorage，刷新/重启后可断点续跑", () => {
    store.getState().setAutoReview("n1", true, "已开启");
    expect(
      JSON.parse(
        window.localStorage.getItem("amy-novel:auto-review") ?? "[]",
      ),
    ).toContain("n1");
    // 关闭（含自动停用）时同步清除，重启后不会复活已停用的模式。
    store.getState().setAutoReview("n1", false);
    expect(
      JSON.parse(
        window.localStorage.getItem("amy-novel:auto-review") ?? "[]",
      ),
    ).not.toContain("n1");
  });
});
