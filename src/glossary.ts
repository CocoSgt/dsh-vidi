import { existsSync, readFileSync, writeFileSync } from 'node:fs'

/** One term: its correct form, wrong forms recognition produced, renderings per target language. */
export interface Term {
  src: string
  /** Misheard / misspelled forms that mean this term. */
  aliases?: string[]
  tr: Record<string, string>
  /** Short note: who or what it is. */
  note?: string
  /** 'user' entries are pinned: the model never overwrites or removes them. */
  origin: 'auto' | 'user'
}

/** Changes the polishing pass returns. */
export interface TermChange {
  set?: { src?: string; aliases?: string[]; tr?: Record<string, string>; note?: string }[]
  remove?: string[]
}

const MAX = 80

/** Does the text mention the term (its correct form or a known wrong one)? Latin words match whole words only. */
function mentions(text: string, t: Term): boolean {
  return [t.src, ...(t.aliases ?? [])].some(w => {
    const k = w.trim().toLowerCase()
    if (!k) return false
    if (!/^[\x00-\x7f]+$/.test(k)) return text.includes(k)
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(^|[^a-z0-9])${esc}($|[^a-z0-9])`).test(text)
  })
}

function readTerms(file?: string): Term[] {
  if (!file || !existsSync(file)) return []
  try { return JSON.parse(readFileSync(file, 'utf8')) as Term[] } catch { return [] }
}

/**
 * Per-video glossary, maintained by the model during polishing (so it only
 * holds terms confirmed by polished text, and gets corrected as polishing
 * goes on). Used by recognition (correct spellings as hints), translation
 * and the next polishing round. Users can correct or remove entries; their
 * entries win and are kept in a shared library for later videos. A library
 * entry joins a video's glossary only once that video mentions it (title,
 * description or subtitles), so one video's names never show up in another.
 */
export class Glossary {
  terms: Term[] = []
  /** Library entries this video has not mentioned yet: not shown, not in any prompt. */
  private shelf: Term[] = []

  constructor(
    private readonly file: string,
    private targets: string[],
    private readonly onChange: (terms: Term[]) => void,
    private readonly log: (msg: string) => void,
    seed: string,
    /** Shared library of user terms (kept across videos). */
    private readonly library?: string,
  ) {
    const lib = readTerms(library).map(t => ({ ...t, origin: 'user' as const }))
    const inLib = (t: Term) => lib.some(x => x.src.toLowerCase() === t.src.toLowerCase())
    // Older versions copied the whole library into every video: those copies wait on the shelf
    // again and come back as soon as this video's text mentions them (see notice()).
    this.terms = readTerms(file).map(t => ({ ...t, origin: t.origin ?? 'auto' })).filter(t => t.origin !== 'user' || !inLib(t))
    this.shelf = lib.filter(t => !this.find(t.src))
    // Plugin setting: lines like "Dots = Dots" or "GPT-6.1 Sol".
    for (const line of seed.split('\n').map(l => l.trim()).filter(Boolean)) {
      const [src, rest] = line.split(/\s*=\s*/)
      if (src && !this.find(src)) this.terms.push({ src, tr: rest ? Object.fromEntries(this.targets.map(t => [t, rest])) : {}, origin: 'user' })
    }
  }

  /** New text from this video (title, description, subtitle lines): bring in the library entries it mentions. */
  notice(text: string): void {
    if (!this.shelf.length || !text) return
    const low = text.toLowerCase()
    const hit = this.shelf.filter(t => mentions(low, t) && !this.find(t.src))
    if (!hit.length) return
    this.shelf = this.shelf.filter(t => !hit.includes(t))
    this.terms.push(...hit)
    this.log(`glossary: ${hit.map(t => t.src).join(', ')} from the library`)
    this.save()
  }

  setTargets(targets: string[]): void {
    this.targets = targets
  }

  private find(src: string): Term | undefined {
    const k = src.trim().toLowerCase()
    return this.terms.find(t => t.src.toLowerCase() === k || t.aliases?.some(a => a.toLowerCase() === k))
  }

  private save(): void {
    try { writeFileSync(this.file, JSON.stringify(this.terms, null, 2)) } catch {}
    this.onChange(this.terms)
  }

  /** Text block for polishing and translation prompts. */
  forPrompt(): string {
    return this.terms.slice(-MAX).map(t => {
      const tr = this.targets.map(l => (t.tr[l] && t.tr[l] !== t.src ? `${l}: ${t.tr[l]}` : '')).filter(Boolean).join('; ')
      const aka = t.aliases?.length ? ` (also heard as: ${t.aliases.join(', ')})` : ''
      return `${t.src}${aka}${tr ? ` → ${tr}` : ''}${t.note ? ` — ${t.note}` : ''}`
    }).join('\n')
  }

  /** Correct spellings, for the speech recogniser's hint. */
  forAsr(): string {
    return this.terms.slice(-40).map(t => t.src).join(', ')
  }

  /** Apply the polishing pass's changes. User entries are never touched. */
  apply(change: TermChange): void {
    let n = 0
    for (const r of change.remove ?? []) {
      const t = typeof r === 'string' ? this.find(r) : undefined
      if (t && t.origin === 'auto') { this.terms = this.terms.filter(x => x !== t); n++ }
    }
    for (const s of change.set ?? []) {
      const src = typeof s.src === 'string' ? s.src.trim() : ''
      if (!src) continue
      const aliases = (Array.isArray(s.aliases) ? s.aliases : []).map(a => String(a).trim()).filter(a => a && a.toLowerCase() !== src.toLowerCase())
      // The canonical form may be new while an alias names an existing entry: merge into it.
      const hit = this.find(src) ?? aliases.map(a => this.find(a)).find(Boolean)
      if (hit?.origin === 'user') continue
      const tr = Object.fromEntries(Object.entries(s.tr ?? {}).filter(([, v]) => typeof v === 'string' && v.trim()))
      if (hit) {
        const old = hit.src
        hit.aliases = [...new Set([...(hit.aliases ?? []), ...aliases, ...(old.toLowerCase() !== src.toLowerCase() ? [old] : [])])].filter(a => a.toLowerCase() !== src.toLowerCase())
        hit.src = src
        hit.tr = { ...hit.tr, ...tr }
        if (s.note) hit.note = s.note
      } else {
        this.terms.push({ src, aliases: aliases.length ? aliases : undefined, tr, note: s.note, origin: 'auto' })
      }
      n++
    }
    // Keep it focused: newest auto entries win when over the cap.
    const autos = this.terms.filter(t => t.origin === 'auto')
    if (autos.length > MAX) { const drop = new Set(autos.slice(0, autos.length - MAX)); this.terms = this.terms.filter(t => !drop.has(t)) }
    if (n) { this.log(`glossary: ${n} change(s), ${this.terms.length} terms`); this.save() }
  }

  /** User correction (also kept in the shared library for later videos). */
  upsert(term: { src: string; tr?: Record<string, string>; aliases?: string[]; note?: string; was?: string }): void {
    const src = term.src.trim()
    if (!src) return
    const existing = (term.was && this.find(term.was)) || this.find(src)
    if (existing) {
      if (existing.src !== src) existing.aliases = [...new Set([...(existing.aliases ?? []), existing.src])].filter(a => a !== src)
      existing.src = src
      existing.tr = { ...existing.tr, ...term.tr }
      if (term.aliases) existing.aliases = term.aliases
      if (term.note !== undefined) existing.note = term.note
      existing.origin = 'user'
    } else this.terms.push({ src, tr: term.tr ?? {}, aliases: term.aliases, note: term.note, origin: 'user' })
    this.save()
    const t = this.find(src)!
    this.shelf = this.shelf.filter(x => x.src.toLowerCase() !== src.toLowerCase())
    this.saveLibrary(lib => [...lib.filter(x => x.src.toLowerCase() !== src.toLowerCase()), { ...t, origin: 'user' }])
  }

  remove(src: string): void {
    const t = this.find(src)
    if (!t) return
    this.terms = this.terms.filter(x => x !== t)
    this.shelf = this.shelf.filter(x => x.src.toLowerCase() !== t.src.toLowerCase())
    this.save()
    this.saveLibrary(lib => lib.filter(x => x.src.toLowerCase() !== t.src.toLowerCase()))
  }

  private saveLibrary(edit: (lib: Term[]) => Term[]): void {
    if (!this.library) return
    try { writeFileSync(this.library, JSON.stringify(edit(readTerms(this.library)), null, 2)) } catch (err) { this.log(`glossary library: ${(err as Error).message}`) }
  }
}
