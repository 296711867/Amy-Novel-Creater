# 数据库设计

> 当前物理 Schema 以 `src/main/db/migrations.ts` 为准。本文同时保留目标模型；尚未落库的
> 表和索引会明确标为“规划”，不能据此宣称功能已经实现。

## 1. 存储原则

- SQLite 是桌面版结构化状态与索引的事实源。
- Markdown/JSON 项目包是用户可读的导出与灾难恢复格式。
- 大正文版本可以保存为压缩文件，数据库记录路径、哈希和元数据；MVP 可先保存 TEXT。
- 所有业务表使用文本 UUID、`created_at`、`updated_at`；时间统一存 UTC ISO 字符串。
- 接受后的版本不可原地覆盖，新修改产生新版本。

## 2. 核心关系

```text
novels 1─N volumes 1─N chapters 1─N scenes
  │                      ├─N chapter_versions
  │                      ├─N chapter_candidates
  ├─1 planning_workflows
  ├─N planning_runs
  ├─N planning_cycles 1─N planning_proposals
  ├─N story_entities     └─N continuity_findings
  ├─N canon_facts
  ├─N timeline_events
  ├─N foreshadow_threads
  └─N generation_batches 1─N generation_jobs
                              ├─N generation_events
                              └─1 context_snapshots
```

## 3. 表定义摘要

### 作品结构

- `novels(id, title, genre, premise, target_words, target_chapters, chapter_words, cycle_size, status, created_at, updated_at)`（`cycle_size` 为滚动规划每批章数，5–15，默认 10；旧库经迁移补列）
- `volumes(id, novel_id, position, title, synopsis, target_words)`
- `chapters(id, volume_id, position, title, outline, status, active_version_id)`
- `scenes(id, chapter_id, position, title, purpose, pov_character_id, outline)`
- `chapter_versions(id, chapter_id, version_no, origin, content, word_count, content_hash, accepted_at)`
- `chapter_candidates(id, chapter_id, generation_job_id, content, status, base_version_id)`
- `planning_workflows(novel_id, brief_json, confirmed_steps_json, updated_at)`
- `workflow_runs(id, novel_id, mode, current_phase, status, checkpoint, config_json, attempt, batch_id, error, created_at, updated_at)`

`planning_workflows` 保存作者原始创作简报与十步向导的连续确认列表；`workflow_runs`
保存 Autopilot 后台运行状态（三档模式、当前阶段、运行/暂停/失败/完成、等待作者的
检查点、批次策略与重试配置、阶段重试计数、挂接的正文批次、错误信息），两者不混用，
避免把人工审核状态和执行状态混在一起。删除作品时运行记录级联清理。

当前滚动策划已使用：

- `planning_runs`：模型、阶段、章节范围、Prompt 哈希、原始响应、一次低温修复响应、累计 Token、状态与错误；
- `planning_proposals`：周期/全局提案、稳定 `target_ref`、补丁、审核状态；旧项目导入时引用随实体新 ID 重映射；
- `planning_cycles`：十章范围、周期状态、目标、开场、高潮、预期和实际结束状态；
- `planning_proposals`：前置实体设定的新增/更新候选、原因与审核状态。

这三类数据均进入完整项目包。规划解析失败不会丢失模型原始响应。

### 故事圣经与正史

- `story_bibles(id, novel_id, kind, content, version_no, is_active)`
- `story_entities(id, novel_id, type, name, aliases_json, profile_json, status)`
- `entity_states(id, entity_id, chapter_id, state_json, source_version_id)`
- `entity_relations(id, novel_id, source_id, target_id, relation_type, detail, valid_from_chapter_id)`
- `canon_facts(id, novel_id, subject_id, predicate, object_text, confidence, source_version_id, status)`
- `timeline_events(id, novel_id, chapter_id, story_time, title, detail, participants_json)`
- `foreshadow_threads(id, novel_id, title, setup_chapter_id, payoff_chapter_id, status, detail)`
- `chapter_summaries(id, chapter_id, version_id, summary, key_events_json)`

每条正史记录必须能追溯到一个已接受章节版本或作者手动变更。

当前可用的动态人物记忆表为 `character_states`，按章节保存摘要、位置、身体、情绪、知识、
目标、道具和技能。通用 `entity_states`、关系版本和章节改写失效传播仍属于下一阶段。

### 生成系统

- `generation_batches(id, novel_id, start_chapter_id, end_chapter_id, status, policy_json, budget_json)`
- `generation_jobs(id, batch_id, chapter_id, position, status, attempt, checkpoint, model_profile_id)`
- `generation_runs(id, job_id, provider, model, prompt_fingerprint, input_tokens, output_tokens, cost, error_json)`
- `generation_events(id, job_id, sequence, type, payload_json, created_at)`
- `context_snapshots(id, job_id, budget_json, sources_json, rendered_text, content_hash)`
- `continuity_findings(id, chapter_id, candidate_id, severity, category, message, evidence_json, disposition)`

### 模型和设置

- `model_profiles(id, provider, name, model_id, base_url, capabilities_json, limits_json, secret_ref)`
- `task_model_routes(id, task_type, model_profile_id, fallback_profile_id)`
- `usage_records(id, novel_id, job_id, provider, model, input_tokens, output_tokens, cached_tokens, cost)`
- `app_settings(key, value_json)`

`secret_ref` 指向 Electron safeStorage/系统凭据中的键，不存明文 Key。

## 4. 索引

- 当前：章节/卷/场景位置唯一索引、章节版本索引、实体类型索引、候选稿时间索引、
  `generation_jobs(batch_id, status, position)` 调度索引，以及规划/连续性常用索引。
- 规划：`canon_facts(novel_id, subject_id, predicate)` 检索索引。
- 规划：按故事时间优化的时间线索引。
- 规划：章节正文、摘要、故事圣经、实体描述和研究资料的 FTS5。

## 5. 迁移与备份

- 当前迁移是进入版本控制的幂等 SQL 列表，启动时通过 libSQL `batch(..., "write")` 执行。
- 当前项目包包含版本号、正文、故事圣经、结构化数据和版本链；导入先做 Zod 校验，再以
  新作品写入并重映射跨表 ID，不覆盖原项目。
- 规划：大迁移前自动创建数据库快照。
- 规划：为未来含外部资源的项目包增加 manifest 哈希与临时区原子切换。
