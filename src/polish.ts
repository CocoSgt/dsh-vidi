import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Glossary, TermChange } from './glossary.ts'
import { LANGS, type LlmHandle } from './translate.ts'
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
  /** A line came back polished. */
  onLine: (cue: Cue, src: string, tr: Record<string, string>, speaker?: string) => void
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

  constructor(private readonly deps: PolishDeps) {}

  /** Lines waiting to be polished (for pacing). */
  get backlog(): number {
    return this.pending.length
  }

  add(cue: Cue): void {
    if (!cue.src.trim()) return
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
    while (this.busy || this.pending.length) {
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
    const targets = this.deps.targets()
    const names = targets.map(t => `"${t}" (${LANGS[t] ?? t})`).join(', ')
    const system = [
      'You polish live speech-recognition subtitles and maintain the glossary for this video.',
      'Fix misheard words (names, terms, homophones) using the video background, the glossary, the site\'s own subtitles and the surrounding lines. Otherwise keep the speaker\'s words: do not rewrite, summarise, merge or split lines; keep every id.',
      targets.length ? `Translate each fixed line into: ${names}, as natural, concise subtitles.` : 'No translation is needed.',
      'Subtitle style for every line: no full stop at the end (。 or .); keep commas inside, and ? or ! where meant.',
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
    const { provider, model } = handle.selection()
    const asm = new BlockAssembler()
    for await (const chunk of handle.stream({
      provider, model, system, maxTokens: 800 + batch.length * 120 * Math.max(1, targets.length + 1), purpose: 'live-polish',
      messages: [createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'dsh-live' } })],
    })) asm.push(chunk as never)
    const out = asm.blocks().filter((b: { type: string }) => b.type === 'text').map((b: { type: string; text?: string }) => b.text ?? '').join('')
    const m = out.match(/\{[\s\S]*\}/)
    if (!m) { this.deps.log(`polish: no JSON (${out.slice(0, 120)})`); this.done.push(...batch); return }
    let res: { lines?: { id?: number; src?: string; tr?: Record<string, string>; speaker?: string }[]; glossary?: TermChange }
    try { res = JSON.parse(m[0]) } catch { this.deps.log('polish: bad JSON'); this.done.push(...batch); return }
    for (const line of res.lines ?? []) {
      const cue = batch.find(c => c.id === line.id)
      if (!cue || typeof line.src !== 'string' || !line.src.trim()) continue
      const tr: Record<string, string> = {}
      for (const t of targets) if (typeof line.tr?.[t] === 'string') tr[t] = line.tr[t]!
      this.deps.onLine(cue, line.src.trim(), tr, typeof line.speaker === 'string' && line.speaker.trim() ? line.speaker.trim().slice(0, 40) : undefined)
    }
    if (res.glossary) this.deps.glossary.apply(res.glossary)
    this.done.push(...batch)
    if (this.done.length > 40) this.done.splice(0, this.done.length - 40)
  }
}
