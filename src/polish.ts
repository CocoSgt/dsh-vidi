import { alike, misnumbered, suspects } from './align.ts'
import { ask, AskError, jsonIn } from './ask.ts'
import type { Glossary, TermChange } from './glossary.ts'
import { LANGS, translateLine, type LlmHandle } from './translate.ts'
import type { Cue } from './types.ts'

export interface PolishDeps {
  llm: () => LlmHandle | undefined
  glossary: Glossary
  log: (msg: string) => void
  /** Background about the video: page title, channel, tags, chapters, description, top comments. */
  brief: () => string
  /** The site's own subtitles around a time range (may be wrong or misaligned). */
  siteText: (from: number, to: number) => { lang: string; auto: boolean; text: string }[]
  targets: () => string[]
  /** A still of the picture at a media time (for models that read images). */
  still?: (at: number) => Promise<Buffer | undefined>
  /** A line came back polished. */
  onLine: (cue: Cue, src: string, tr: Record<string, string>, speaker?: string) => void
  /** The video is being closed: give up what is under way. */
  signal?: AbortSignal
}

const CLOCK = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const BATCH = 8
const MAX_WAIT_MS = 25_000

/**
 * Polishing: finished lines are re-read in small batches with context — the
 * video brief, the glossary, the site's subtitles and the lines before — to
 * fix misheard words and re-translate. The same call maintains the glossary:
 * names and terms confirmed by polished text, spelling variants merged under
 * one form (wrong forms kept as aliases), earlier mistakes corrected. So the
 * glossary only exists after some polishing, and keeps improving.
 */
export class Polisher {
  private pending: Cue[] = []
  private done: Cue[] = []
  private busy: Promise<void> | undefined
  private firstWaitAt = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  /** No picture to show (audio, or frames failed once): stop trying. */
  private audioOnly = false

  constructor(private readonly deps: PolishDeps) {}

  /** Lines waiting to be polished (for pacing). */
  get backlog(): number {
    return this.pending.length
  }

  add(cue: Cue): void {
    if (!cue.src.trim() || this.deps.signal?.aborted) return
    this.pending.push(cue)
    if (this.pending.length === 1) this.firstWaitAt = Date.now()
    this.kick()
  }

  private kick(): void {
    if (this.busy) return
    const due = this.pending.length >= BATCH || (this.pending.length > 0 && Date.now() - this.firstWaitAt >= MAX_WAIT_MS)
    if (due) { void this.runBatch(); return }
    if (this.pending.length && !this.timer) {
      this.timer = setTimeout(() => { this.timer = undefined; this.kick() }, MAX_WAIT_MS - (Date.now() - this.firstWaitAt) + 50)
    }
  }

  /** Polish whatever is left (end of a run). */
  async flush(): Promise<void> {
    while ((this.busy || this.pending.length) && !this.deps.signal?.aborted) {
      if (this.busy) await this.busy
      else await this.runBatch()
    }
  }

  private runBatch(): Promise<void> {
    const batch = this.pending.splice(0, BATCH)
    this.firstWaitAt = Date.now()
    this.busy = this.polish(batch).catch(err => this.deps.log(`polish: ${(err as Error).message}`)).finally(() => {
      this.busy = undefined
      this.kick()
    })
    return this.busy
  }

  private async polish(batch: Cue[]): Promise<void> {
    const handle = this.deps.llm()
    if (!handle || !batch.length) return
    await this.part(handle, batch, 0)
    this.done.push(...batch)
    if (this.done.length > 40) this.done.splice(0, this.done.length - 40)
  }

