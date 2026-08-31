// 截图用的本地 mock 模型服务：按提示词区分阶段返回合法规划 JSON，
// 正文走快速 SSE。仅用于本地演示/截图，不属于产品代码。
import { createServer } from "node:http";

const PROSE =
  "雾从船舷爬上来的时候，林昭数到了第七声铃。母亲留下的雾灯在怀里发烫，灯壳上的萤纹一格一格亮起来，像有人在他骨头里点灯。" +
  "他想起娘说过的话：灯油不是油，是你舍不得的那些东西。第一座灯塔亮起来的时候，他把十二岁那年的星空交了出去。" +
  "星图还在脑子里，只是再也想不起娘指给他看时说过什么。桅顶的铜铃又响了一声，第七声。雾墙在灯前退开一线，露出一截黑色的塔基。";

function phaseOf(prompt) {
  if (prompt.includes("小说文风分析师")) return "style";
  if (prompt.includes("开书简报代笔")) return "brief";
  if (prompt.includes("开书顾问")) return "advisory";
  if (prompt.includes("人物分层") || prompt.includes("完整人物体系")) return "cast";
  if (prompt.includes("场景与实体设计师") || prompt.includes("场景库")) return "scenes";
  if (prompt.includes("总策划") || prompt.includes("只规划第")) return "structure";
  return "bible";
}

// RESPONSES 的 structure 需要按提示词中的范围生成对应数量的章节。

const ADVISORY = {
  recommendation: {
    tierLabel: '试水档（20 万字级）',
    totalChapters: 80,
    chapterWords: 2500,
    dailyChapters: 1,
    estimatedDays: 80,
    reason: '核心设定聚焦单一规则，适合紧凑中长篇；新人首本先以 20 万字跑通流程、看 30 章内追读数据，再决定是否续写。',
  },
  milestones: [
    { position: 3, label: '黄金三章', goal: '亮出规则代价：第一次烧记忆换航路推进' },
    { position: 10, label: '首个小高潮', goal: '第一座灯塔点亮，反派势力浮出水面' },
    { position: 30, label: '追读考核点', goal: '第二条规则线展开，主线矛盾升级' },
    { position: 60, label: '中期反转', goal: '母亲真相与灯约裂痕的关系揭示' },
    { position: 80, label: '第一卷大高潮', goal: '母塔对峙，重定首段灯约' },
  ],
  volumeSkeleton: [
    { title: '卷一·燃忆启航', startChapter: 1, endChapter: 40, goal: '建立规则认知与航路目标', climax: '哑言塔对峙' },
    { title: '卷二·塔与真相', startChapter: 41, endChapter: 65, goal: '母亲真相与灯约裂痕', climax: '钥匙刻法揭晓' },
    { title: '卷三·重定灯约', startChapter: 66, endChapter: 80, goal: '守灯人旧部决战', climax: '重定灯约' },
  ],
  notes: [
    '单章控制在 2200-2800 字，章末必留钩子；不要写一万字长章，免费平台吃亏',
    '前三章反复打磨：开书头三天是算法给量窗口',
    '前 30 章建议先存稿 10 章再开始日更，保证不断更',
  ],
};


const BRIEF_DRAFT = {
  audience: '喜欢规则怪谈与成长流的年轻玄幻读者，通勤碎片时间追更，偏好单章一个钩子',
  style: '第三人称限知；短句为主，段落不超过五行；对话占比四成；每章结尾必留悬念钩子',
  boundaries: '不后宫；不洗白主要反派；主角不死；已交出的记忆不可无条件找回；灯塔规则不可自相矛盾',
  sellingPoint: '每点亮一座灯塔就要交出一段记忆——前进本身即是代价',
  conflict: '林昭要保航路开放，守灯人旧部要夺回灯约把雾海重新锁死',
  protagonistGoal: '修好母亲的雾灯驶出雾海；失败则航路永闭、同伴失散',
  ending: '主角重定灯约、雾海退去；代价是与灯灵的联结永久断开',
};

const STYLE_ANALYSIS = {
  name: "雾港留白",
  authorAlias: "听潮客",
  contentSummary: "主人公在雨夜穿过旧城，携带一封信走向尚未揭晓的会面。",
  styleSummary: "第三人称限知，短句与中短段落交替；以雨、灯与脚步等感官细节承载克制情绪，对白节省，转折留白，节奏安静但持续蓄压。",
  styleGuide: "使用第三人称限知；句子以短句和中句为主；每段只推进一个动作或感受；优先写可听见、可触碰的环境细节；对白少而含蓄；重要情绪不要直说，用动作与物件承载；段尾保留轻微悬念。不得复用来源样章的专名、情节、独特比喻或连续原句。",
};

