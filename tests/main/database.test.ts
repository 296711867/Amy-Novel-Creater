import { afterAll, describe, expect, it } from "vitest";
import { NovelDatabase } from "../../src/main/db/database";

let database: NovelDatabase | null = null;
afterAll(() => database?.close());

describe("NovelDatabase", () => {
  it("persists chapters and immutable snapshots", async () => {
    database = await NovelDatabase.open(":memory:");
    const created = await database.createNovel({
      title: "测试小说",
      genre: "科幻",
      premise: "一段测试设定",
      targetChapters: 3,
      chapterWords: 2000,
    });
    const first = created.chapters[0];
    const saved = await database.saveChapter({
      chapterId: first.id,
      title: "第一章 起航",
      outline: "主角离开故乡",
      content: "星舰在黎明前起飞。",
    });
    expect(saved.wordCount).toBe(9);
    const version = await database.createChapterSnapshot(first.id);
    expect(version).toMatchObject({
      versionNo: 1,
      content: "星舰在黎明前起飞。",
      origin: "manual",
    });
    expect(await database.listNovels()).toHaveLength(1);
    const sections = await database.listBibleSections(created.novel.id);
    expect(sections.map((section) => section.kind)).toEqual([
      "intent",
      "world",
      "style",
      "boundaries",
    ]);
    const intent = await database.saveBibleSection({
      novelId: created.novel.id,
      kind: "intent",
      content: "关于选择与代价的故事。",
    });
    expect(intent).toMatchObject({
      versionNo: 2,
      content: "关于选择与代价的故事。",
    });
    const character = await database.saveStoryEntity({
      novelId: created.novel.id,
      type: "character",
      name: "林舟",
      summary: "星舰领航员",
      aliases: ["小林", "小林"],
      profile: { details: "谨慎，但渴望远行。" },
    });
    expect(character.aliases).toEqual(["小林"]);
    expect(
      await database.listStoryEntities(created.novel.id, "character"),
    ).toHaveLength(1);
    const event = await database.saveTimelineEvent({
      novelId: created.novel.id,
      chapterId: first.id,
      storyTime: "星历 217 年",
      title: "星舰起飞",
      detail: "林舟离开母星",
      participantIds: [character.id],
    });
    expect(await database.listTimelineEvents(created.novel.id)).toEqual([
      event,
    ]);
    const thread = await database.saveForeshadowThread({
      novelId: created.novel.id,
      title: "失效的导航仪",
      detail: "真正保存着旧航线",
      setupChapterId: first.id,
      payoffChapterId: null,
      status: "planted",
    });
    expect(thread.status).toBe("planted");
    const state = await database.saveCharacterState({
      novelId: created.novel.id,
      characterId: character.id,
      chapterId: first.id,
      summary: "正式离开母星",
      location: "远航舰",
      physical: "健康",
      emotional: "紧张",
      knowledge: ["导航仪异常"],
      goals: ["抵达边境"],
      inventory: ["旧钥匙"],
      skills: ["星图导航"],
    });
    expect(state).toMatchObject({
      location: "远航舰",
      knowledge: ["导航仪异常"],
    });
    const structure = await database.listStoryStructure(created.novel.id);
    expect(structure.volumes).toHaveLength(1);
    expect(
      (await database.listChapters(created.novel.id)).every(
        (chapter) => chapter.volumeId === structure.volumes[0].id,
      ),
    ).toBe(true);
    const secondVolume = await database.saveVolume({
      novelId: created.novel.id,
      title: "第二卷",
      outline: "进入边境",
    });
    const fourth = await database.createChapter({
      novelId: created.novel.id,
      volumeId: secondVolume.id,
      title: "边境来客",
      targetWords: 2200,
    });
    const scene = await database.saveScene({
      chapterId: fourth.id,
      title: "截停",
      summary: "陌生舰船发出警告",
      viewpoint: "林舟",
      location: "边境航道",
      targetWords: 900,
    });
    expect(scene.position).toBe(1);
    const reordered = await database.reorderChapters(created.novel.id, [
      fourth.id,
      ...created.chapters.map((chapter) => chapter.id),
    ]);
    expect(reordered[0]).toMatchObject({ id: fourth.id, position: 1 });
    const pack = {
      chapterId: fourth.id,
      renderedText: "## 写作任务\n继续故事",
      contentHash: "1234abcd",
      inputTokens: 12,
      outputTokensReserved: 100,
      totalBudget: 112,
      sources: [],
      createdAt: new Date().toISOString(),
    };
    await database.saveContextSnapshot(created.novel.id, pack);
    expect(
      await database.listContextSnapshots(created.novel.id, fourth.id),
    ).toEqual([pack]);
    const usage = await database.saveUsage({
      novelId: created.novel.id,
      chapterId: fourth.id,
      operation: "context_build",
      provider: "local",
      model: "estimator",
      inputTokens: 12,
      outputTokens: 100,
      cachedTokens: 0,
      cost: null,
      measurement: "estimated",
    });
    expect((await database.listUsage(created.novel.id))[0]).toEqual(usage);
    await expect(
      database.createGenerationBatch(created.novel.id, {
        startChapter: 1,
        endChapter: 2,
        chapterWords: 2000,
        continuityCheck: true,
        maxRetries: 2,
        approvalMode: "candidate",
        outputTokenBudget: 10000,
      }),
    ).rejects.toThrow("请先完成小说框架十步向导");
    const workflow = await database.savePlanningWorkflow({
      ...(await database.getPlanningWorkflow(created.novel.id)),
      scopeAdvice: {
        recommendation: {
          tierLabel: "试水档",
          totalChapters: 80,
          chapterWords: 2500,
          dailyChapters: 1,
          estimatedDays: 80,
          reason: "先完成一个可验证的完整故事闭环",
        },
        milestones: [],
        volumeSkeleton: [],
        notes: [],
      },
      brief: {
        audience: "科幻读者",
        style: "克制",
        boundaries: "不复活",
        sellingPoint: "代际远航",
        conflict: "资源与时间",
        protagonistGoal: "抵达新家园",
        ending: "开放式",
      },
      confirmedSteps: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      updatedAt: new Date().toISOString(),
    });
    expect(workflow).toMatchObject({
      novelId: created.novel.id,
      confirmedSteps: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    });
    expect(
      (await database.getPlanningWorkflow(created.novel.id)).scopeAdvice
        ?.recommendation.totalChapters,
    ).toBe(80);
    const planningRun = await database.startPlanningRun({
      novelId: created.novel.id,
      phase: "bible",
      profileId: "planning-profile",
      provider: "local",
      model: "mock",
      prompt: "生成故事圣经",
    });
    await database.recordPlanningResponse(planningRun.id, {
      rawResponse: '{"broken":',
      inputTokens: 10,
      outputTokens: 5,
      cachedTokens: 1,
    });
    await database.recordPlanningRepair(planningRun.id, {
      repairResponse: '{"sections":[]}',
      inputTokens: 8,
      outputTokens: 4,
      cachedTokens: 0,
    });
    expect((await database.listPlanningRuns(created.novel.id))[0]).toMatchObject(
      {
        rawResponse: '{"broken":',
        repairResponse: '{"sections":[]}',
        inputTokens: 18,
        outputTokens: 9,
      },
    );
    for (const [kind, content] of [
      ["world", "星际航行遵守光速限制。"],
      ["style", "克制的第三人称限知。"],
      ["boundaries", "死亡角色不得复活。"],
    ] as const)
      await database.saveBibleSection({
        novelId: created.novel.id,
        kind,
        content,
      });
    await database.saveStoryEntity({
      id: character.id,
      novelId: created.novel.id,
      type: "character",
      name: character.name,
      summary: character.summary,
      aliases: character.aliases,
      profile: { ...character.profile, tier: "protagonist" },
    });
    for (const [name, tier] of [
      ["沈岚", "support"],
      ["老周", "recurring"],
    ] as const)
      await database.saveStoryEntity({
        novelId: created.novel.id,
        type: "character",
        name,
        summary: "远航舰成员",
        aliases: [],
        profile: { tier },
      });
    for (const [type, name] of [
      ["location", "远航舰"],
      ["organization", "远航议会"],
      ["item", "旧导航仪"],
    ] as const)
      await database.saveStoryEntity({
        novelId: created.novel.id,
        type,
        name,
        summary: "服务主线冲突的关键设定",
        aliases: [],
        profile: {},
      });
    await database.deleteChapter(created.chapters[2].id);
    const plannedChapters = await database.listChapters(created.novel.id);
    for (const chapter of plannedChapters)
      await database.updateChapterPlan({
        chapterId: chapter.id,
        volumeId: chapter.volumeId,
        title: `第${chapter.position}章 航线${chapter.position}`,
        outline: `第 ${chapter.position} 章完整事件、冲突、结果与钩子。`,
        targetWords: chapter.targetWords,
      });
    const profile = await database.saveModelProfile(
      {
        name: "DeepSeek",
        provider: "deepseek",
        modelId: "deepseek-chat",
        baseUrl: "https://api.deepseek.com",
        contextWindow: 64000,
        inputPricePerMillion: null,
        outputPricePerMillion: null,
        isDefault: true,
        apiKey: "must-not-persist",
      },
      true,
    );
    expect(profile).toMatchObject({
      name: "DeepSeek",
      hasSecret: true,
      isDefault: true,
    });
    expect(JSON.stringify(await database.listModelProfiles())).not.toContain(
      "must-not-persist",
    );
    const candidate = await database.createChapterCandidate({
      novelId: created.novel.id,
      chapterId: fourth.id,
      profileId: profile.id,
      contextHash: "1234abcd",
      content: "边境的灯火逐次熄灭。",
      inputTokens: 120,
      outputTokens: 20,
      cachedTokens: 10,
    });
    expect(candidate).toMatchObject({ status: "candidate", wordCount: 10 });
    const accepted = await database.setCandidateStatus(
      candidate.id,
      "accepted",
    );
    expect(accepted.status).toBe("accepted");
    expect((await database.getChapter(fourth.id))?.content).toBe(
      candidate.content,
    );
    expect((await database.listChapterVersions(fourth.id))[0]).toMatchObject({
      origin: "accepted",
      content: candidate.content,
    });
    await database.savePlanningCycle({
      novelId: created.novel.id,
      startChapter: 1,
      endChapter: 2,
      status: "ready",
      goal: "完成首次远航",
      openingState: "仍在母星",
      climax: "突破封锁",
      expectedClosingState: "进入航道",
      actualClosingState: "",
    });
    const gatedCandidate = await database.createChapterCandidate({
        novelId: created.novel.id,
        chapterId: plannedChapters[0].id,
        profileId: profile.id,
        contextHash: "fact-gate",
        content: "第一章正史候选稿。",
        inputTokens: 10,
        outputTokens: 10,
        cachedTokens: 0,
      }),
      [pendingProposal] = await database.saveFactProposals(
        gatedCandidate.id,
        plannedChapters[0].id,
        [{ kind: "timeline", title: "启航", payload: { summary: "启航" } }],
      );
    await database.setCandidateStatus(gatedCandidate.id, "accepted");
    await expect(
      database.savePlanningCycle({
        novelId: created.novel.id,
        startChapter: 1,
        endChapter: 2,
        status: "completed",
        goal: "完成首次远航",
        openingState: "仍在母星",
        climax: "突破封锁",
        expectedClosingState: "进入航道",
        actualClosingState: "已经启航",
      }),
    ).rejects.toThrow("仍有 1 条正史建议未处理");
    await database.updateFactProposal(pendingProposal.id, "accepted");
    expect(
      (
        await database.savePlanningCycle({
          novelId: created.novel.id,
          startChapter: 1,
          endChapter: 2,
          status: "completed",
          goal: "完成首次远航",
          openingState: "仍在母星",
          climax: "突破封锁",
          expectedClosingState: "进入航道",
          actualClosingState: "已经启航",
        })
      ).status,
    ).toBe("completed");
    await database.savePlanningCycle({
      novelId: created.novel.id,
      startChapter: 1,
      endChapter: 2,
      status: "ready",
      goal: "完成首次远航",
      openingState: "仍在母星",
      climax: "突破封锁",
      expectedClosingState: "进入航道",
      actualClosingState: "已经启航",
    });
    const batchResult = await database.createGenerationBatch(created.novel.id, {
      startChapter: 1,
      endChapter: 2,
      chapterWords: 2000,
      continuityCheck: true,
      maxRetries: 2,
      approvalMode: "candidate",
      outputTokenBudget: 10000,
    });
    const jobs = await database.listGenerationJobs(batchResult.id);
    expect(jobs).toHaveLength(2);
    const running = await database.updateGenerationJob(
      jobs[0].id,
      "generating",
      { attempt: 1 },
    );
    expect(running).toMatchObject({ status: "generating", attempt: 1 });
    await database.updateGenerationJob(jobs[0].id, "candidate_ready", {
      outputTokens: 1200,
    });
    expect(
      (await database.getGenerationBatch(batchResult.id))?.outputTokensUsed,
    ).toBe(1200);
    await database.deleteNovel(created.novel.id);
    expect(await database.listNovels()).toEqual([]);
    expect(await database.listChapters(created.novel.id)).toEqual([]);
    expect(await database.listGenerationBatches()).toEqual([]);
    expect(await database.listUsage(created.novel.id)).toEqual([]);
    await expect(database.deleteNovel(created.novel.id)).rejects.toThrow(
      "作品不存在",
    );
  });

  it("deduplicates accepted entity additions across planning cycles", async () => {
    const created = await database!.createNovel({
        title: "提案去重",
        genre: "科幻",
        premise: "记忆代价",
        targetChapters: 20,
        chapterWords: 1000,
      }),
      proposal = {
        action: "add" as const,
        targetType: "term" as const,
        targetName: "记忆耗尽效应",
        patch: { summary: "连续使用能力会耗尽记忆" },
        reason: "第一周期需要",
      },
      [first] = await database!.addPlanningProposals(
        created.novel.id,
        "cycle-1",
        1,
        10,
        [proposal],
      );
    await database!.updatePlanningProposalStatus(first.id, "accepted");
    expect(
      await database!.addPlanningProposals(
        created.novel.id,
        "cycle-2",
        11,
        20,
        [{ ...proposal, reason: "第二周期重复提出" }],
      ),
    ).toEqual([]);
    expect(await database!.listPlanningProposals(created.novel.id)).toHaveLength(
      1,
    );
  });

  it("persists and updates the rolling cycle size", async () => {
    const created = await database!.createNovel({
      title: "批次大小测试",
      genre: "玄幻",
      premise: "测试每批章数",
      targetChapters: 30,
      chapterWords: 1000,
    });
    expect(created.novel.cycleSize).toBe(10);
    const custom = await database!.createNovel({
      title: "自定义批次",
      genre: "科幻",
      premise: "五章一批",
      targetChapters: 20,
      chapterWords: 1000,
      cycleSize: 5,
    });
    expect(custom.novel.cycleSize).toBe(5);
    expect((await database!.getNovel(custom.novel.id))?.cycleSize).toBe(5);
    const updated = await database!.updateCycleSize(custom.novel.id, 99);
    expect(updated.cycleSize).toBe(15);
    expect((await database!.getNovel(custom.novel.id))?.cycleSize).toBe(15);
    await database!.deleteNovel(created.novel.id);
    await database!.deleteNovel(custom.novel.id);
  });

  it("persists reusable style templates", async () => {
    const saved = await database!.saveStyleTemplate({
      name: "冷雾短句",
      authorAlias: "北港客",
      sourceTitle: "旧港",
      sampleText: "一段本地保存的样章。",
      contentSummary: "旅人夜渡。",
      styleSummary: "短句、克制。",
      styleGuide: "多用短句；不要复用来源情节。",
    });
    expect(await database!.getStyleTemplate(saved.id)).toEqual(saved);
    expect(await database!.listStyleTemplates()).toEqual([saved]);
    await database!.deleteStyleTemplate(saved.id);
    expect(await database!.listStyleTemplates()).toEqual([]);
  });

  it("persists workflow runs for pause and resume across sessions", async () => {
    const created = await database!.createNovel({
      title: "工作流测试",
      genre: "科幻",
      premise: "测试运行状态持久化",
      targetChapters: 20,
      chapterWords: 2000,
    });
    const policy = {
      startChapter: 1,
      endChapter: 10,
      chapterWords: 2000,
      continuityCheck: true,
      maxRetries: 2,
      approvalMode: "candidate" as const,
      outputTokenBudget: 60000,
    };
    const run = await database!.createWorkflowRun({
      novelId: created.novel.id,
      mode: "checkpoint",
      config: { generationPolicy: policy, maxPhaseRetries: 2 },
    });
    // 新建的运行从第一个规划阶段开始，处于待恢复状态。
    expect(run).toMatchObject({
      novelId: created.novel.id,
      mode: "checkpoint",
      currentPhase: "bible",
      status: "paused",
      checkpoint: null,
      attempt: 0,
      batchId: null,
    });

    const paused = await database!.updateWorkflowRun({
      id: run.id,
      currentPhase: "cast",
      status: "paused",
      checkpoint: "phase_review",
    });
    expect(paused).toMatchObject({
      currentPhase: "cast",
      status: "paused",
      checkpoint: "phase_review",
    });

    // “会话重启”后从持久化状态恢复：列表按时间倒序，部分更新不丢字段。
    const resumed = await database!.updateWorkflowRun({
      id: run.id,
      status: "running",
      checkpoint: null,
      batchId: "batch-1",
    });
    expect(resumed).toMatchObject({
      currentPhase: "cast",
      status: "running",
      batchId: "batch-1",
      config: { generationPolicy: policy, maxPhaseRetries: 2 },
    });
    const listed = await database!.listWorkflowRuns(created.novel.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual(resumed);

    const failed = await database!.updateWorkflowRun({
      id: run.id,
      status: "failed",
      attempt: 2,
      error: "规划 JSON 两次解析失败",
    });
    expect(failed.error).toBe("规划 JSON 两次解析失败");
    expect(failed.attempt).toBe(2);

    // 删除小说时运行记录级联清理。
    await database!.deleteNovel(created.novel.id);
    expect(await database!.listWorkflowRuns(created.novel.id)).toEqual([]);
  });
});
