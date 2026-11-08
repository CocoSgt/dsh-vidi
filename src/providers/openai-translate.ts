import type { ProviderCue, SpeechProvider } from '../types.ts'
import { BYTES_PER_SEC } from './chunker.ts'
import { Upsampler } from './openai.ts'

/** Output languages gpt-realtime-translate speaks (the input can be any of 70+). */
export const TRANSLATE_TARGETS = ['es', 'pt', 'fr', 'ja', 'ru', 'zh', 'de', 'ko', 'hi', 'id', 'vi', 'it', 'en']

export interface OpenAITranslateOptions {
  apiKey: string
  model: string
  /** One target language (the first translation line on screen). */
  target: string
  log?: (msg: string) => void
  url?: string
}

/** A piece of streamed text and the audio position (s, run timeline) it came with. */
interface Piece { t: number; text: string }
/** A finished sentence of one stream. */
interface Sentence { text: string; start: number; end: number }

const CJK = /[぀-ヿ㐀-鿿가-힯]/
/** Sentence ends; for CJK targets also the full-width ones. */
const END = /[.!?。！？]["'”’」』)）]*\s*$/
/** Long enough to cut at a comma (characters for CJK, letters otherwise). */
const SOFT_CJK = 22, SOFT_LATIN = 70
/** Never longer than this on one subtitle. */
const HARD_CJK = 34, HARD_LATIN = 110
/** A stream quiet this long ends its sentence (a pause without punctuation). */
const QUIET_SEC = 1.6

/**
 * Builds sentences from one text stream. The service stamps every delta
 * with the audio position it was produced at (elapsed_ms); a sentence's
 * times come from those stamps, so lines line up with the picture without
 * guessing from pauses.
 */
class Stream {
  private open: Piece[] = []
  readonly done: Sentence[] = []
  constructor(private readonly cjk: boolean) {}

  get text(): string { return this.open.map(p => p.text).join('') }
  get start(): number | undefined { return this.open[0]?.t }
  get last(): number | undefined { return this.open.at(-1)?.t }

  add(p: Piece): void {
    // A delta can carry the end of one sentence and the start of the next ("。不过"): split it there.
    const m = /^(.*?[.!?。！？]["'”’」』)）]*)(\s*\S.*)$/s.exec(p.text)
    if (m && !/^\d/.test(m[2]!.trim())) {
      this.push({ t: p.t, text: m[1]! })
      this.close()
      this.add({ t: p.t, text: m[2]! })
      return
    }
    this.push(p)
  }

  private push(p: Piece): void {
    this.open.push(p)
    const text = this.text.trim()
    const len = this.cjk ? Array.from(text).length : text.length
    const soft = this.cjk ? SOFT_CJK : SOFT_LATIN, hard = this.cjk ? HARD_CJK : HARD_LATIN
    if (END.test(text) || (len >= soft && /[,，、;；:：]\s*$/.test(text)) || len >= hard) this.close()
  }

  close(): void {
    const text = this.text.trim()
    if (text) this.done.push({ text, start: this.open[0]!.t, end: this.open.at(-1)!.t })
    this.open = []
  }
}

/**
 * OpenAI live interpretation (gpt-realtime-translate): audio streams in, the
 * source transcript and the translation stream back as text with audio
 * positions, so no separate translation pass is needed. A subtitle is one
 * sentence of translation with the source sentence(s) it renders: the
 * translation trails the speech by one to three seconds (it waits for enough
 * meaning), so source sentences are attached in order as each translated
 * sentence completes.
 */
export class OpenAITranslateProvider implements SpeechProvider {
  readonly name = 'openai-translate'
  readonly translates = true
  private ws?: WebSocket
  private up = new Upsampler()
  private emit?: (cue: ProviderCue) => void
  private onError?: (err: Error) => void
  private stopped = false
  private reconnects = 0
  /** Audio sent so far (s); a session's positions count from `base`. */
  private sent = 0
  private base = 0
  private src = new Stream(false)
  private tr: Stream
  /** Source sentences not yet shown with a translation. */
  private srcUsed = 0
  /** Source characters per translated character, learned as lines pair up (English is about 3× Chinese). */
  private ratio: number
  private seq = 0
  /** End of the last finished line (s): everything before it is on screen. */
  private readyAt = 0
  /** Arrival delay of text after its audio position, for the page (s). */
  private lag = 0
  private connectedAt = 0
  private quiet?: ReturnType<typeof setInterval>

  constructor(private readonly opts: OpenAITranslateOptions) {
    if (!TRANSLATE_TARGETS.includes(opts.target)) {
      throw new Error(`OpenAI live translation speaks only ${TRANSLATE_TARGETS.join(', ')}; choose one of these as the subtitle language, or another engine`)
    }
    const cjk = ['zh', 'ja', 'ko'].includes(opts.target)
    this.tr = new Stream(cjk)
    this.ratio = cjk ? 3.2 : 1
  }

  async start(emit: (cue: ProviderCue) => void, onError: (err: Error) => void): Promise<void> {
    this.emit = emit
    this.onError = onError
    await this.connect()
    // Speech that stops without punctuation still becomes a line.
    this.quiet = setInterval(() => this.settle(), 400)
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = this.opts.url ?? `wss://api.openai.com/v1/realtime/translations?model=${encodeURIComponent(this.opts.model)}`
      const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${this.opts.apiKey}` } } as never)
      this.ws = ws
      let opened = false
      ws.onopen = () => {
        opened = true
        this.reconnects = 0
        // A new session counts its audio from here.
        this.base = this.sent
        this.connectedAt = Date.now()
        this.send({
          type: 'session.update',
          session: { audio: { input: { transcription: { model: 'gpt-realtime-whisper' }, noise_reduction: { type: 'far_field' } }, output: { language: this.opts.target } } },
        })
        resolve()
      }
      ws.onmessage = ev => { try { this.onEvent(JSON.parse(String(ev.data))) } catch {} }
      ws.onerror = () => { if (!opened) reject(new Error('could not reach OpenAI live translation (check the API key and network)')) }
      ws.onclose = ev => {
        if (!opened || this.stopped || this.ws !== ws) return
        this.opts.log?.(`openai-translate: connection closed (${ev.code} ${ev.reason || ''}), reconnecting`)
        this.src.close(); this.tr.close(); this.pair(true)
        if (++this.reconnects > 5) { this.onError?.(new Error('OpenAI live translation keeps dropping')); return }
        setTimeout(() => { if (!this.stopped) this.connect().catch(err => this.onError?.(err as Error)) }, 1000 * this.reconnects)
      }
    })
  }

  private send(event: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(event))
  }

  push(pcm: Buffer): void {
    if (this.stopped) return
    // Everything goes up, silence included: the service keeps its own pace.
    this.send({ type: 'session.input_audio_buffer.append', audio: this.up.push(Buffer.from(pcm)).toString('base64') })
    this.sent += pcm.length / BYTES_PER_SEC
  }

  /** Audio sent but not yet in a finished line. */
  backlog(): number {
    return Math.max(0, this.sent - this.readyAt)
  }

  private onEvent(ev: { type: string; delta?: string; elapsed_ms?: number; error?: { message?: string } }): void {
    if (ev.type === 'session.input_transcript.delta' || ev.type === 'session.output_transcript.delta') {
      const t = this.base + (ev.elapsed_ms ?? 0) / 1000
      // How long after its audio the text arrived (smoothed), for the page and the logs.
      const arrived = this.base + (Date.now() - this.connectedAt) / 1000
      this.lag = this.lag ? this.lag * 0.9 + (arrived - t) * 0.1 : arrived - t
      const piece = { t, text: String(ev.delta ?? '') }
      if (ev.type === 'session.input_transcript.delta') this.src.add(piece)
      else this.tr.add(piece)
      this.pair(false)
      this.draft()
    } else if (ev.type === 'error') {
      this.onError?.(new Error(`OpenAI: ${ev.error?.message ?? 'error'}`))
    }
  }

  /** Close streams that went quiet (a pause without punctuation), then pair what is complete. */
  private settle(): void {
    const now = this.sent
    for (const s of [this.src, this.tr]) if (s.last !== undefined && now - s.last > QUIET_SEC + this.lag) s.close()
    this.pair(false)
    this.draft()
  }

  /**
   * One line per finished translation sentence, with the source sentences
   * that ended by then. With `all`, everything left becomes lines (stopping,
   * reconnecting).
   */
  private pair(all: boolean): void {
    while (this.tr.done.length) {
      const t = this.tr.done.shift()!
      // Source sentences the translation has caught up with (it trails the speech), as many as its
      // length calls for: the speaker is often a sentence ahead, and time alone cannot tell.
      const want = Array.from(t.text).length * this.ratio
      const src: Sentence[] = []
      let len = 0
      while (this.srcUsed < this.src.done.length) {
        const next = this.src.done[this.srcUsed]!
        if (next.end > t.end + 0.5) break
        if (src.length && Math.abs(len + next.text.length - want) >= Math.abs(len - want)) break
        src.push(next); len += next.text.length; this.srcUsed++
      }
      if (src.length) this.ratio = Math.min(6, Math.max(0.5, this.ratio * 0.8 + (len / Math.max(1, Array.from(t.text).length)) * 0.2))
      this.line(t, src)
    }
    if (all) {
      const rest = this.src.done.slice(this.srcUsed)
      this.srcUsed = this.src.done.length
      if (rest.length) this.line(undefined, rest)
    }
  }

  private line(t: Sentence | undefined, src: Sentence[]): void {
    const srcText = src.map(s => s.text).join(' ').trim()
    // The words were spoken a little before the service stamped them.
    const start = Math.max(0, Math.min(t?.start ?? Infinity, src[0]?.start ?? Infinity) - 0.4)
    const end = Math.max(t?.end ?? 0, src.at(-1)?.end ?? 0)
    this.emit?.({
      key: `ot:${this.seq++}`, start, end: Math.max(end, start + 0.8),
      // No source sentence finished yet: the translation shows alone, its source comes with the next line.
      src: srcText, tr: t ? { [this.opts.target]: t.text } : undefined, final: true,
    })
    this.readyAt = Math.max(this.readyAt, end)
  }

  /** The sentence being translated, as a draft line. */
  private draft(): void {
    const tr = this.tr.text.trim()
    if (!tr) return
    const pending = this.src.done.slice(this.srcUsed).map(s => s.text)
    const srcText = [...pending, this.src.text.trim()].filter(Boolean).join(' ')
    const start = Math.max(0, Math.min(this.tr.start ?? Infinity, this.src.done[this.srcUsed]?.start ?? this.src.start ?? Infinity) - 0.4)
    this.emit?.({ key: `ot:${this.seq}`, start, end: Math.max(this.tr.last ?? start, start + 0.8), src: srcText, tr: { [this.opts.target]: tr }, final: false })
  }

  /** Seconds between audio and its text arriving, as measured (for the page). */
  latency(): number {
    return this.lag
  }

  async stop(): Promise<void> {
    // Let the last words come back, then finish everything.
    await new Promise(r => setTimeout(r, 2500))
    if (this.quiet) clearInterval(this.quiet)
    this.src.close(); this.tr.close(); this.pair(true)
    this.stopped = true
    try { this.ws?.close() } catch {}
  }
}