const RESPONSES = {
  style: () => STYLE_ANALYSIS,
  brief: () => BRIEF_DRAFT,
  advisory: () => ADVISORY,
  bible: () => ({
    sections: [
      { kind: "intent", content: "以“点灯需要烧掉记忆”为核心代价的东方玄幻成长流：读者跟随少年点灯人一塔一塔点亮雾海航路，每一步前进都要交出一段过去。" },
      { kind: "world", content: "雾海割裂大陆，只有点灯人的灯船能沿航路穿雾。灯油以记忆为燃料：越舍不得的记忆烧得越亮。灯塔点亮后雾退三十里，形成“明航路”。守灯人旧部想夺回灯约，把航路重新锁进雾里。" },
      { kind: "style", content: "第三人称限知，短句为主，节奏明快；对话口语化，不用书面腔。每章结尾留一个钩子。感官描写以雾、灯光、铃声为主。" },
      { kind: "boundaries", content: "主角不能死亡；不后宫；不洗白主要反派；灯塔规则不可自相矛盾；已交出的记忆不可无条件找回。" },
    ],
    characters: [
      { type: "character", name: "林昭", summary: "继承母亲雾灯的少年点灯人，主角", aliases: ["小点灯人"], profile: { 身份: "点灯人", 目标: "修好雾灯驶出雾海", 秘密: "母亲失踪与灯约有关" } },
      { type: "character", name: "崔衡", summary: "守灯人旧部首脑，想夺回灯约锁死航路", aliases: ["督灯使"], profile: { 身份: "旧部首脑", 目标: "重锁航路" } },
    ],
    entities: [
      { type: "location", name: "拾灯港", summary: "主角出发的港口小城，航路起点", aliases: [], profile: {} },
      { type: "organization", name: "守灯人旧部", summary: "意图锁死航路的旧势力", aliases: [], profile: {} },
      { type: "item", name: "雾灯", summary: "母亲遗留的旧灯，以记忆为灯油", aliases: [], profile: {} },
    ],
  }),
  cast: () => ({
    characters: [
      { name: "林昭", summary: "少年点灯人，为修好母亲的雾灯驶出雾海", aliases: ["小点灯人"], tier: "protagonist", profile: { 身份: "点灯人", 语言习惯: "短句，爱数数", 成长弧线: "从舍不得烧记忆到敢于交出过去" } },
      { name: "崔衡", summary: "守灯人旧部首脑，要夺回灯约", aliases: ["督灯使"], tier: "support", profile: { 身份: "反派", 语言习惯: "官腔" } },
      { name: "秦知微", summary: "灯塔公会见习记录员，暗中协助林昭", aliases: ["秦姑娘"], tier: "support", profile: { 身份: "记录员" } },
      { name: "赵四海", summary: "渡萤号老舵手，林昭的长辈担当", aliases: ["四海叔"], tier: "support", profile: { 身份: "舵手" } },
      { name: "阿莹", summary: "雾灯里的灯灵，只有林昭能听见", aliases: ["灯里的声音"], tier: "recurring", profile: { 出现条件: "灯焰变亮时低语" } },
      { name: "池素秋", summary: "哑言塔塔监，亦敌亦友", aliases: [], tier: "recurring", profile: { 出现条件: "入塔章节" } },
      { name: "燕拂雪", summary: "边塔守塔婆婆，讲述灯约往事", aliases: ["守塔婆婆"], tier: "recurring", profile: { 出现条件: "边塔章节" } },
      { name: "楚青崖", summary: "银帆船队统领，旧部打手", aliases: ["楚统领"], tier: "recurring", profile: { 出现条件: "海上遭遇战" } },
    ],
    extras: ["老周", "青豆", "哑叔", "账房先生", "小满", "陆船匠"],
  }),
  scenes: () => ({
    scenes: [
      { name: "拾灯港", aliases: ["母港"], summary: "航路起点的港口小城", purpose: "主基地与补给", mood: "咸腥海风混着灯油味", visualAnchors: ["褪色的灯约石碑", "七枚铜铃的桅杆", "挂满旧灯壳的杂货铺"], residents: "赵四海、杂货铺老周", dangerLevel: "低" },
      { name: "雾海明航路", aliases: ["灯道"], summary: "灯塔连成的可通行水道", purpose: "进度尺与遭遇战舞台", mood: "两侧雾墙如崖，灯影碎金", visualAnchors: ["三十里一座守望塔", "雾墙上的面孔褶皱", "漂浮的灯油残焰"], residents: "点灯人船队", dangerLevel: "中" },
      { name: "哑言塔", aliases: [], summary: "进塔不可说谎的规则空间", purpose: "前期副本与钥匙线索", mood: "安静得能听见灯芯呼吸", visualAnchors: ["塔身嵌满空灯油盏", "刻着灯约全文的约碑", "半掩的石门"], residents: "塔监池素秋", dangerLevel: "高" },
      { name: "归萤塔", aliases: ["母塔"], summary: "全书终局舞台", purpose: "结局重定灯约之地", mood: "灰雾中一圈永恒微光", visualAnchors: ["无焰主塔", "环形黑岩祭坛", "半埋的旧灯船残骸"], residents: "灯灵", dangerLevel: "高" },
    ],
    entities: [
      { type: "organization", name: "银帆船队", summary: "旧部麾下的拆塔舰队", aliases: [], profile: {} },
      { type: "item", name: "灯约原本", summary: "记载灯约的总契约，认刻不认人", aliases: ["总契约"], profile: {} },
      { type: "term", name: "灯名", summary: "点灯人入塔时报出的记忆之名", aliases: [], profile: {} },
    ],
  }),
  structure: (prompt) => {
    const range = /只规划第\s*(\d+)–(\d+)\s*章/.exec(prompt);
    const start = range ? Number(range[1]) : 1;
    const end = range ? Number(range[2]) : start + 9;
    const titles = ["雾爬上船舷", "灯油是记忆", "报灯名", "七成亮度", "塔外的影子", "渡萤号的旧账", "哑言塔", "塔内无谎", "两盏灯", "第三把火", "拆塔的船", "灯名同源", "钥匙刻法", "旧部的价码", "第四枚铜铃", "残念认亲", "银帆逼近", "边塔火起", "约台现世", "新约之名"];
    return {
      volumes: [
        { title: `卷一·燃忆启航（1-${Math.max(10, end)}章）`, outline: "点亮首段航路，建立记忆代价规则，崔衡势力浮出水面。" },
        { title: `卷二·塔与真相（${Math.max(11, end + 1)}-14章）`, outline: "母塔真相与灯约裂痕。" },
        { title: "卷三·重定灯约（15-20章）", outline: "围剿与反噬，重定新约。" },
      ],
      cycle: {
        goal: "点亮首段航路并建立“记忆即灯油”的规则认知",
        openingState: "林昭在拾灯港继承雾灯，航路未开",
        climax: "哑言塔对峙，钥匙刻法揭晓",
        expectedClosingState: "两塔点亮、航路首段打通；崔衡之名首次浮现，母塔线索到手",
      },
      chapters: Array.from({ length: end - start + 1 }, (_, index) => ({
        position: start + index,
        volumeTitle: "卷一·燃忆启航",
        title: `第${start + index}章 ${titles[(start + index - 1) % titles.length]}`,
        outline: "推进主线一次，写清事件、冲突、结果与章末钩子。林昭为通过关卡交出一段记忆，获得一条新规则或新线索。",
        viewpoint: "林昭",
        characters: index % 2 === 0 ? ["林昭", "赵四海", "阿莹"] : ["林昭", "秦知微", "池素秋"],
        scenes: index < 3 ? ["拾灯港", "雾海明航路"] : ["雾海明航路", "哑言塔"],
        items: ["雾灯"],
        skills: [],
      })),
      proposals: [
        { action: "add", targetType: "term", targetName: "残念", patch: { summary: "被烧记忆凝成的雾中怨物，认得旧主的灯与针脚" }, reason: "哑言塔关卡需要固定规则实体" },
        { action: "update", targetType: "character", targetName: "秦知微", patch: { profile: { 语言习惯: "引用公会条文开头" } }, reason: "对话场景需要稳定的说话方式" },
      ],
    };
  },
};

