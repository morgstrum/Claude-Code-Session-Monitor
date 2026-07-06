import chokidar, { FSWatcher } from 'chokidar'
import { homedir } from 'os'
import { join } from 'path'
import { SessionAggregator, originForFile } from '../core/aggregator'
import { parseLine } from '../core/parser'
import { FileTailer } from '../core/tailer'
import type { SessionsSnapshot } from '../shared/types'
import { SessionStore } from './db'

const PUSH_DEBOUNCE_MS = 250
const PERSIST_INTERVAL_MS = 15_000
/** Re-emit snapshots on a timer so status flips from running -> completed without file activity */
const STATUS_TICK_MS = 30_000

export class SessionMonitor {
  readonly projectsRoot: string
  private aggregator = new SessionAggregator()
  private tailer = new FileTailer()
  private store: SessionStore
  private watcher: FSWatcher | null = null
  private listeners = new Set<(snap: SessionsSnapshot) => void>()
  private pushTimer: NodeJS.Timeout | null = null
  private persistTimer: NodeJS.Timeout | null = null
  private tickTimer: NodeJS.Timeout | null = null
  /** serialize reads per file so overlapping change events can't interleave lines */
  private pending = new Map<string, Promise<void>>()

  constructor(dbPath: string, projectsRoot: string = join(homedir(), '.claude', 'projects')) {
    this.projectsRoot = projectsRoot
    this.store = new SessionStore(dbPath)
  }

  async start(): Promise<void> {
    // Seed from persisted rows: covers sessions whose transcripts were purged.
    // Sessions whose transcript still exists are re-parsed from disk, and the
    // fresh parse shadows the stored row inside the aggregator.
    for (const s of this.store.loadAll()) this.aggregator.restore(s)

    this.watcher = chokidar.watch(this.projectsRoot, {
      ignored: (path, stats) => !!stats?.isFile() && !path.endsWith('.jsonl'),
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 }
    })
    this.watcher.on('add', (p) => this.enqueue(p))
    this.watcher.on('change', (p) => this.enqueue(p))
    this.watcher.on('unlink', (p) => this.tailer.forget(p))

    await new Promise<void>((resolve) => this.watcher!.once('ready', () => resolve()))

    this.persistTimer = setInterval(() => this.persist(), PERSIST_INTERVAL_MS)
    this.tickTimer = setInterval(() => this.push(), STATUS_TICK_MS)
    this.schedulePush()
  }

  snapshot(): SessionsSnapshot {
    return { sessions: this.aggregator.snapshot(), generatedAt: Date.now() }
  }

  /** Resolves once every queued file ingest (including ones added meanwhile) has settled */
  async idle(): Promise<void> {
    for (;;) {
      const batch = [...this.pending.values()]
      await Promise.all(batch)
      const after = [...this.pending.values()]
      if (after.length === batch.length && after.every((p, i) => p === batch[i])) break
    }
  }

  onUpdate(listener: (snap: SessionsSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async stop(): Promise<void> {
    if (this.pushTimer) clearTimeout(this.pushTimer)
    if (this.persistTimer) clearInterval(this.persistTimer)
    if (this.tickTimer) clearInterval(this.tickTimer)
    await this.watcher?.close()
    this.persist()
    this.store.close()
  }

  private enqueue(filePath: string): void {
    const origin = originForFile(this.projectsRoot, filePath)
    if (!origin) return
    const prev = this.pending.get(filePath) ?? Promise.resolve()
    const next = prev
      .then(() => this.ingest(filePath))
      .catch((err) => console.error(`[monitor] failed to ingest ${filePath}:`, err))
    this.pending.set(filePath, next)
  }

  private async ingest(filePath: string): Promise<void> {
    const origin = originForFile(this.projectsRoot, filePath)
    if (!origin) return
    const lines = await this.tailer.readNewLines(filePath)
    if (lines.length === 0) return
    for (const line of lines) {
      const record = parseLine(line)
      if (record) this.aggregator.apply(origin, record)
    }
    this.schedulePush()
  }

  private schedulePush(): void {
    if (this.pushTimer) return
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null
      this.push()
    }, PUSH_DEBOUNCE_MS)
  }

  private push(): void {
    const snap = this.snapshot()
    for (const l of this.listeners) l(snap)
  }

  private persist(): void {
    try {
      this.store.upsertAll(this.aggregator.snapshot())
    } catch (err) {
      console.error('[monitor] failed to persist sessions:', err)
    }
  }
}
