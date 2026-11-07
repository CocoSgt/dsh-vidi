import type { ProviderCue, SpeechProvider } from '../types.ts'
import { BYTES_PER_SEC, PauseChunker, type Chunk } from './chunker.ts'
import { meaningful } from './local.ts'

export interface OpenAIOptions {
  apiKey: string
  /** Realtime transcription model, e.g. gpt-live-transcribe. */
  model: string
  /** Source language code or 'auto'. */
  lang: string
  /** 'minimal' … 'xhigh': lower shows words sooner, higher is more accurate. */
  delay: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  /** Turn length bounds (seconds) for the client-side pause detector. */
  minSec: number
  maxSec: number
  /** Glossary terms, sent as recognition keywords. */
  keywords?: () => string[]
  log?: (msg: string) => void
  /** Token usage reported by the service, per finished line. */
  onUsage?: (u: { inputTokens?: number; outputTokens?: number }) => void
  /** Override for tests. */
  url?: string
}

const URL_DEFAULT = 'wss://api.openai.com/v1/realtime?intent=transcription'

/** Streaming linear resampler, 16 kHz → 24 kHz s16le mono, continuous across calls. */
class Upsampler {
  private prev = 0
  /** Position of the next output sample, in input samples relative to the first sample of the next call (may be negative: between prev and it). */
  private pos = 0

  push(input: Buffer): Buffer {
    const n = input.length >> 1
    if (n === 0) return Buffer.alloc(0)
    const step = 2 / 3
    const out: number[] = []
    const sample = (i: number) => (i < 0 ? this.prev : input.readInt16LE(i * 2))
    while (this.pos <= n - 1) {
      const i = Math.floor(this.pos)
      const f = this.pos - i
      const a = sample(i), b = sample(i + 1 <= n - 1 ? i + 1 : n - 1)
      out.push(Math.round(a + (b - a) * f))
      this.pos += step
    }
    this.prev = input.readInt16LE((n - 1) * 2)
    this.pos -= n
    const buf = Buffer.alloc(out.length * 2)
    out.forEach((v, k) => buf.writeInt16LE(Math.max(-32768, Math.min(32767, v)), k * 2))
    return buf
  }
}

interface Item { start: number; end: number; text: string; committed: boolean; shown: boolean }

/**
 * OpenAI realtime transcription (gpt-live-transcribe). Audio streams to the
 * server continuously so partial words show up as drafts; the shared pause
 * detector decides where a subtitle ends and commits that turn (or clears it
 * when it was silence). Translation happens afterwards through the harness
 * model, exactly like the local provider.
 */
export class OpenAIProvider implements SpeechProvider {
  readonly name = 'openai'
  readonly translates = false
  private ws?: WebSocket
  private readonly chunker: PauseChunker
  private up = new Upsampler()
  /** PCM received but not yet sent, and the media time of its first byte. */
  private unsent: Buffer = Buffer.alloc(0)
  private unsentStart = 0
  /** Turns committed but not yet acknowledged, oldest first. */
  private commits: { start: number; end: number }[] = []
  private items = new Map<string, Item>()
  /** Completions still owed by the server. */
  private owed = 0
  private sentKeywords = ''
  private emit?: (cue: ProviderCue) => void
  private onError?: (err: Error) => void
  private stopped = false
  private reconnects = 0

  constructor(private readonly opts: OpenAIOptions) {
    this.chunker = new PauseChunker(opts.minSec, opts.maxSec, c => this.onChunk(c))
  }

