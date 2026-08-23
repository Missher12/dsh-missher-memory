import { DatabaseSync } from 'node:sqlite'

export interface MemoryFixtureRow {
  recordId: string
  sessionKey: string
  content: string
  kind?: string | undefined
  recordedAt?: string | undefined
  source: 'l0' | 'l1'
}

/** Creates a synthetic database containing no real user memory. */
export function createMemoryDatabase(path: string, rows: readonly MemoryFixtureRow[]): void {
  const database = new DatabaseSync(path)
  database.exec(`
    CREATE TABLE l1_records (
      record_id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      type TEXT,
      priority INTEGER,
      scene_name TEXT,
      session_key TEXT NOT NULL,
      session_id TEXT,
      timestamp TEXT,
      created_time TEXT,
      updated_time TEXT,
      metadata_json TEXT
    );
    CREATE VIRTUAL TABLE l1_fts USING fts5(record_id UNINDEXED, content);
    CREATE TABLE l0_conversations (
      record_id TEXT PRIMARY KEY,
      session_key TEXT NOT NULL,
      session_id TEXT,
      role TEXT,
      message_text TEXT NOT NULL,
      recorded_at TEXT,
      timestamp TEXT
    );
    CREATE VIRTUAL TABLE l0_fts USING fts5(record_id UNINDEXED, message_text);
  `)

  const insertL1 = database.prepare(`
    INSERT INTO l1_records (record_id, content, type, session_key, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `)
  const indexL1 = database.prepare('INSERT INTO l1_fts (record_id, content) VALUES (?, ?)')
  const insertL0 = database.prepare(`
    INSERT INTO l0_conversations (record_id, session_key, role, message_text, recorded_at)
    VALUES (?, ?, 'assistant', ?, ?)
  `)
  const indexL0 = database.prepare('INSERT INTO l0_fts (record_id, message_text) VALUES (?, ?)')

  for (const row of rows) {
    if (row.source === 'l1') {
      insertL1.run(row.recordId, row.content, row.kind ?? 'memory', row.sessionKey, row.recordedAt ?? null)
      indexL1.run(row.recordId, row.content)
    } else {
      insertL0.run(row.recordId, row.sessionKey, row.content, row.recordedAt ?? null)
      indexL0.run(row.recordId, row.content)
    }
  }
  database.close()
}
