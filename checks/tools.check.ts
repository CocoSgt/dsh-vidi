/** A missing ffmpeg is a failed run with a reason, never the end of the host. */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NOT_STARTED, spawnTool } from '../src/proc.ts'
import { LiveJob } from '../src/job.ts'

let crashed = ''
process.on('uncaughtException', e => { crashed = e.message })
process.on('unhandledRejection', e => { crashed = String(e) })
process.env.PATH = '/nonexistent'
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

const p = spawnTool('ffmpeg', ['-x'], { stdio: ['pipe', 'pipe', 'pipe', 'pipe'] })
let err = ''; p.stderr!.on('data', d => { err += d })
const code = await new Promise(r => p.on('exit', r))
p.stdin!.write('q'); p.stdin!.end()
assert.equal(code, NOT_STARTED); assert.equal(err, 'tool not found: ffmpeg\n')

const ok = spawnTool(process.execPath, ['-e', 'process.exit(3)'], { stdio: 'ignore' })
assert.equal(await new Promise(r => ok.on('exit', r)), 3)

for (const source of ['device', 'push'] as const) {
  const dir = mkdtempSync(join(tmpdir(), 'job-'))
  const job: any = Object.assign(Object.create(LiveJob.prototype), new EventEmitter(), {
    opts: { source, tgtLangs: [] }, deps: { dir, log() {} }, status: 'running', message: source === 'push' ? 'push-waiting' : undefined,
    hlsName: 'hls', cues: [], recCache: { at: 0, sec: 0 },
  })
  let end: any
  // The real end of a capture, up to the status it leaves.
  job.setStatus = (status: string, message: string) => { job.status = status; end = { status, message } }; job.summary = () => ({})
  job.spawnFfmpeg({ args: ['-i', 'x'], video: '0:v', audio: '0:a' })
  await wait(1300)
  assert.deepEqual(end, { status: 'error', message: 'tool not found: ffmpeg' }, source)
  assert.equal(job.ffmpeg, undefined, `${source}: does not start again and again`)
}
assert.equal(crashed, '')
console.log('tools: ok')
process.exit(0)