  /** Polish some lines in one request; what comes back is checked line by line against its id. */
  private async part(handle: LlmHandle, batch: Cue[], depth: number): Promise<void> {
    const targets = this.deps.targets()
    const names = targets.map(t => `"${t}" (${LANGS[t] ?? t})`).join(', ')
    const system = [
      'You polish live speech-recognition subtitles and maintain the glossary for this video.',
      'A frame from the video in this stretch may be attached: use what is on screen (names, titles, slides, captions, products) to fix words and to confirm glossary entries.',
      'Fix misheard words (names, terms, homophones) using the video background, the glossary, the site\'s own subtitles and the surrounding lines. Otherwise keep the speaker\'s words: do not rewrite, summarise, merge or split lines; keep every id.',
      targets.length ? `Translate each fixed line into: ${names}, as natural, concise subtitles. Each translation covers exactly the words of its own id: never join two lines into one translation or move part of a line to the next, even when a sentence runs across lines.` : 'No translation is needed.',
      'Speaker: say who says each line — a name when the background or context makes it clear (host, guest, a named person), otherwise "Speaker 1", "Speaker 2"… consistent with the earlier lines; if only one person talks, use the same label throughout.',
      'Glossary: keep names and terms that must stay consistent — people, groups, places, products, titles, jargon, and words recognition keeps getting wrong. Merge spelling variants under one correct form and list the wrong forms as aliases. Only add what the text or background confirms; correct or remove earlier entries when new evidence shows they were wrong. Skip ordinary words, and skip entries whose translation equals the source unless they have aliases. Return only changes.',
      `Reply with JSON only: {"lines":[{"id":1,"speaker":"…","src":"…"${targets.length ? `,"tr":{${targets.map(t => `"${t}":"…"`).join(',')}}` : ''}}],"glossary":{"set":[{"src":"correct form","aliases":["misheard form"],"tr":{"<lang>":"…"},"note":"who/what, short"}],"remove":["src"]}}`,
    ].join('\n')
    const from = batch[0]!.start, to = batch.at(-1)!.end
    const site = this.deps.siteText(from, to)
    const text = [
      // Stable first (cache-friendly): background, then glossary, then the moving parts.
      this.deps.brief() ? `Video background (from the page; may contain spelling of names):\n${this.deps.brief()}\n` : '',
      `Glossary so far:\n${this.deps.glossary.forPrompt() || '(empty)'}\n`,
      this.done.length ? `Earlier lines (already polished):\n${this.done.slice(-6).map(c => `- ${c.speaker ? `[${c.speaker}] ` : ''}${c.src}`).join('\n')}\n` : '',
      site.length ? `The site's own subtitles for this stretch (may be wrong or misaligned):\n${site.map(s => `[${s.lang}${s.auto ? ', auto' : ''}] ${s.text}`).join('\n')}\n` : '',
      'Lines to polish:',
      JSON.stringify(batch.map(c => ({ id: c.id, t: CLOCK(c.start), src: c.src, ...(c.tr && targets.length ? { tr: c.tr } : {}) }))),
    ].filter(Boolean).join('\n')
    // The picture in the middle of the stretch, when the model can read images (on-screen names, slides).
    const jpeg = handle.image && this.deps.still && !this.audioOnly ? await this.deps.still((from + to) / 2) : undefined
    if (handle.image && this.deps.still && !jpeg) { this.audioOnly = true; this.deps.log('polish: no picture to show the model') }
    const image = jpeg ? await handle.image!(jpeg).catch(() => undefined) : undefined
    let out: string
    try {
      out = await ask(handle, {
        system, text, image, maxTokens: 800 + batch.length * 120 * Math.max(1, targets.length + 1), purpose: 'live-polish',
        signal: this.deps.signal, log: this.deps.log,
      })
    } catch (err) {
      if (this.deps.signal?.aborted) return
      if (err instanceof AskError && err.empty) return this.smaller(handle, batch, depth, (err as Error).message)
      // The model cannot be reached: the lines stay as recognised (translations are filled in when the run ends).
      this.deps.log(`polish: ${batch.length} lines not polished (${(err as Error).message})`)
      return
    }
    const res = jsonIn<{ lines?: { id?: number; src?: string; tr?: Record<string, string>; speaker?: string }[]; glossary?: TermChange }>(out, '{')
    if (!res || !Array.isArray(res.lines)) return this.smaller(handle, batch, depth, `unreadable answer (${out.slice(0, 80)})`)
    if (misnumbered(batch.map(c => c.id), res.lines.map(l => Number(l?.id)))) return this.smaller(handle, batch, depth, 'answer numbered wrongly')
    const got = new Map<number, { src: string; tr: Record<string, string>; speaker?: string }>()
    // Lines whose returned text is some other line's (the numbering slipped).
    const strangers = new Set<number>()
    for (const line of res.lines) {
      const cue = batch.find(c => c.id === line.id)
      if (!cue || typeof line.src !== 'string' || !line.src.trim()) continue
      const own = alike(line.src, cue.src) >= 0.4
      if (!own) strangers.add(cue.id)
      const tr: Record<string, string> = {}
      for (const t of targets) if (typeof line.tr?.[t] === 'string' && line.tr[t]!.trim()) tr[t] = line.tr[t]!.trim()
      got.set(cue.id, { src: own ? line.src.trim() : cue.src, tr, speaker: typeof line.speaker === 'string' && line.speaker.trim() ? line.speaker.trim().slice(0, 40) : undefined })
    }
    const bad = targets.length ? suspects(batch.map(c => ({ id: c.id, src: got.get(c.id)?.src ?? c.src, tr: got.get(c.id)?.tr })), targets) : new Set<number>()
    for (const id of strangers) bad.add(id)
    if (bad.size) this.deps.log(`polish: ${bad.size} of ${batch.length} lines missing or on the wrong line (ids ${[...bad].join(', ')}), translating them one by one`)
    for (const cue of batch) {
      const g = got.get(cue.id)
      if (g && !bad.has(cue.id)) { this.deps.onLine(cue, g.src, g.tr, g.speaker); continue }
      if (!targets.length) continue
      const src = g?.src ?? cue.src
      const tr = await this.alone(handle, batch, cue, src)
      if (tr || g) this.deps.onLine(cue, src, tr ?? {}, g?.speaker)
    }
    if (res.glossary) this.deps.glossary.apply(res.glossary)
  }

  /** A request that gave nothing usable: once more in two halves, then each line translated on its own. */
  private async smaller(handle: LlmHandle, batch: Cue[], depth: number, why: string): Promise<void> {
    if (batch.length > 1 && depth === 0) {
      this.deps.log(`polish: ${why} for ${batch.length} lines, trying smaller`)
      const mid = Math.ceil(batch.length / 2)
      await this.part(handle, batch.slice(0, mid), 1)
      await this.part(handle, batch.slice(mid), 1)
      return
    }
    this.deps.log(`polish: ${why} for ${batch.length} lines, translating them one by one`)
    if (!this.deps.targets().length) return
    for (const cue of batch) {
      const tr = await this.alone(handle, batch, cue, cue.src)
      if (tr) this.deps.onLine(cue, cue.src, tr)
    }
  }

  /** One line translated on its own, with the lines before it as context. */
  private async alone(handle: LlmHandle, batch: Cue[], cue: Cue, src: string): Promise<Record<string, string> | undefined> {
    if (this.deps.signal?.aborted) return undefined
    const before = [...this.done.slice(-3), ...batch.slice(0, batch.indexOf(cue))].slice(-4)
    try {
      return await translateLine(handle, this.deps.targets(), src, before.map(c => ({ src: c.src, tr: c.tr })), this.deps.glossary.forPrompt(), '', { signal: this.deps.signal, log: this.deps.log })
    } catch (err) {
      if (!this.deps.signal?.aborted) this.deps.log(`polish: line ${cue.id} not translated (${(err as Error).message})`)
      return undefined
    }
  }
}
