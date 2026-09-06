#!/usr/bin/env node
// author-headless.mjs — 无头创作运行器（实验性工具，不属于产品代码）
//
// 在 Node 里直接加工项目数据包（备份 JSON），绕过浏览器自动化：
//   status    — 各章字数分布报告
//   expand    — 批量替换章节正文（自动重算字数 + 追加版本快照，可在软件里回滚）
//   timeline  — 批量追加时间线（按人物名/章号自动解析 ID）
//   foreshadow— 批量追加伏笔（中文状态自动映射枚举）
//   state     — 批量追加角色状态（数组或 \n 分隔字符串均可）
//   apply     — 一个 manifest 同时做以上全部
//
// 用法示例：
//   node scripts/author-headless.mjs status backups/boxport-backup-v6-expanded.json
//   node scripts/author-headless.mjs expand backups/pkg.json texts.json -o backups/pkg-v7.json
//   node scripts/author-headless.mjs apply backups/pkg.json manifest.json -o backups/pkg-v7.json
//
// 产出的新数据包在软件「导出备份」页用"恢复项目数据包"导入（生成带（恢复）后缀的新作品），
// 或直接作为最新备份归档。详见 docs/AI_AUTHORING_WORKFLOW.md。
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const args = process.argv.slice(2);
const cmd = args[0];
if (!cmd || cmd === "help" || cmd === "--help") usage();

function usage() {
  console.log(`用法: node scripts/author-headless.mjs <命令> <项目包.json> [数据.json] -o <输出.json>
命令: status | expand | timeline | foreshadow | state | apply`);
  process.exit(0);
}

