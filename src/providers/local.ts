import type { ProviderCue, SpeechProvider } from '../types.ts'
import { pcmToWav, type WhisperServer } from '../whisper.ts'

const RATE = 16000
const BYTES_PER_SEC = RATE * 2
const FRAME = BYTES_PER_SEC / 10 // 100 ms

export interface LocalOptions {
  whisper: WhisperServer
  /** Source language code or 'auto'. */
  lang: string
  /** Shortest chunk worth sending (seconds). */
  minSec: number
  /** Longest chunk before a forced cut (seconds). */
  maxSec: number
  /** Extra recogniser prompt (glossary terms), read per chunk. */
  prompt?: () => string
}

/** RMS of a s16le buffer, 0..1. */
function rms(buf: Buffer): number {
  let sum = 0
  const n = buf.length >> 1
  for (let i = 0; i < n; i++) {
    const v = buf.readInt16LE(i * 2) / 32768
    sum += v * v
  }
  return n ? Math.sqrt(sum / n) : 0
}

/**
 * Local whisper.cpp provider. Buffers PCM, cuts at short pauses (energy-based
 * VAD with an adaptive noise floor) between minSec and maxSec, and transcribes
 * each chunk on the resident whisper-server. Chunks are transcribed strictly
 * in order; the previous text is passed as prompt for continuity.
 */
export class LocalProvider implements SpeechProvider {
  readonly name = 'local'
  readonly translates = false
  private buf = Buffer.alloc(0)
  /** Media time (s) of buf[0]. */
  private bufStart = 0
  private floor = 0.01
  private quietFrames = 0
  private queue: Promise<void> = Promise.resolve()
  private lastText = ''
  private emit?: (cue: ProviderCue) => void
  private onError?: (err: Error) => void
  private stopped = false

  constructor(private readonly opts: LocalOptions) {}

  async start(emit: (cue: ProviderCue) => void, onError: (err: Error) => void): Promise<void> {
    this.emit = emit
    this.onError = onError
    await this.opts.whisper.acquire()
  }

  /** Bytes of buf already examined by the pause detector. */
  private scanned = 0

  push(pcm: Buffer): void {
    if (this.stopped) return
    this.buf = Buffer.concat([this.buf, pcm])
    while (this.scanned + FRAME <= this.buf.length) {
      const level = rms(this.buf.subarray(this.scanned, this.scanned + FRAME))
      // Noise floor follows the quietest recent frames.
      this.floor = level < this.floor ? level : this.floor * 0.995 + level * 0.005
      this.quietFrames = level < Math.max(this.floor * 2.2, 0.004) ? this.quietFrames + 1 : 0
      this.scanned += FRAME
      const sec = this.scanned / BYTES_PER_SEC
      if ((sec >= this.opts.minSec && this.quietFrames >= 3) || sec >= this.opts.maxSec) {
        this.cut(this.scanned)
        this.scanned = 0
      }
    }
  }

  private cut(bytes: number): void {
    const chunk = this.buf.subarray(0, bytes)
    const start = this.bufStart
    const end = start + bytes / BYTES_PER_SEC
    this.buf = this.buf.subarray(bytes)
    this.bufStart = end
    this.quietFrames = 0
    // Skip near-silent chunks: whisper hallucinates on them ("Thank you.").
    if (rms(chunk) < 0.006) return
    const wav = pcmToWav(Buffer.from(chunk))
    this.queue = this.queue.then(async () => {
      if (this.stopped) return
      try {
        const terms = this.opts.prompt?.() ?? ''
        const prompt = [terms && `Glossary: ${terms}.`, this.lastText.slice(-200)].filter(Boolean).join(' ')
        const { text, lang } = await this.opts.whisper.transcribe(wav, this.opts.lang, prompt)
        // Drop empty, bracketed noise tags ([Music], (applause)) and punctuation-only lines.
        if (!text || /^\[.*\]$|^\(.*\)$/.test(text) || !/[\p{L}\p{N}]/u.test(text)) return
        this.lastText = text
        this.emit?.({ start, end, src: text, lang, final: true })
      } catch (err) {
        this.onError?.(err as Error)
      }
    })
  }

  async stop(): Promise<void> {
    if (this.buf.length > BYTES_PER_SEC) this.cut(this.buf.length)
    await this.queue
    this.stopped = true
    this.opts.whisper.release()
  }
}
