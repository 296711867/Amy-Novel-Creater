/**
 * AN-027 ①：全局一致性确定性校验器域测试。
 *
 * 每条规则一正一反：制造矛盾必须被抓到，正常数据零误报。
 */
import { describe, expect, it } from "vitest";
import {
  checkGlobalConsistency,
  parseGlobalReview,
  globalReviewPrompt,
  type GlobalConsistencyInput,
} from "@domain/global-consistency";
import type { Chapter } from "@domain/novel";
import type { StoryEntity } from "@domain/story-bible";
import type {
  CharacterState,
  ForeshadowThread,
  TimelineEvent,
} from "@domain/continuity";

const now = "2026-08-31T00:00:00.000Z";

function chapter(position: number): Chapter {
  return {
    id: `c${position}`,
    novelId: "n1",
    position,
    volumeId: null,
    title: `第${position}章`,
    outline: "o",
    status: "accepted",
    targetWords: 3000,
    content: "x",
    wordCount: 1,
    updatedAt: now,
  };
}
function character(id: string, name: string, status = "active"): StoryEntity {
  return {
    id,
    novelId: "n1",
    type: "character",
    name,
    summary: "s",
    aliases: [],
    profile: {},
    status: status as StoryEntity["status"],
    createdAt: now,
    updatedAt: now,
  };
}
function state(
  id: string,
  characterId: string,
  chapterId: string,
  location: string,
  inventory: string[] = [],
): CharacterState {
  return {
    id,
    novelId: "n1",
    characterId,
    chapterId,
    summary: `${id} 摘要`,
    location,
    appearance: "",
    outfit: "",
    identity: "",
    physical: "",
    emotional: "",
    knowledge: [],
    goals: [],
    inventory,
    skills: [],
    source: "manual",
    createdAt: now,
    updatedAt: now,
  };
}
function baseInput(
  overrides: Partial<GlobalConsistencyInput> = {},
): GlobalConsistencyInput {
  return {
    chapters: [chapter(1), chapter(2), chapter(3)],
    entities: [character("e1", "沈灯"), character("e2", "崔衡")],
    timeline: [],
    foreshadow: [],
    characterStates: [],
    ...overrides,
  };
}

