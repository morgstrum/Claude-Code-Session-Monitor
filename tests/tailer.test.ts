import { mkdtemp, rm, writeFile, appendFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileTailer } from '../src/core/tailer'

describe('FileTailer', () => {
  let dir: string
  let file: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tailer-test-'))
    file = join(dir, 'session.jsonl')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('reads lines incrementally without re-reading', async () => {
    const tailer = new FileTailer()
    await writeFile(file, 'line1\nline2\n')
    expect(await tailer.readNewLines(file)).toEqual(['line1', 'line2'])
    expect(await tailer.readNewLines(file)).toEqual([])

    await appendFile(file, 'line3\n')
    expect(await tailer.readNewLines(file)).toEqual(['line3'])
  })

  it('buffers partial trailing lines until completed', async () => {
    const tailer = new FileTailer()
    await writeFile(file, 'complete\n{"par')
    expect(await tailer.readNewLines(file)).toEqual(['complete'])

    await appendFile(file, 'tial": true}\n')
    expect(await tailer.readNewLines(file)).toEqual(['{"partial": true}'])
  })

  it('restarts from zero when a file is truncated', async () => {
    const tailer = new FileTailer()
    await writeFile(file, 'a\nb\nc\n')
    await tailer.readNewLines(file)

    await writeFile(file, 'x\n')
    expect(await tailer.readNewLines(file)).toEqual(['x'])
  })

  it('handles deleted files gracefully', async () => {
    const tailer = new FileTailer()
    await writeFile(file, 'a\n')
    await tailer.readNewLines(file)
    await rm(file)
    expect(await tailer.readNewLines(file)).toEqual([])
  })
})