// ---------- 基础工具 ----------
function loadPkg(path) {
  if (!existsSync(path)) die(`项目包不存在: ${path}`);
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  if (pkg.format !== "amy-novel-project") die(`不是 amy-novel-project 包: ${path}`);
  return pkg;
}
function loadJson(path) {
  if (!existsSync(path)) die(`数据文件不存在: ${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}
function die(msg) { console.error("错误: " + msg); process.exit(1); }
function ok(msg) { console.log("✓ " + msg); }
function id(prefix = "") {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  let s = "";
  for (let i = 0; i < 22; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return prefix + s;
}
// 与软件 domain/novel.ts 的 countCjkWords 完全一致：非空白字符数
const wordCount = (content) => content.replace(/\s+/g, "").length;
function outPath(argList) {
  const i = argList.indexOf("-o");
  return i >= 0 ? argList[i + 1] : null;
}

// ---------- status ----------
function cmdStatus(pkg) {
  const byPos = new Map(pkg.chapters.map((c) => [c.position, c]));
  const buckets = new Map();
  for (const c of pkg.chapters) {
    const seg = Math.ceil(c.position / 10) * 10;
    if (!buckets.has(seg)) buckets.set(seg, { n: 0, total: 0, min: Infinity, max: 0 });
    const b = buckets.get(seg);
    b.n++; b.total += c.wordCount;
    b.min = Math.min(b.min, c.wordCount); b.max = Math.max(b.max, c.wordCount);
  }
  console.log(`作品: ${pkg.novel.title} | ${pkg.chapters.length} 章 | 总计 ${pkg.chapters.reduce((s, c) => s + c.wordCount, 0).toLocaleString()} 字`);
  for (const seg of [...buckets.keys()].sort((a, b) => a - b)) {
    const b = buckets.get(seg);
    console.log(`  第${seg - 9}-${String(seg).padEnd(3)}章  平均 ${String(Math.round(b.total / b.n)).padStart(4)}  最小 ${String(b.min).padStart(4)}  最大 ${b.max}`);
  }
  const thin = pkg.chapters.filter((c) => c.wordCount < 2000).length;
  console.log(`  低于 2000 字的章节: ${thin} / ${pkg.chapters.length}`);
}

// ---------- expand ----------
function cmdExpand(pkg, texts) {
  let changed = 0;
  for (const [k, content] of Object.entries(texts)) {
    const pos = Number(k);
    const ch = pkg.chapters.find((c) => c.position === pos);
    if (!ch) { console.warn(`  ! 第${pos}章不存在，跳过`); continue; }
    if (typeof content !== "string" || content.trim().length === 0) { console.warn(`  ! 第${pos}章内容为空，跳过`); continue; }
    // 追加版本快照（origin manual，versionNo 递增），保留回滚能力
    pkg.versions = pkg.versions || [];
    const lastNo = pkg.versions
      .filter((v) => v.chapterId === ch.id)
      .reduce((m, v) => Math.max(m, v.versionNo), 0);
    pkg.versions.push({
      id: id(), chapterId: ch.id, versionNo: lastNo + 1, origin: "manual",
      content: ch.content, wordCount: ch.wordCount, createdAt: new Date().toISOString(),
    });
    ch.content = content;
    ch.wordCount = wordCount(content);
    ch.updatedAt = new Date().toISOString();
    changed++;
  }
  ok(`expand: 更新 ${changed} 章（均已留版本快照）`);
}

// ---------- 引用解析 ----------
function entityByName(pkg) {
  return new Map((pkg.entities || []).map((e) => [e.name, e.id]));
}
function chapterByPos(pkg) {
  return new Map(pkg.chapters.map((c) => [c.position, c]));
}
function resolveParticipants(pkg, names) {
  const map = entityByName(pkg);
  const out = [];
  for (const n of names || []) {
    const eid = map.get(n);
    if (!eid) { console.warn(`  ! 人物「${n}」不在实体表，跳过`); continue; }
    out.push(eid);
  }
  return out;
}

// ---------- timeline ----------
function cmdTimeline(pkg, entries) {
  const chs = chapterByPos(pkg);
  pkg.timeline = pkg.timeline || [];
  let added = 0;
  for (const e of entries) {
    const ch = chs.get(Number(e.chapter));
    if (!ch && e.chapter != null) { console.warn(`  ! 时间线「${e.title}」章节 ${e.chapter} 不存在，chapterId 置空`); }
    const now = new Date().toISOString();
    pkg.timeline.push({
      id: id(), novelId: pkg.novel.id,
      chapterId: ch ? ch.id : null,
      storyTime: e.storyTime || "", title: e.title || "", detail: e.detail || "",
      participantIds: resolveParticipants(pkg, e.participants || []),
      source: "manual", createdAt: now, updatedAt: now,
    });
    added++;
  }
  ok(`timeline: 追加 ${added} 条`);
}

// ---------- foreshadow ----------
const FORESHADOW_STATUS = {
  "待埋设": "planned", "已埋设": "planted", "发展中": "developing",
  "已回收": "resolved", "已放弃": "abandoned",
  planned: "planned", planted: "planted", developing: "developing",
  resolved: "resolved", abandoned: "abandoned",
};
function cmdForeshadow(pkg, entries) {
  const chs = chapterByPos(pkg);
  pkg.foreshadow = pkg.foreshadow || [];
  let added = 0;
  for (const e of entries) {
    const status = FORESHADOW_STATUS[e.status] || "planted";
    const setup = chs.get(Number(e.setupChapter)) || null;
    const payoff = e.payoffChapter != null ? (chs.get(Number(e.payoffChapter)) || null) : null;
    if (e.setupChapter != null && !setup) console.warn(`  ! 伏笔「${e.title}」埋设章节 ${e.setupChapter} 不存在`);
    if (status === "resolved" && !payoff) console.warn(`  ! 伏笔「${e.title}」状态为已回收但缺回收章节`);
    const now = new Date().toISOString();
    pkg.foreshadow.push({
      id: id(), novelId: pkg.novel.id,
      title: e.title || "", detail: e.detail || "",
      setupChapterId: setup ? setup.id : null,
      payoffChapterId: payoff ? payoff.id : null,
      status, source: "manual", createdAt: now, updatedAt: now,
    });
    added++;
  }
  ok(`foreshadow: 追加 ${added} 条`);
}

// ---------- character state ----------
function toArray(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  return String(v).split("\n").map((s) => s.trim()).filter(Boolean);
}
function cmdState(pkg, entries) {
  const ents = entityByName(pkg);
  const chs = chapterByPos(pkg);
  pkg.characterStates = pkg.characterStates || [];
  let added = 0;
  for (const e of entries) {
    const eid = ents.get(e.character);
    if (!eid) { console.warn(`  ! 角色「${e.character}」不在实体表，跳过`); continue; }
    const ch = chs.get(Number(e.chapter));
    if (!ch) { console.warn(`  ! 角色「${e.character}」章节 ${e.chapter} 不存在，跳过`); continue; }
    const now = new Date().toISOString();
    pkg.characterStates.push({
      id: id(), novelId: pkg.novel.id, characterId: eid, chapterId: ch.id,
      summary: e.summary || "", location: e.location || "",
      appearance: e.appearance || "", outfit: e.outfit || "",
      identity: e.identity || "", physical: e.physical || "", emotional: e.emotional || "",
      knowledge: toArray(e.knowledge), goals: toArray(e.goals),
      inventory: toArray(e.inventory), skills: toArray(e.skills),
      source: "manual", createdAt: now, updatedAt: now,
    });
    added++;
  }
  ok(`state: 追加 ${added} 条`);
}

// ---------- apply（manifest 一次全做） ----------
function cmdApply(pkg, manifest) {
  if (manifest.expand) cmdExpand(pkg, manifest.expand);
  if (manifest.timeline) cmdTimeline(pkg, manifest.timeline);
  if (manifest.foreshadow) cmdForeshadow(pkg, manifest.foreshadow);
  if (manifest.state) cmdState(pkg, manifest.state);
}

// ---------- main ----------
const rest = args.slice(1);
const oIdx = rest.indexOf("-o");
const positional = rest.filter((a, i) => i !== oIdx && (oIdx < 0 || i !== oIdx + 1));
const pkgArg = positional[0];
const dataArg = positional[1];
const pkg = loadPkg(pkgArg);

switch (cmd) {
  case "status":
    cmdStatus(pkg);
    break;
  case "expand":
  case "timeline":
  case "foreshadow":
  case "state":
  case "apply": {
    if (!dataArg) die(`需要数据文件（JSON）`);
    const data = loadJson(dataArg);
    if (cmd === "expand") cmdExpand(pkg, data);
    else if (cmd === "timeline") cmdTimeline(pkg, Array.isArray(data) ? data : data.timeline);
    else if (cmd === "foreshadow") cmdForeshadow(pkg, Array.isArray(data) ? data : data.foreshadow);
    else if (cmd === "state") cmdState(pkg, Array.isArray(data) ? data : data.state);
    else cmdApply(pkg, data);
    const o = outPath(rest);
    if (o) {
      pkg.exportedAt = new Date().toISOString();
      writeFileSync(o, JSON.stringify(pkg));
      ok(`已写出: ${o}`);
      cmdStatus(pkg);
    } else {
      console.log("（未指定 -o，未写文件。加 -o backups/xxx.json 产出新包）");
    }
    break;
  }
  default:
    die(`未知命令: ${cmd}`);
}
