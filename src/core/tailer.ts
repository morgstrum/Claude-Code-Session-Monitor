import { createReadStream } from 'fs'
import { stat } from 'fs/promises'

/**
 * Incrementally reads newline-delimited lines from a growing file,
 * tracking a byte offset per file so unchanged content is never re-read.
 * A partial trailing line (no newline yet) is buffered until completed
 * by a later append.
 */
export class FileTailer {
  private offsets = new Map<string, number>()
  private partials = new Map<string, string>()

  /** Byte offset consumed so far for a file (0 if never read) */
  offsetOf(filePath: string): number {
    return this.offsets.get(filePath) ?? 0
  }

  forget(filePath: string): void {
    this.offsets.delete(filePath)
    this.partials.delete(filePath)
  }

  /**
   * Read any new complete lines appended since the last call.
   * Handles truncation (file replaced/shrunk) by restarting from 0.
   */
  async readNewLines(filePath: string): Promise<string[]> {
    let size: number
    try {
      size = (await stat(filePath)).size
    } catch {
      // File deleted between watcher event and read
      this.forget(filePath)
      return []
    }

    let offset = this.offsetOf(filePath)
    if (size < offset) {
      // Truncated or replaced — start over
      offset = 0
      this.partials.delete(filePath)
    }
    if (size === offset) return []

    const chunk = await readRange(filePath, offset, size - 1)
    this.offsets.set(filePath, size)

    const text = (this.partials.get(filePath) ?? '') + chunk
    const lines = text.split('\n')
    // Last element is either '' (text ended with \n) or a partial line
    this.partials.set(filePath, lines.pop() ?? '')

    return lines.filter((l) => l.trim().length > 0)
  }
}

function readRange(filePath: string, start: number, end: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    createReadStream(filePath, { start, end })
      .on('data', (c) => chunks.push(c as Buffer))
      .on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      .on('error', reject)
  })
}
