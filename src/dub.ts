import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Cue } from './types.ts'

// ── Voices ──

/** Services that speak text: each needs only the key Vidi already knows for it. */
export type VoiceVendor = 'openai' | 'siliconflow' | 'gemini' | 'elevenlabs'
export const VOICE_VENDORS: VoiceVendor[] = ['openai', 'siliconflow', 'gemini', 'elevenlabs']
/** Services that can learn a voice from a recording. */
export const CLONE_VENDORS: VoiceVendor[] = ['siliconflow', 'elevenlabs']

export interface VoicePreset { vendor: VoiceVendor; id: string; zh: string; en: string }

/** A handful of voices per service, described the way people choose them. */
export const PRESETS: VoicePreset[] = [
  { vendor: 'openai', id: 'marin', zh: 'Marin · 女声，自然', en: 'Marin · female, natural' },
  { vendor: 'openai', id: 'cedar', zh: 'Cedar · 男声，自然', en: 'Cedar · male, natural' },
  { vendor: 'openai', id: 'coral', zh: 'Coral · 女声，明亮', en: 'Coral · female, bright' },
  { vendor: 'openai', id: 'ash', zh: 'Ash · 男声，沉稳', en: 'Ash · male, steady' },
  { vendor: 'openai', id: 'sage', zh: 'Sage · 女声，平和', en: 'Sage · female, calm' },
  { vendor: 'openai', id: 'echo', zh: 'Echo · 男声，清亮', en: 'Echo · male, clear' },
  { vendor: 'siliconflow', id: 'anna', zh: 'Anna · 女声，沉稳', en: 'Anna · female, steady' },
  { vendor: 'siliconflow', id: 'bella', zh: 'Bella · 女声，热情', en: 'Bella · female, warm' },
  { vendor: 'siliconflow', id: 'claire', zh: 'Claire · 女声，温柔', en: 'Claire · female, gentle' },
  { vendor: 'siliconflow', id: 'alex', zh: 'Alex · 男声，沉稳', en: 'Alex · male, steady' },
  { vendor: 'siliconflow', id: 'benjamin', zh: 'Benjamin · 男声，低沉', en: 'Benjamin · male, deep' },
  { vendor: 'siliconflow', id: 'david', zh: 'David · 男声，欢快', en: 'David · male, cheerful' },
  { vendor: 'gemini', id: 'Kore', zh: 'Kore · 女声，坚定', en: 'Kore · female, firm' },
  { vendor: 'gemini', id: 'Aoede', zh: 'Aoede · 女声，轻快', en: 'Aoede · female, breezy' },
  { vendor: 'gemini', id: 'Charon', zh: 'Charon · 男声，讲解', en: 'Charon · male, informative' },
  { vendor: 'gemini', id: 'Puck', zh: 'Puck · 男声，活泼', en: 'Puck · male, upbeat' },
  { vendor: 'elevenlabs', id: 'EXAVITQu4vr4xnSDxMaL', zh: 'Sarah · 女声', en: 'Sarah · female' },
  { vendor: 'elevenlabs', id: 'JBFqnCBsd6RMkjVDRZzb', zh: 'George · 男声', en: 'George · male' },
]

/** A voice made from a recording (the user's own, or someone in a video). */
export interface MyVoice {
  id: string
  name: string
  vendor: VoiceVendor
  /** The service's id for it; without one the sample goes along with every request (SiliconFlow). */
  remote?: string
  /** What is said in the sample (some services need it). */
  text: string
  createdAt: number
}

/** 'openai:marin' (a preset) or 'mine:<id>' (made from a recording). */
export type VoiceRef = string

export const SAMPLE_RATE = 24000
const BYTES_PER_SEC = SAMPLE_RATE * 2

/** WAV file around 16-bit mono PCM. */
export function wav(pcm: Buffer, rate = SAMPLE_RATE): Buffer {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8)
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}

/** Raw PCM of a WAV file written by `wav` (or any plain 44-byte-header WAV). */
const pcmOf = (file: Buffer) => file.subarray(44)

/** Run ffmpeg over a buffer (stdin to stdout). */
export function ffmpegBuffer(args: string[], input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    let err = ''
    p.stdout.on('data', d => out.push(d))
    p.stderr.on('data', d => { err = (err + d).slice(-400) })
    p.on('error', reject)
    p.on('exit', code => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(err.trim() || `ffmpeg exited (${code})`))))
    p.stdin.on('error', () => {})
    p.stdin.end(input)
  })
}