function sse(res, text) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    "access-control-allow-origin": "*",
  });
  const chars = [...text];
  let index = 0;
  const timer = setInterval(() => {
    if (index < chars.length) {
      const delta = chars.slice(index, index + 6).join("");
      index += 6;
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 4200, completion_tokens: 1800 } })}\n\n`);
      res.write("data: [DONE]\n\n");
      clearInterval(timer);
      res.end();
    }
  }, 60);
}

const server = createServer((req, res) => {
  const cors = {
    "access-control-allow-origin": req.headers.origin ?? "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    return res.end();
  }
  if (!req.url?.includes("/chat/completions")) {
    res.writeHead(404, cors);
    return res.end();
  }
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const payload = JSON.parse(body || "{}");
    const prompt = payload.messages?.[0]?.content ?? "";
    const phase = phaseOf(prompt);
    if (payload.stream)
      return sse(
        res,
        phase === "style" ? JSON.stringify(STYLE_ANALYSIS) : PROSE.repeat(3),
      );
    setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json", ...cors });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(RESPONSES[phase](prompt)) } }],
          usage: { prompt_tokens: 3200, completion_tokens: 2600 },
        }),
      );
    }, 600);
  });
});
const port = Number(process.env.AMY_MOCK_PORT || 8787);
server.listen(port, () => console.log(`demo mock model on http://127.0.0.1:${port}/v1`));
