import Database from 'better-sqlite3'
import { emptyEfficiency, emptyInsights } from '../shared/types'
import type { SessionInsights, SessionStatus, SessionSummary } from '../shared/types'

interface SessionRow {
  session_id: string
  cwd: string
  project_dir: string
  file_path: string
  git_branch: string | null
  model: string | null
  status: string
  started_at: number | null
  last_activity_at: number | null
  message_count: number
  input_tokens: number
  output_tokens: number
  cache_creation_tokens: number
  cache_read_tokens: number
  context_tokens: number
  context_fraction: number
  cost_usd: number
  title: string | null
  tools_json: string
  commands_json: string
  agents_json: string
  cache_ttl_ms: number
  insights_json: string
}

function parseInsights(json: string | null | undefined): SessionInsights {
  const empty = emptyInsights()
  try {
    const v = JSON.parse(json ?? '{}') as Partial<SessionInsights>
    if (!v || typeof v !== 'object') return empty
    return {
      costParts: { ...empty.costParts, ...v.costParts },
      apiTurns: typeof v.apiTurns === 'number' ? v.apiTurns : 0,
      turns: Array.isArray(v.turns) ? v.turns : [],
      compactionsAt: Array.isArray(v.compactionsAt) ? v.compactionsAt : [],
      cacheRefreshCount: typeof v.cacheRefreshCount === 'number' ? v.cacheRefreshCount : 0,
      cacheRefreshUsd: typeof v.cacheRefreshUsd === 'number' ? v.cacheRefreshUsd : 0,
      composition: {
        ...empty.composition,
        ...v.composition,
        toolChars: v.composition?.toolChars ?? {}
      },
      efficiency: {
        ...emptyEfficiency(),
        ...v.efficiency,
        fileEdits: v.efficiency?.fileEdits ?? {},
        fileReads: v.efficiency?.fileReads ?? {}
      }
    }
  } catch {
    return empty
  }
}

function parseCounts(json: string | null | undefined): Record<string, number> {
  try {
    const v = JSON.parse(json ?? '{}')
    return v && typeof v === 'object' ? (v as Record<string, number>) : {}
  } catch {
    return {}
  }
}

export class SessionStore {
  private db: Database.Database
  private upsertStmt: Database.Statement

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        cwd TEXT NOT NULL,
        project_dir TEXT NOT NULL,
        file_path TEXT NOT NULL,
        git_branch TEXT,
        model TEXT,
        status TEXT NOT NULL,
        started_at INTEGER,
        last_activity_at INTEGER,
        message_count INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        context_tokens INTEGER NOT NULL DEFAULT 0,
        context_fraction REAL NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        title TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_last_activity ON sessions(last_activity_at);
    `)
    // Migrate databases created before tool/command/agent tracking
    const existing = new Set(
      (this.db.pragma('table_info(sessions)') as Array<{ name: string }>).map((c) => c.name)
    )
    for (const col of ['tools_json', 'commands_json', 'agents_json']) {
      if (!existing.has(col)) {
        this.db.exec(`ALTER TABLE sessions ADD COLUMN ${col} TEXT NOT NULL DEFAULT '{}'`)
      }
    }
    if (!existing.has('cache_ttl_ms')) {
      this.db.exec(`ALTER TABLE sessions ADD COLUMN cache_ttl_ms INTEGER NOT NULL DEFAULT 300000`)
    }
    if (!existing.has('insights_json')) {
      this.db.exec(`ALTER TABLE sessions ADD COLUMN insights_json TEXT NOT NULL DEFAULT '{}'`)
    }
    this.upsertStmt = this.db.prepare(`
      INSERT INTO sessions (
        session_id, cwd, project_dir, file_path, git_branch, model, status,
        started_at, last_activity_at, message_count,
        input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
        context_tokens, context_fraction, cost_usd, title,
        tools_json, commands_json, agents_json, cache_ttl_ms, insights_json
      ) VALUES (
        @session_id, @cwd, @project_dir, @file_path, @git_branch, @model, @status,
        @started_at, @last_activity_at, @message_count,
        @input_tokens, @output_tokens, @cache_creation_tokens, @cache_read_tokens,
        @context_tokens, @context_fraction, @cost_usd, @title,
        @tools_json, @commands_json, @agents_json, @cache_ttl_ms, @insights_json
      )
      ON CONFLICT(session_id) DO UPDATE SET
        cwd = excluded.cwd,
        project_dir = excluded.project_dir,
        file_path = excluded.file_path,
        git_branch = excluded.git_branch,
        model = excluded.model,
        status = excluded.status,
        started_at = excluded.started_at,
        last_activity_at = excluded.last_activity_at,
        message_count = excluded.message_count,
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        cache_creation_tokens = excluded.cache_creation_tokens,
        cache_read_tokens = excluded.cache_read_tokens,
        context_tokens = excluded.context_tokens,
        context_fraction = excluded.context_fraction,
        cost_usd = excluded.cost_usd,
        title = excluded.title,
        tools_json = excluded.tools_json,
        commands_json = excluded.commands_json,
        agents_json = excluded.agents_json,
        cache_ttl_ms = excluded.cache_ttl_ms,
        insights_json = excluded.insights_json
    `)
  }

  upsertAll(sessions: SessionSummary[]): void {
    const tx = this.db.transaction((rows: SessionSummary[]) => {
      for (const s of rows) {
        this.upsertStmt.run({
          session_id: s.sessionId,
          cwd: s.cwd,
          project_dir: s.projectDir,
          file_path: s.filePath,
          git_branch: s.gitBranch,
          model: s.model,
          status: s.status,
          started_at: s.startedAt,
          last_activity_at: s.lastActivityAt,
          message_count: s.messageCount,
          input_tokens: s.totals.inputTokens,
          output_tokens: s.totals.outputTokens,
          cache_creation_tokens: s.totals.cacheCreationTokens,
          cache_read_tokens: s.totals.cacheReadTokens,
          context_tokens: s.contextTokens,
          context_fraction: s.contextFraction,
          cost_usd: s.costUsd,
          title: s.title,
          tools_json: JSON.stringify(s.tools),
          commands_json: JSON.stringify(s.commands),
          agents_json: JSON.stringify(s.agents),
          cache_ttl_ms: s.cacheTtlMs,
          insights_json: JSON.stringify(s.insights)
        })
      }
    })
    tx(sessions)
  }

  loadAll(): SessionSummary[] {
    const rows = this.db.prepare('SELECT * FROM sessions').all() as SessionRow[]
    return rows.map((r) => ({
      sessionId: r.session_id,
      cwd: r.cwd,
      projectDir: r.project_dir,
      filePath: r.file_path,
      gitBranch: r.git_branch,
      model: r.model,
      status: r.status as SessionStatus,
      startedAt: r.started_at,
      lastActivityAt: r.last_activity_at,
      messageCount: r.message_count,
      totals: {
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        cacheCreationTokens: r.cache_creation_tokens,
        cacheReadTokens: r.cache_read_tokens
      },
      contextTokens: r.context_tokens,
      contextFraction: r.context_fraction,
      costUsd: r.cost_usd,
      title: r.title,
      tools: parseCounts(r.tools_json),
      commands: parseCounts(r.commands_json),
      agents: parseCounts(r.agents_json),
      cacheTtlMs: r.cache_ttl_ms ?? 300_000,
      insights: parseInsights(r.insights_json)
    }))
  }

  close(): void {
    this.db.close()
  }
}