/** Faster speech, same pitch (for a line that would run into the next). */
const speedUp = (pcm: Buffer, tempo: number) =>
  ffmpegBuffer(['-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1', '-i', 'pipe:0', '-af', `atempo=${tempo.toFixed(3)}`, '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1', 'pipe:1'], pcm)

/** Cut the silence a service leaves before and after the words (so lines start on time). */
function trimSilence(pcm: Buffer): Buffer {
  const n = Math.floor(pcm.length / 2)
  const loud = (i: number) => Math.abs(pcm.readInt16LE(i * 2)) > 400
  let a = 0, b = n - 1
  while (a < n && !loud(a)) a++
  while (b > a && !loud(b)) b--
  const pad = Math.round(SAMPLE_RATE * 0.04)
  return pcm.subarray(Math.max(0, a - pad) * 2, Math.min(n, b + pad) * 2)
}

const LANG_NAMES: Record<string, string> = { zh: 'Mandarin Chinese', en: 'English', ja: 'Japanese', ko: 'Korean', fr: 'French', de: 'German', es: 'Spanish', ru: 'Russian', pt: 'Portuguese', it: 'Italian' }

export interface SpeakDeps {
  key: (vendor: VoiceVendor) => string | undefined
  base: (vendor: VoiceVendor) => string | undefined
  mine: (id: string) => (MyVoice & { sample?: Buffer }) | undefined
  log: (m: string) => void
}

let geminiTtsModel: string | undefined
async function geminiModel(key: string): Promise<string> {
  if (geminiTtsModel) return geminiTtsModel
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(10_000) })
    const j = await r.json() as { models?: { name: string }[] }
    const names = (j.models ?? []).map(m => m.name.replace(/^models\//, '')).filter(n => /tts/.test(n) && /flash/.test(n))
    // Newest Flash speech model (they are named by version).
    names.sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
    geminiTtsModel = names[0] ?? 'gemini-2.5-flash-preview-tts'
  } catch { geminiTtsModel = 'gemini-2.5-flash-preview-tts' }
  return geminiTtsModel
}

/**
 * Speak `text` (in language `lang`) with a voice: 16-bit mono PCM at 24 kHz,
 * silence at the ends trimmed.
 */
