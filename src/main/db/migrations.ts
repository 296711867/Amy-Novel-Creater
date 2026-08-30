import type { Client } from "@libsql/client";

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS novels (id TEXT PRIMARY KEY, title TEXT NOT NULL, genre TEXT NOT NULL, premise TEXT NOT NULL, target_words INTEGER NOT NULL, target_chapters INTEGER NOT NULL, chapter_words INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS chapters (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE, position INTEGER NOT NULL, title TEXT NOT NULL, outline TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, target_words INTEGER NOT NULL, content TEXT NOT NULL DEFAULT '', word_count INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, UNIQUE(novel_id, position))`,
  `CREATE TABLE IF NOT EXISTS chapter_versions (id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE, version_no INTEGER NOT NULL, origin TEXT NOT NULL, content TEXT NOT NULL, word_count INTEGER NOT NULL, created_at TEXT NOT NULL, UNIQUE(chapter_id, version_no))`,
  `CREATE INDEX IF NOT EXISTS chapters_novel_order ON chapters(novel_id, position)`,
  `CREATE INDEX IF NOT EXISTS versions_chapter_order ON chapter_versions(chapter_id, version_no DESC)`,
  `CREATE TABLE IF NOT EXISTS story_bibles (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE, kind TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', version_no INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, UNIQUE(novel_id, kind))`,
  `CREATE TABLE IF NOT EXISTS story_entities (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE, type TEXT NOT NULL, name TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', aliases_json TEXT NOT NULL DEFAULT '[]', profile_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS story_entities_novel_type ON story_entities(novel_id, type, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS timeline_events (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, chapter_id TEXT, story_time TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', participant_ids_json TEXT NOT NULL DEFAULT '[]', source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS foreshadow_threads (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', setup_chapter_id TEXT, payoff_chapter_id TEXT, status TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS character_states (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, character_id TEXT NOT NULL, chapter_id TEXT, summary TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', physical TEXT NOT NULL DEFAULT '', emotional TEXT NOT NULL DEFAULT '', knowledge_json TEXT NOT NULL DEFAULT '[]', goals_json TEXT NOT NULL DEFAULT '[]', inventory_json TEXT NOT NULL DEFAULT '[]', source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS timeline_novel_chapter ON timeline_events(novel_id, chapter_id)`,
  `CREATE INDEX IF NOT EXISTS foreshadow_novel_status ON foreshadow_threads(novel_id, status)`,
  `CREATE INDEX IF NOT EXISTS character_states_history ON character_states(novel_id, character_id, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS story_volumes (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE, position INTEGER NOT NULL, title TEXT NOT NULL, outline TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(novel_id, position))`,
  `CREATE TABLE IF NOT EXISTS story_scenes (id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE, position INTEGER NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', viewpoint TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', target_words INTEGER NOT NULL DEFAULT 800, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(chapter_id, position))`,
  `CREATE INDEX IF NOT EXISTS story_scenes_chapter_order ON story_scenes(chapter_id, position)`,
  `CREATE TABLE IF NOT EXISTS context_snapshots (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, chapter_id TEXT NOT NULL, rendered_text TEXT NOT NULL, content_hash TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens_reserved INTEGER NOT NULL, total_budget INTEGER NOT NULL, sources_json TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS context_snapshots_chapter ON context_snapshots(novel_id, chapter_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS usage_records (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, chapter_id TEXT, operation TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cached_tokens INTEGER NOT NULL DEFAULT 0, cost REAL, measurement TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS usage_records_novel_time ON usage_records(novel_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS model_profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, provider TEXT NOT NULL, model_id TEXT NOT NULL, base_url TEXT NOT NULL, context_window INTEGER NOT NULL, input_price REAL, output_price REAL, is_default INTEGER NOT NULL DEFAULT 0, has_secret INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS chapter_candidates (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, chapter_id TEXT NOT NULL, profile_id TEXT NOT NULL, context_hash TEXT NOT NULL, content TEXT NOT NULL, word_count INTEGER NOT NULL, status TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cached_tokens INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS chapter_candidates_chapter ON chapter_candidates(chapter_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS generation_batches (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, status TEXT NOT NULL, policy_json TEXT NOT NULL, output_tokens_used INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS generation_jobs (id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, chapter_id TEXT NOT NULL, position INTEGER NOT NULL, status TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 0, candidate_id TEXT, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, UNIQUE(batch_id, position))`,
  `CREATE INDEX IF NOT EXISTS generation_jobs_queue ON generation_jobs(batch_id,status,position)`,
  `CREATE TABLE IF NOT EXISTS continuity_findings (id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL, chapter_id TEXT NOT NULL, severity TEXT NOT NULL, category TEXT NOT NULL, message TEXT NOT NULL, evidence TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS fact_proposals (id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL, chapter_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS name_pools (novel_id TEXT PRIMARY KEY, genre TEXT NOT NULL, surnames_json TEXT NOT NULL, given_names_json TEXT NOT NULL, used_names_json TEXT NOT NULL, updated_at TEXT NOT NULL)`,
];

export async function runMigrations(client: Client): Promise<void> {
  await client.batch(MIGRATIONS, "write");
  const columns = await client.execute(`PRAGMA table_info(chapters)`);
  if (!columns.rows.some((row) => String(row.name) === "volume_id"))
    await client.execute(`ALTER TABLE chapters ADD COLUMN volume_id TEXT`);
}
