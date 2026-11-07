import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'

/** Pick a free loopback port. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      srv.close(() => (typeof addr === 'object' && addr ? resolve(addr.port) : reject(new Error('no port'))))
    })
    srv.on('error', reject)
  })
}

/** Wrap 16 kHz mono s16le PCM in a WAV header. */
export function pcmToWav(pcm: Buffer, rate = 16000): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

/**
 * One shared whisper.cpp server with the model resident in memory, so each
 * short chunk costs only inference time. Started lazily, stopped on dispose.
 */
/** whisper.cpp reports language names; the rest of the plugin uses codes. */
const ISO: Record<string, string> = {
  english: 'en', chinese: 'zh', japanese: 'ja', korean: 'ko', spanish: 'es', french: 'fr', german: 'de', portuguese: 'pt', russian: 'ru',
  italian: 'it', arabic: 'ar', hindi: 'hi', indonesian: 'id', vietnamese: 'vi', thai: 'th', turkish: 'tr', dutch: 'nl', polish: 'pl', ukrainian: 'uk',
}

export class WhisperServer {
  private proc?: ChildProcess
  private port?: number
  private starting?: Promise<number>
  private users = 0

  constructor(private readonly model: string, private readonly log: (msg: string) => void) {}

  async acquire(): Promise<number> {
    this.users++
    if (this.port) return this.port
    this.starting ??= this.boot()
    return this.starting
  }

  release(): void {
    this.users = Math.max(0, this.users - 1)
    if (this.users === 0) this.stop()
  }

  private async boot(): Promise<number> {
    const port = await freePort()
    const proc = spawn('whisper-server', ['-m', this.model, '--host', '127.0.0.1', '--port', String(port), '-t', '8', '-nt'], { stdio: ['ignore', 'ignore', 'pipe'] })
    this.proc = proc
    proc.on('exit', code => {
      this.log(`whisper-server exited (${code})`)
      this.proc = undefined
      this.port = undefined
      this.starting = undefined
    })
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`)
        if (res.status < 500) {
          this.port = port
          return port
        }
      } catch {}
      await new Promise(r => setTimeout(r, 300))
    }
    this.stop()
    throw new Error('whisper-server did not start within 60s')
  }

  /** Transcribe one WAV chunk. Returns trimmed text and the detected language if reported. */
  async transcribe(wav: Buffer, lang: string, prompt?: string): Promise<{ text: string; lang?: string; langProb?: number; logprob?: number }> {
    const port = this.port ?? await this.acquire()
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'chunk.wav')
    form.append('temperature', '0')
    form.append('response_format', 'verbose_json')
    form.append('language', lang || 'auto')
    if (prompt) form.append('prompt', prompt)
    const res = await fetch(`http://127.0.0.1:${port}/inference`, { method: 'POST', body: form })
    if (!res.ok) throw new Error(`whisper-server ${res.status}`)
    const body = await res.json() as { text?: string; language?: string; detected_language?: string; detected_language_probability?: number; segments?: { avg_logprob?: number }[] }
    const lps = (body.segments ?? []).map(x => x.avg_logprob).filter((x): x is number => typeof x === 'number')
    return {
      text: (body.text ?? '').replace(/\s+/g, ' ').trim(),
      lang: ISO[body.detected_language ?? body.language ?? ''] ?? body.detected_language ?? body.language,
      langProb: body.detected_language_probability,
      logprob: lps.length ? lps.reduce((a, b) => a + b, 0) / lps.length : undefined,
    }
  }

  stop(): void {
    this.proc?.kill('SIGTERM')
    this.proc = undefined
    this.port = undefined
    this.starting = undefined
  }
}