export async function speak(deps: SpeakDeps, voice: VoiceRef, text: string, lang: string): Promise<Buffer> {
  const [kind, id = ''] = voice.split(/:(.*)/s) as [string, string]
  let vendor: VoiceVendor, name = id
  let mine: (MyVoice & { sample?: Buffer }) | undefined
  if (kind === 'mine') {
    mine = deps.mine(id)
    if (!mine) throw new Error('that voice is gone')
    vendor = mine.vendor
  } else vendor = kind as VoiceVendor
  const key = deps.key(vendor)
  if (!key) throw new Error(`no ${vendor} key`)
  const timeout = AbortSignal.timeout(45_000)
  const fail = async (r: Response) => { throw new Error(`${vendor} ${r.status}: ${(await r.text()).slice(0, 200)}`) }
  let pcm: Buffer
  if (vendor === 'openai') {
    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST', signal: timeout, headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: name, input: text, response_format: 'pcm', instructions: `Speak ${LANG_NAMES[lang.split('-')[0]!] ?? 'the language of the text'} like a live interpreter: natural, clear, at an even, brisk pace.` }),
    })
    if (!r.ok) await fail(r)
    pcm = Buffer.from(await r.arrayBuffer())
  } else if (vendor === 'siliconflow') {
    const base = deps.base('siliconflow') ?? 'https://api.siliconflow.cn/v1'
    const model = 'FunAudioLLM/CosyVoice2-0.5B'
    const body: Record<string, unknown> = { model, input: text, response_format: 'pcm', sample_rate: SAMPLE_RATE }
    if (mine?.remote) body.voice = mine.remote
    else if (mine) {
      // Not stored with the service: the sample goes along with the request.
      if (!mine.sample) throw new Error('the recording of that voice is missing')
      body.voice = ''
      body.references = [{ audio: `data:audio/wav;base64,${mine.sample.toString('base64')}`, text: mine.text }]
    } else body.voice = `${model}:${name}`
    const r = await fetch(`${base}/audio/speech`, { method: 'POST', signal: timeout, headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (!r.ok) await fail(r)
    pcm = Buffer.from(await r.arrayBuffer())
  } else if (vendor === 'gemini') {
    const model = await geminiModel(key)
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', signal: timeout, headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Read aloud, naturally and briskly, like an interpreter:\n${text}` }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: name } } } },
      }),
    })
    if (!r.ok) await fail(r)
    const j = await r.json() as { candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[] }
    const part = j.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data)?.inlineData
    if (!part?.data) throw new Error('gemini returned no audio')
    pcm = Buffer.from(part.data, 'base64')
    const rate = Number(/rate=(\d+)/.exec(part.mimeType ?? '')?.[1] ?? SAMPLE_RATE)
    if (rate !== SAMPLE_RATE) pcm = await ffmpegBuffer(['-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', 'pipe:0', '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1', 'pipe:1'], pcm)
  } else {
    const voiceId = mine?.remote ?? name
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=pcm_24000`, {
      method: 'POST', signal: timeout, headers: { 'xi-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5', language_code: lang.split('-')[0] }),
    })
    if (!r.ok) await fail(r)
    pcm = Buffer.from(await r.arrayBuffer())
  }
  if (pcm.length % 2) pcm = pcm.subarray(0, pcm.length - 1)
  return trimSilence(pcm)
}

/** Teach a service a voice from a recording; returns its id there (undefined: it goes along with each request). */
export async function cloneVoice(deps: SpeakDeps, vendor: VoiceVendor, name: string, sample: Buffer, text: string): Promise<string | undefined> {
  const key = deps.key(vendor)
  if (!key) throw new Error(`no ${vendor} key`)
  if (vendor === 'siliconflow') {
    const base = deps.base('siliconflow') ?? 'https://api.siliconflow.cn/v1'
    const r = await fetch(`${base}/uploads/audio/voice`, {
      method: 'POST', signal: AbortSignal.timeout(60_000), headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'FunAudioLLM/CosyVoice2-0.5B', customName: name.replace(/[^\w-]+/g, '').slice(0, 40) || `vidi${Date.now()}`, audio: `data:audio/wav;base64,${sample.toString('base64')}`, text }),
    })
    if (!r.ok) {
      // Saving a voice there needs a verified account: without it, the sample goes along with each line instead.
      deps.log(`siliconflow: voice upload refused (${r.status}: ${(await r.text()).slice(0, 160)}); sending the sample with each line`)
      return undefined
    }
    return ((await r.json()) as { uri?: string }).uri
  }
  if (vendor === 'elevenlabs') {
    const form = new FormData()
    form.append('name', name || 'Vidi voice')
    form.append('files', new Blob([new Uint8Array(sample)], { type: 'audio/wav' }), 'sample.wav')
    const r = await fetch('https://api.elevenlabs.io/v1/voices/add', { method: 'POST', signal: AbortSignal.timeout(60_000), headers: { 'xi-api-key': key }, body: form })
    if (!r.ok) throw new Error(`elevenlabs ${r.status}: ${(await r.text()).slice(0, 200)}`)
    return ((await r.json()) as { voice_id?: string }).voice_id
  }
  throw new Error(`${vendor} cannot learn voices`)
}

/** Voices made from recordings, kept in one folder for every video. */
export class VoiceLibrary {
  constructor(private readonly dir: string) { mkdirSync(dir, { recursive: true }) }
  private get file() { return join(this.dir, 'voices.json') }
  list(): MyVoice[] {
    try { return JSON.parse(readFileSync(this.file, 'utf8')) as MyVoice[] } catch { return [] }
  }
  get(id: string): (MyVoice & { sample?: Buffer }) | undefined {
    const v = this.list().find(x => x.id === id)
    if (!v) return undefined
    const f = this.samplePath(id)
    return { ...v, sample: existsSync(f) ? readFileSync(f) : undefined }
  }
  samplePath(id: string) { return join(this.dir, `${id.replace(/[^\w-]/g, '')}.wav`) }
  add(v: MyVoice, sample: Buffer): void {
    writeFileSync(this.samplePath(v.id), sample)
    writeFileSync(this.file, JSON.stringify([...this.list(), v], null, 2))
  }
  rename(id: string, name: string): void {
    writeFileSync(this.file, JSON.stringify(this.list().map(v => (v.id === id ? { ...v, name } : v)), null, 2))
  }
  remove(id: string): void {
    writeFileSync(this.file, JSON.stringify(this.list().filter(v => v.id !== id), null, 2))
    rmSync(this.samplePath(id), { force: true })
  }
}

// ── Voiceover for one video ──

export interface DubSettings {
  on: boolean
  /** Which subtitle line is spoken (a language code). */
  lang: string
  voice: VoiceRef
  /** The original sound under the voice: turned down while the voice speaks, or off. */
  original: 'duck' | 'off'
}

/** A line's voice: where it plays (media s), how long, and a version for the page's cache. */
export interface DubClip { id: number; at: number; dur: number; v: string }

export interface DubView extends DubSettings { clips: DubClip[]; error?: string }

interface Stored { text: string; dur: number }

/** How long a line may run into its successor before it is spoken faster (at most this much). */
const MAX_TEMPO = 1.35
/** Lines this far ahead of what is being watched or pushed get their voice made in advance (s). */
const AHEAD = 90
/** A voice that comes in this late (live) still plays, shifted (s). */
export const LATE_MAX = 4

/**
 * The voiceover of one video: each subtitle line in the chosen language is
 * spoken with the chosen voice, kept as a small WAV, and placed at the
 * line's start (after the previous voice, if that one is still talking).
 * Voices are made only around what is being watched or pushed out, so a
 * long video costs only what is played. Events: 'change' (DubView).
 */
export class Dubber extends EventEmitter {
  settings: DubSettings
  private stored = new Map<number, Stored>()
  private storeKey = ''
  private busy = new Set<number>()
  private failed = new Map<number, number>()
  private failures = new Map<number, number>()
  private queueTimer?: ReturnType<typeof setTimeout>
  private changeTimer?: ReturnType<typeof setTimeout>
  /** Media times being watched (the page) and pushed out (restream). */
  private focus = new Map<string, number>()
  private cache = new Map<number, Buffer>()
  private error?: string
  private waiters: { from: number; to: number; done: () => void }[] = []
  /** When each line was first seen finished (polished mode waits a while for its polished text). */
  private seen = new Map<number, number>()
  private recheck?: ReturnType<typeof setTimeout>

  constructor(
    private readonly dir: string,
    settings: DubSettings,
    private readonly cues: () => Cue[],
    private readonly spokenLang: () => string | undefined,
    private readonly polishedMode: () => boolean,
    private readonly speakFn: (voice: VoiceRef, text: string, lang: string) => Promise<Buffer>,
    private readonly onSpoken: (voice: VoiceRef, sec: number) => void,
    private readonly log: (m: string) => void,
  ) {
    super()
    this.settings = settings
    this.load()
  }

  private get folder() { return join(this.dir, 'dub', this.storeKey) }

  /** Clips are kept per language and voice: switching back finds them again. */
  private load(): void {
    this.storeKey = `${this.settings.lang}.${this.settings.voice}`.replace(/[^\w.-]+/g, '_')
    this.stored.clear(); this.cache.clear(); this.failed.clear(); this.failures.clear()
    try { for (const [id, s] of Object.entries(JSON.parse(readFileSync(join(this.folder, 'clips.json'), 'utf8')) as Record<string, Stored>)) this.stored.set(Number(id), s) } catch {}
  }

  private saveIndex(): void {
    mkdirSync(this.folder, { recursive: true })
    writeFileSync(join(this.folder, 'clips.json'), JSON.stringify(Object.fromEntries(this.stored)))
  }

  configure(next: Partial<DubSettings>): void {
    const before = `${this.settings.lang}.${this.settings.voice}`
    this.settings = { ...this.settings, ...next }
    if (`${this.settings.lang}.${this.settings.voice}` !== before) this.load()
    this.error = undefined
    this.failed.clear(); this.failures.clear()
    this.changed(true)
    this.kick()
  }

  /** Where someone is watching ('page') or the push-out is reading ('push'); undefined: gone. */
  setFocus(who: string, at: number | undefined): void {
    if (at === undefined) this.focus.delete(who)
    else this.focus.set(who, at)
    this.kick()
  }

  /** The text a line speaks: its translation, or the line itself when it is already in that language. */
  textFor(cue: Cue): string | undefined {
    if (!cue.final) return undefined
    const lang = this.settings.lang
    const tr = cue.tr?.[lang]?.trim()
    if (tr) return tr
    const spoken = (cue.lang ?? this.spokenLang() ?? '').split('-')[0]
    if (spoken && spoken === lang.split('-')[0] && cue.src.trim()) return cue.src.trim()
    return undefined
  }

  /** A line changed (or came in): its voice may need making again. */
  onCue(): void { this.kick() }

  private kick(): void {
    if (!this.settings.on) return
    clearTimeout(this.queueTimer)
    this.queueTimer = setTimeout(() => void this.fill(), 150)
  }

  /** Is media time t within reach of someone watching or pushing (or a clip being cut)? */
  private wanted(cue: Cue): boolean {
    for (const w of this.waiters) if (cue.end > w.from && cue.start < w.to) return true
    for (const at of this.focus.values()) if (cue.end > at - 5 && cue.start < at + AHEAD) return true
    return false
  }

  private async fill(): Promise<void> {
    if (!this.settings.on) return
    const cues = this.cues().filter(c => c.final)
    const now = Date.now()
    const todo: { cue: Cue; text: string; i: number }[] = []
    let waiting = false
    cues.forEach((cue, i) => {
      if (this.busy.has(cue.id) || (this.failed.get(cue.id) ?? 0) > now) return
      const text = this.textFor(cue)
      if (!text || this.stored.get(cue.id)?.text === text) return
      // Polished mode: wait for the polished line (unless it takes long), so the voice says the final words.
      if (!this.seen.has(cue.id)) this.seen.set(cue.id, now)
      if (this.polishedMode() && !cue.polished && !cue.edited && now - this.seen.get(cue.id)! < 20_000) { waiting = true; return }
      if (!this.wanted(cue)) return
      todo.push({ cue, text, i })
    })
    // Nearest to what is being watched first.
    const focus = [...this.focus.values(), ...this.waiters.map(w => w.from)]
    const dist = (c: Cue) => Math.min(...focus.map(f => (c.start >= f - 2 ? c.start - f : 1000 + f - c.start)), 1e9)
    todo.sort((a, b) => dist(a.cue) - dist(b.cue))
    for (const job of todo) {
      if (this.busy.size >= 3) break
      this.busy.add(job.cue.id)
      void this.make(job.cue, job.text, cues[job.i + 1]).finally(() => { this.busy.delete(job.cue.id); this.kick(); this.checkWaiters() })
    }
    // Lines waiting for polishing: look again in a while even if nothing else happens.
    if (waiting) { clearTimeout(this.recheck); this.recheck = setTimeout(() => this.kick(), 5000) }
    this.checkWaiters()
  }

  private async make(cue: Cue, text: string, next: Cue | undefined): Promise<void> {
    const key = this.storeKey, voice = this.settings.voice
    try {
      let pcm = await this.speakFn(voice, text, this.settings.lang)
      if (key !== this.storeKey) return
      this.onSpoken(voice, pcm.length / BYTES_PER_SEC)
      // Room until the next line (a short pause counts as room); a longer voice is spoken faster.
      const room = next && next.start - cue.end <= 4 ? next.start - cue.start : cue.end - cue.start + 0.8
      const dur = pcm.length / BYTES_PER_SEC
      if (room > 0.5 && dur > room * 1.04) pcm = await speedUp(pcm, Math.min(MAX_TEMPO, dur / room))
      mkdirSync(this.folder, { recursive: true })
      writeFileSync(join(this.folder, `${cue.id}.wav`), wav(pcm))
      this.stored.set(cue.id, { text, dur: pcm.length / BYTES_PER_SEC })
      this.cache.set(cue.id, pcm)
      this.error = undefined
      this.saveIndex()
      this.changed()
    } catch (err) {
      const msg = (err as Error).message
      this.log(`dub: line ${cue.id}: ${msg}`)
      this.failed.set(cue.id, Date.now() + 15_000)
      this.failures.set(cue.id, (this.failures.get(cue.id) ?? 0) + 1)
      if (this.error !== msg) { this.error = msg; this.changed(true) }
    }
  }

  /**
   * Start of the earliest line from `after` on that is still waiting for its voice (a live picture
   * waits for it, as it waits for subtitles); lines that keep failing are given up on.
   */
  waitingFrom(after: number): number | undefined {
    if (!this.settings.on) return undefined
    for (const c of this.cues()) {
      if (!c.final || c.end < after) continue
      const text = this.textFor(c)
      if (!text || this.stored.get(c.id)?.text === text || (this.failures.get(c.id) ?? 0) >= 3) continue
      return c.start
    }
    return undefined
  }

  /** Clips in play order: each at its line's start, or right after the voice before it. */
  clips(): DubClip[] {
    const out: DubClip[] = []
    let end = -Infinity
    for (const cue of this.cues()) {
      if (!cue.final) continue
      const s = this.stored.get(cue.id)
      const text = this.textFor(cue)
      if (!s || !text || s.text !== text) continue
      // After a real pause the voice starts on time again; in a stretch of talk, it never overlaps the one before.
      const at = Math.max(cue.start, end + 0.05)
      end = at + s.dur
      out.push({ id: cue.id, at: Math.round(at * 1000) / 1000, dur: Math.round(s.dur * 1000) / 1000, v: hash(s.text) })
    }
    return out
  }

  view(): DubView {
    return { ...this.settings, clips: this.settings.on ? this.clips() : [], error: this.error }
  }

  private changed(now = false): void {
    clearTimeout(this.changeTimer)
    if (now) { this.emit('change', this.view()); return }
    this.changeTimer = setTimeout(() => this.emit('change', this.view()), 250)
  }

  /** A clip's WAV file (for the page), if made. */
  clipFile(id: number): string | undefined {
    const f = join(this.folder, `${id}.wav`)
    return existsSync(f) ? f : undefined
  }

  private pcm(id: number): Buffer | undefined {
    let b = this.cache.get(id)
    if (!b) {
      const f = this.clipFile(id)
      if (!f) return undefined
      b = pcmOf(readFileSync(f))
      this.cache.set(id, b)
      if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value!)
    }
    return b
  }

  /**
   * The voices mixed for media time [from, to) as 16-bit PCM at 24 kHz.
   * `late`: clips that came in after their time (live) still play from
   * `from` on, once, if not more than LATE_MAX late; pass the same Set on
   * every call of one continuous run.
   */
  mix(from: number, to: number, late?: Set<number>): Buffer {
    const n = Math.max(0, Math.round((to - from) * SAMPLE_RATE))
    const acc = new Int32Array(n)
    for (const c of this.clips()) {
      let at = c.at
      if (late) {
        if (c.at < from && c.at + c.dur > from && !late.has(c.id) && from - c.at <= LATE_MAX) at = from
        if (at < to && at + c.dur > from) late.add(c.id)
      }
      if (at >= to || at + c.dur <= from) continue
      const pcm = this.pcm(c.id)
      if (!pcm) continue
      const start = Math.round((at - from) * SAMPLE_RATE)
      const total = pcm.length / 2
      for (let i = Math.max(0, -start); i < total && start + i < n; i++) acc[start + i]! += pcm.readInt16LE(i * 2)
    }
    const out = Buffer.alloc(n * 2)
    for (let i = 0; i < n; i++) out.writeInt16LE(Math.max(-32768, Math.min(32767, acc[i]!)), i * 2)
    return out
  }

  /** Make the voices for [from, to) now (cutting a clip), waiting up to `ms`. */
  ensure(from: number, to: number, ms = 120_000): Promise<void> {
    if (!this.settings.on) return Promise.resolve()
    return new Promise(resolve => {
      const w = { from, to, done: () => { clearTimeout(timer); this.waiters = this.waiters.filter(x => x !== w); resolve() } }
      const timer = setTimeout(w.done, ms)
      this.waiters.push(w)
      this.kick()
    })
  }

  private checkWaiters(): void {
    for (const w of [...this.waiters]) {
      const missing = this.cues().some(c => c.final && c.end > w.from && c.start < w.to && (this.busy.has(c.id) ||
        (!!this.textFor(c) && this.stored.get(c.id)?.text !== this.textFor(c) && (this.failed.get(c.id) ?? 0) <= Date.now())))
      if (!missing) w.done()
    }
  }
}

function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/**
 * ffmpeg filter that puts the voiceover (input `dub`, 24 kHz mono) over the
 * original sound (input `orig`): the original is pressed down whenever the
 * voice speaks, or left out. Ends at `out`.
 */
export function dubFilter(orig: string, dub: string, original: 'duck' | 'off', out: string): string {
  // Both counted from where they start here (a live recording's sound carries its own clock).
  const voice = `[${dub}]asetpts=PTS-STARTPTS,aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo`
  if (original === 'off') return `${voice}[${out}]`
  return `${voice},asplit=2[dk][dm];[${orig}]asetpts=PTS-STARTPTS,aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[og];` +
    `[og][dk]sidechaincompress=threshold=0.015:ratio=14:attack=8:release=450:makeup=1[od];[od][dm]amix=inputs=2:normalize=0:duration=first[${out}]`
}