describe("全局一致性校验器", () => {
  it("干净数据零发现", () => {
    const input = baseInput({
      characterStates: [
        state("s1", "e1", "c1", "雾灯港"),
        state("s2", "e1", "c2", "雾灯港", ["青铜钥匙"]),
        state("s3", "e2", "c2", "海上", ["航海图"]),
      ],
    });
    expect(checkGlobalConsistency(input)).toEqual([]);
  });

  it("悬空引用：状态指向不存在的人物/章节 → error", () => {
    const findings = checkGlobalConsistency(
      baseInput({
        characterStates: [state("s1", "ghost", "c9", "雾灯港")],
      }),
    );
    expect(findings.filter((item) => item.id.startsWith("rule:dangling-state:"))).toHaveLength(1);
    expect(
      findings.filter((item) => item.id.startsWith("rule:dangling-state-chapter:")),
    ).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
  });

  it("位置跳变：无时间线解释 → warning；有事件解释 → 无发现", () => {
    const jump = checkGlobalConsistency(
      baseInput({
        characterStates: [
          state("s1", "e1", "c1", "雾灯港"),
          state("s2", "e1", "c3", "远海沉船"),
        ],
      }),
    );
    expect(jump).toHaveLength(1);
    expect(jump[0]).toMatchObject({
      severity: "warning",
      category: "location",
      targetName: "沈灯",
    });

    const event: TimelineEvent = {
      id: "t1",
      novelId: "n1",
      chapterId: "c2",
      storyTime: "第二夜",
      title: "沈灯出海",
      detail: "乘小船前往沉船",
      participantIds: ["e1"],
      source: "manual",
      createdAt: now,
      updatedAt: now,
    };
    const explained = checkGlobalConsistency(
      baseInput({
        timeline: [event],
        characterStates: [
          state("s1", "e1", "c1", "雾灯港"),
          state("s2", "e1", "c3", "远海沉船"),
        ],
      }),
    );
    expect(explained).toEqual([]);
  });

  it("道具重复持有：两人物最新状态都有同一件道具 → warning", () => {
    const findings = checkGlobalConsistency(
      baseInput({
        characterStates: [
          state("s1", "e1", "c3", "雾灯港", ["青铜钥匙", "旧海图"]),
          state("s2", "e2", "c3", "海上", [" 青铜钥匙 "]),
        ],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("青铜钥匙");
    expect(findings[0].message).toContain("沈灯");
    expect(findings[0].message).toContain("崔衡");
  });

  it("伏笔超期：埋设 31 章未回收 → warning；resolved 不报", () => {
    const chapters = Array.from({ length: 35 }, (_, index) =>
      chapter(index + 1),
    );
    const overdue: ForeshadowThread = {
      id: "f1",
      novelId: "n1",
      title: "守灯人的账本",
      detail: "灯塔底层有一本账本",
      setupChapterId: "c2",
      payoffChapterId: null,
      status: "developing",
      source: "manual",
      createdAt: now,
      updatedAt: now,
    };
    const resolved: ForeshadowThread = { ...overdue, id: "f2", status: "resolved", title: "已回收" };
    const findings = checkGlobalConsistency(
      baseInput({ chapters, foreshadow: [overdue, resolved] }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("守灯人的账本");
  });

  it("名称冲突：两个实体共享别名 → warning", () => {
    const findings = checkGlobalConsistency(
      baseInput({
        entities: [
          { ...character("e1", "沈灯"), aliases: ["小灯"] },
          { ...character("e2", "崔衡"), aliases: ["老崔", "小灯"] },
        ],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("沈灯");
  });

  it("名称冲突（AN-028 回归）：同一组实体共享多个名称只产出一条，id 不得重复", () => {
    // 线上事故：两个实体共享 3 个名称键时逐键产出 3 条同 id 发现，
    // saveGlobalFindings 主键冲突整批回滚，校验结果永远存不下来。
    const findings = checkGlobalConsistency(
      baseInput({
        entities: [
          {
            ...character("e1", "前进系统"),
            aliases: ["系统", "老系统", "执灯", "灯官"],
          },
          {
            ...character("e2", "萧衔烛"),
            aliases: ["系统", "老系统", "衔烛", "灯官"],
          },
        ],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].evidence).toContain("3 个");
    const ids = findings.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("输出不变量：任意输入下 finding id 全局唯一（防持久层主键冲突）", () => {
    const findings = checkGlobalConsistency(
      baseInput({
        entities: [
          { ...character("e1", "沈灯"), aliases: ["小灯", "灯"] },
          { ...character("e2", "崔衡"), aliases: ["小灯", "灯"] },
          { ...character("e3", "阿灯"), aliases: ["灯"] },
        ],
        characterStates: [
          state("s1", "e1", "c1", "雾灯港"),
          state("s2", "e1", "c2", "海上"),
          state("s3", "e2", "c1", "雾灯港", ["青铜钥匙"]),
          state("s4", "e1", "c3", "坟场", ["青铜钥匙"]),
        ],
      }),
    );
    expect(findings.length).toBeGreaterThan(0);
    const ids = findings.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("停用人物仍有最新状态 → warning", () => {
    const findings = checkGlobalConsistency(
      baseInput({
        entities: [character("e1", "沈灯", "inactive"), character("e2", "崔衡")],
        characterStates: [state("s1", "e1", "c3", "坟场")],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("已标记停用");
  });
});

describe("AI 全局审查 prompt 与解析", () => {
  it("prompt 装配正史数据并按预算裁剪", () => {
    const text = globalReviewPrompt({
      novelTitle: "雾灯航路",
      genre: "悬疑",
      bible: [{ title: "世界规则", content: "灯油来自记忆。".repeat(200) }],
      entities: [character("e1", "沈灯")],
      chapters: [chapter(1), chapter(2)],
      characterStates: [state("s1", "e1", "c1", "雾灯港")],
      timeline: [],
      foreshadow: [],
      recentContents: [
        { position: 2, title: "出海", content: "船离港。".repeat(200) },
      ],
      inputBudget: 1200,
    });
    expect(text).toContain("雾灯航路");
    expect(text).toContain("出海");
    // 预算裁剪后仍保留指令与输出格式说明。
    expect(text).toContain("issues");
  });

  it("解析合法响应：findings 与修复提案结构正确", () => {
    const outcome = parseGlobalReview(
      JSON.stringify({
        summary: "整体一致，有一处矛盾。",
        issues: [
          {
            severity: "error",
            category: "timeline",
            message: "沈灯在第5章不可能知道账本内容",
            evidence: "第2章账本未打开，第5章他引用了账本数字",
            suggestion: "在第3-4章补一场偷看账本的戏",
            targetKind: "chapter",
            targetName: "5",
            chapterPosition: 5,
          },
        ],
        proposals: [
          {
            action: "update",
            targetType: "character",
            targetName: "沈灯",
            patch: { summary: "守灯少年，对账本有执念" },
            reason: "动机补强",
          },
        ],
      }),
      { novelId: "n1" },
    );
    expect(outcome.findings).toHaveLength(1);
    expect(outcome.findings[0]).toMatchObject({
      source: "ai",
      severity: "error",
      targetKind: "chapter",
      chapterPosition: 5,
    });
    expect(outcome.proposals[0]).toMatchObject({
      action: "update",
      targetName: "沈灯",
    });
    // 同一问题两次解析生成稳定 id（忽略状态可跨运行保持）。
    const again = parseGlobalReview(
      JSON.stringify({
        summary: "",
        issues: [
          {
            severity: "error",
            category: "timeline",
            message: "沈灯在第5章不可能知道账本内容",
          },
        ],
      }),
      { novelId: "n1" },
    );
    expect(again.findings[0].id).toBe(outcome.findings[0].id);
  });

  it("解析去重（AN-028 回归）：模型复述同一问题时只保留一条", () => {
    const outcome = parseGlobalReview(
      JSON.stringify({
        summary: "",
        issues: [
          {
            severity: "warning",
            category: "consistency",
            message: "沈灯的动机前后不一致",
          },
          {
            severity: "warning",
            category: "consistency",
            message: "沈灯的动机前后不一致",
            suggestion: "补一场动机转变的戏",
          },
        ],
      }),
      { novelId: "n1" },
    );
    expect(outcome.findings).toHaveLength(1);
    const ids = outcome.findings.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
