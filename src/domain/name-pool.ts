import type { StoryEntity } from "./story-bible";
import { mentions } from "./story-bible";

export type NamePoolGenre =
  "fantasy" | "urban" | "scifi" | "history" | "general";
export interface NamePool {
  novelId: string;
  genre: NamePoolGenre;
  surnames: string[];
  givenNames: string[];
  usedNames: string[];
  updatedAt: string;
}
export const GENRE_POOL_LABELS: Record<NamePoolGenre, string> = {
  fantasy: "玄幻仙侠",
  urban: "都市现代",
  scifi: "科幻未来",
  history: "历史古风",
  general: "通用",
};
// 内置姓/名分池：按题材给出风格化组合，跑龙套与章纲人物起名统一从这里取。
const BUILT_IN_POOLS: Record<
  NamePoolGenre,
  { surnames: string[]; givenNames: string[] }
> = {
  fantasy: {
    surnames: [
      "林",
      "叶",
      "楚",
      "萧",
      "秦",
      "慕",
      "云",
      "洛",
      "顾",
      "沈",
      "燕",
      "池",
    ],
    givenNames: [
      "无咎",
      "青崖",
      "惊鸿",
      "行舟",
      "问天",
      "拂雪",
      "藏锋",
      "衔烛",
      "听澜",
      "逐光",
      "素秋",
      "沉璧",
      "归尘",
      "折岳",
      "临渊",
      "别鹤",
      "衔月",
      "知微",
      "破军",
      "若渊",
    ],
  },
  urban: {
    surnames: [
      "陈",
      "李",
      "周",
      "吴",
      "郑",
      "王",
      "许",
      "江",
      "苏",
      "方",
      "程",
      "孟",
    ],
    givenNames: [
      "一鸣",
      "思远",
      "嘉树",
      "明朗",
      "卓然",
      "知行",
      "南汐",
      "亦可",
      "则铭",
      "沛东",
      "晚晴",
      "书言",
      "既白",
      "临风",
      "慕言",
      "清让",
      "望舒",
      "疏影",
      "慕橙",
      "聿修",
    ],
  },
  scifi: {
    surnames: [
      "凌",
      "陆",
      "简",
      "祁",
      "岑",
      "纪",
      "商",
      "温",
      "应",
      "齐",
      "阮",
      "柯",
    ],
    givenNames: [
      "以恒",
      "星野",
      "序言",
      "维恩",
      "执明",
      "回路",
      "北辰",
      "启元",
      "熵减",
      "光锥",
      "叙白",
      "折跃",
      "零一",
      "静默",
      "边界",
      "同步",
      "弦歌",
      "彼岸",
      "观测",
      "洛书",
    ],
  },
  history: {
    surnames: [
      "赵",
      "钱",
      "孙",
      "周",
      "吴",
      "冯",
      "陈",
      "褚",
      "卫",
      "蒋",
      "沈",
      "韩",
    ],
    givenNames: [
      "伯言",
      "仲祺",
      "叔瑾",
      "季同",
      "怀瑾",
      "执中",
      "敬亭",
      "明允",
      "修远",
      "维桢",
      "令仪",
      "静姝",
      "燕绥",
      "其琛",
      "如晤",
      "嘉卉",
      "南乔",
      "振鹭",
      "秉文",
      "骏声",
    ],
  },
  general: {
    surnames: [
      "张",
      "刘",
      "杨",
      "黄",
      "徐",
      "马",
      "高",
      "林",
      "何",
      "郭",
      "罗",
      "梁",
    ],
    givenNames: [
      "承",
      "远",
      "安",
      "宁",
      "朝",
      "露",
      "岁",
      "禾",
      "拾",
      "光",
      "予",
      "怀",
      "信",
      "之",
      "望",
      "舒",
      "清",
      "和",
      "自",
      "明",
    ],
  },
};
export function genreKeyOf(genre: string): NamePoolGenre {
  if (/玄幻|仙侠|修真|奇幻|武侠/.test(genre)) return "fantasy";
  if (/都市|现代|言情|职场/.test(genre)) return "urban";
  if (/科幻|末世|星际|赛博/.test(genre)) return "scifi";
  if (/历史|古风|架空|宫斗/.test(genre)) return "history";
  return "general";
}
export function defaultNamePool(novelId: string, genre: string): NamePool {
  const key = genreKeyOf(genre);
  return {
    novelId,
    genre: key,
    surnames: [...BUILT_IN_POOLS[key].surnames],
    givenNames: [...BUILT_IN_POOLS[key].givenNames],
    usedNames: [],
    updatedAt: new Date().toISOString(),
  };
}
// 与既有实体（name+aliases）及池内已用名查重后随机抽取；池耗尽返回空数组。
export function drawNames(
  pool: NamePool,
  count: number,
  entities: StoryEntity[],
): string[] {
  const taken = new Set([
    ...pool.usedNames,
    ...entities.map((item) => item.name),
    ...entities.flatMap((item) => item.aliases),
  ]);
  const picked: string[] = [];
  for (
    let attempt = 0;
    attempt < count * 12 && picked.length < count;
    attempt++
  ) {
    const surname =
      pool.surnames[Math.floor(Math.random() * pool.surnames.length)];
    const given =
      pool.givenNames[Math.floor(Math.random() * pool.givenNames.length)];
    const name = `${surname}${given}`;
    if (taken.has(name)) continue;
    taken.add(name);
    picked.push(name);
  }
  return picked;
}
export function namePoolText(pool: NamePool, count = 30): string {
  const names = drawNames(pool, count, []).join("、");
  return `题材风格：${GENRE_POOL_LABELS[pool.genre]}。可用姓名示例（风格参照，禁止与既有角色重名）：${names}`;
}
export function findNameCollisions(
  pool: NamePool,
  entities: StoryEntity[],
): string[] {
  return pool.usedNames.filter((name) =>
    entities.some((entity) => mentions(name, entity)),
  );
}
