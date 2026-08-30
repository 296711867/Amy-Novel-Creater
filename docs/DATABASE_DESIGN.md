# 数据库设计

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

- `novels(id, title, genre, premise, target_words, target_chapters, status, settings_json)`
- `volumes(id, novel_id, position, title, synopsis, target_words)`
- `chapters(id, volume_id, position, title, outline, status, active_version_id)`
- `scenes(id, chapter_id, position, title, purpose, pov_character_id, outline)`
- `chapter_versions(id, chapter_id, version_no, origin, content, word_count, content_hash, accepted_at)`
- `chapter_candidates(id, chapter_id, generation_job_id, content, status, base_version_id)`

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

- `(volume_id, position)`、`(chapter_id, version_no)` 唯一索引。
- `generation_jobs(batch_id, status, position)` 调度索引。
- `canon_facts(novel_id, subject_id, predicate)` 检索索引。
- `timeline_events(novel_id, story_time)` 时间索引。
- FTS5：章节正文、摘要、故事圣经、实体描述和研究资料。

## 5. 迁移与备份

- Drizzle migration 文件进入版本控制，启动时在事务中迁移。
- 大迁移前创建数据库快照。
- 项目导出包含 manifest、正文、故事圣经、结构化 JSON、资源和版本号。
- 导入先校验 manifest 与哈希，再写入临时区，成功后原子切换。