  async start(emit: (cue: ProviderCue) => void, onError: (err: Error) => void): Promise<void> {
    this.emit = emit
    this.onError = onError
    await this.connect()
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.opts.url ?? URL_DEFAULT, { headers: { Authorization: `Bearer ${this.opts.apiKey}` } } as never)
      this.ws = ws
      let opened = false
      ws.onopen = () => {
        opened = true
        this.reconnects = 0
        this.sentKeywords = ''
        this.configure()
        resolve()
      }
      ws.onmessage = ev => { try { this.onEvent(JSON.parse(String(ev.data))) } catch {} }
      ws.onerror = () => { if (!opened) reject(new Error('could not reach the OpenAI realtime service (check the API key and network)')) }
      ws.onclose = ev => {
        if (!opened || this.stopped || this.ws !== ws) return
        // Sessions end after a while or on network hiccups: reconnect and keep going.
        this.opts.log?.(`openai: connection closed (${ev.code} ${ev.reason || ''}), reconnecting`)
        this.commits = []
        this.owed = 0
        this.finishDangling()
        if (++this.reconnects > 5) { this.onError?.(new Error('OpenAI connection keeps dropping')); return }
        setTimeout(() => { if (!this.stopped) this.connect().catch(err => this.onError?.(err as Error)) }, 1000 * this.reconnects)
      }
    })
  }

  private send(event: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(event))
  }

  /** (Re)send the session settings; keywords follow the glossary as it grows. */
  private configure(): void {
    const keywords = (this.opts.keywords?.() ?? [])
      .map(k => k.replace(/[<>\r\n]/g, ' ').trim()).filter(Boolean).slice(0, 100)
    const sig = keywords.join('|')
    if (this.sentKeywords === sig && this.sentKeywords !== '') return
    this.sentKeywords = sig || ' '
    const transcription: Record<string, unknown> = { model: this.opts.model, delay: this.opts.delay }
    if (keywords.length) transcription.keywords = keywords
    if (this.opts.lang && this.opts.lang !== 'auto') transcription.languages = [this.opts.lang]
    this.send({
      type: 'session.update',
      session: { type: 'transcription', audio: { input: { format: { type: 'audio/pcm', rate: 24000 }, transcription, turn_detection: null } } },
    })
  }

  push(pcm: Buffer): void {
    if (this.stopped) return
    this.unsent = this.unsent.length ? Buffer.concat([this.unsent, pcm]) : pcm
    this.chunker.push(pcm) // may commit/clear turns via onChunk
    this.sendUntil(this.chunker.now)
  }

  /** Send buffered audio up to media time t. */
  private sendUntil(t: number): void {
    const bytes = Math.min(this.unsent.length, Math.max(0, Math.round((t - this.unsentStart) * BYTES_PER_SEC) & ~1))
    if (bytes === 0) return
    const part = this.unsent.subarray(0, bytes)
    this.unsent = this.unsent.subarray(bytes)
    this.unsentStart += bytes / BYTES_PER_SEC
    this.send({ type: 'input_audio_buffer.append', audio: this.up.push(Buffer.from(part)).toString('base64') })
  }

  /** Committed audio still waiting for its transcript, plus the turn being collected. */
  backlog(): number {
    let sec = this.chunker.now - this.chunker.openStart
    for (const it of this.items.values()) if (it.committed) sec += it.end - it.start
    for (const c of this.commits) sec += c.end - c.start
    return sec
  }

  private onChunk({ start, end, level }: Chunk): void {
    this.sendUntil(end)
    if (level < 0.006) {
      // Silence: drop it from the server buffer instead of transcribing it.
      this.send({ type: 'input_audio_buffer.clear' })
      return
    }
    this.configure()
    this.commits.push({ start, end })
    this.owed++
    this.send({ type: 'input_audio_buffer.commit' })
  }

  private item(id: string): Item {
    let it = this.items.get(id)
    if (!it) {
      it = { start: this.chunker.openStart, end: this.chunker.now, text: '', committed: false, shown: false }
      this.items.set(id, it)
    }
    return it
  }

  private show(id: string, it: Item, final: boolean): void {
    if (!final && !meaningful(it.text)) return
    if (final && !meaningful(it.text)) {
      // Nothing worth keeping; a draft already on screen gets its last text.
      if (!it.shown) return
    }
    it.shown = true
    this.emit?.({ key: `oa:${id}`, start: it.start, end: Math.max(it.end, it.start + 0.5), src: it.text.trim(), lang: this.opts.lang === 'auto' ? undefined : this.opts.lang, final })
  }

  private onEvent(ev: { type: string; [k: string]: unknown }): void {
    switch (ev.type) {
      case 'input_audio_buffer.committed': {
        const t = this.commits.shift()
        const it = this.item(String(ev.item_id))
        it.committed = true
        if (t) { it.start = t.start; it.end = t.end }
        if (it.shown) this.show(String(ev.item_id), it, false)
        break
      }
      case 'conversation.item.input_audio_transcription.delta': {
        const id = String(ev.item_id)
        const it = this.item(id)
        it.text += String(ev.delta ?? '')
        if (!it.committed) it.end = this.chunker.now
        this.show(id, it, false)
        break
      }
      case 'conversation.item.input_audio_transcription.completed': {
        const id = String(ev.item_id)
        const it = this.item(id)
        const text = String(ev.transcript ?? '').trim()
        if (text) it.text = text
        const u = ev.usage as { type?: string; input_tokens?: number; output_tokens?: number } | undefined
        if (u && typeof u.input_tokens === 'number') this.opts.onUsage?.({ inputTokens: u.input_tokens, outputTokens: u.output_tokens ?? 0 })
        this.show(id, it, true)
        this.items.delete(id)
        this.owed = Math.max(0, this.owed - 1)
        break
      }
      case 'conversation.item.input_audio_transcription.failed': {
        const id = String(ev.item_id)
        const it = this.items.get(id)
        if (it) this.show(id, it, true)
        this.items.delete(id)
        this.owed = Math.max(0, this.owed - 1)
        this.opts.log?.(`openai: transcription failed for one line: ${JSON.stringify(ev.error ?? '')}`)
        break
      }
      case 'error': {
        const err = (ev.error ?? {}) as { message?: string; code?: string }
        // Committing an (almost) empty buffer is harmless.
        if (/empty|too small|buffer_too_small/i.test(`${err.code} ${err.message}`)) { this.commits.shift(); this.owed = Math.max(0, this.owed - 1); break }
        this.onError?.(new Error(`OpenAI: ${err.message ?? 'error'}`))
        break
      }
    }
  }

  /** Finalise drafts whose completion will never arrive (connection lost or stopping). */
  private finishDangling(): void {
    for (const [id, it] of this.items) this.show(id, it, true)
    this.items.clear()
  }

  async stop(): Promise<void> {
    this.chunker.flush(0.5)
    this.sendUntil(this.chunker.now)
    // Give the server a moment to return the last lines.
    for (let i = 0; i < 60 && this.owed > 0 && this.ws?.readyState === WebSocket.OPEN; i++) await new Promise(r => setTimeout(r, 100))
    this.stopped = true
    this.finishDangling()
    try { this.ws?.close() } catch {}
  }
}

/** Check a key without spending anything: list models. */
export async function verifyOpenAIKey(key: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) })
    if (r.ok) return { ok: true }
    const body = await r.json().catch(() => ({})) as { error?: { message?: string } }
    return { ok: false, message: body.error?.message ?? `HTTP ${r.status}` }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}
