import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import { LANGS, type LlmHandle } from './translate.ts'
import type { Cue } from './types.ts'

/** One term: source form plus its rendering per target language. */
export interface Term {
  src: string
  tr: Record<string, string>
  /** 'user' entries are pinned: auto extraction never overwrites them. */
  origin: 'auto' | 'user'
}

/**
 * Per-job glossary that grows while the stream runs. Every `batch` finished
 * cues, the model pulls proper nouns, product names and recurring terms (with
 * their translations) out of the recent finished lines; later translations
 * and the speech recogniser's prompt both use the list, so names stay
 * consistent and get recognised correctly. Users can add, edit or remove
 * entries; their entries win.
 */
export class Glossary {
  terms: Term[] = []
  private pending = 0
  private busy = false

  constructor(
    private readonly file: string,
    private targets: string[],
    private readonly llm: () => LlmHandle | undefined,
    private readonly onChange: (terms: Term[]) => void,
    private readonly log: (msg: string) => void,
    seed: string,
    /** Shared library of user terms (kept across streams). */
    private readonly library?: string,
    private readonly batch = 12,
  ) {
    if (existsSync(file)) {
      try { this.terms = JSON.parse(readFileSync(file, 'utf8')) as Term[] } catch {}
    }
    for (const t of readTerms(library)) if (!this.find(t.src)) this.terms.push({ ...t, origin: 'user' })
    // Seed from the plugin-level glossary setting: lines like "Dots = Dots" or "GPT-6.1 Sol".
    for (const line of seed.split('\n').map(l => l.trim()).filter(Boolean)) {
      const [src, rest] = line.split(/\s*=\s*/)
      if (src && !this.find(src)) this.terms.push({ src, tr: rest ? Object.fromEntries(targets.map(t => [t, rest])) : {}, origin: 'user' })
    }
  }

  private find(src: string): Term | undefined {
    const k = src.toLowerCase()
    return this.terms.find(t => t.src.toLowerCase() === k)
  }

  private save(): void {
    writeFileSync(this.file, JSON.stringify(this.terms, null, 2))
    this.onChange(this.terms)
  }

  setTargets(targets: string[]): void {
    this.targets = targets
  }

  /** Text block for translation prompts. */
  forPrompt(): string {
    return this.terms.slice(-80).map(t => {
      const tr = this.targets.map(l => t.tr[l] ? `${l}: ${t.tr[l]}` : '').filter(Boolean).join('; ')
      return tr ? `${t.src} → ${tr}` : `${t.src} (keep as is)`
    }).join('\n')
  }

  /** Comma list of source terms, used as the speech recogniser's prompt. */
  forAsr(): string {
    return this.terms.slice(-40).map(t => t.src).join(', ')
  }

  upsert(term: { src: string; tr?: Record<string, string> }): void {
    const src = term.src.trim()
    if (!src) return
    const existing = this.find(src)
    if (existing) { existing.tr = { ...existing.tr, ...term.tr }; existing.origin = 'user' }
    else this.terms.push({ src, tr: term.tr ?? {}, origin: 'user' })
    this.save()
    this.saveLibrary(lib => {
      const k = src.toLowerCase()
      const hit = lib.find(t => t.src.toLowerCase() === k)
      const tr = (existing ?? this.find(src))!.tr
      if (hit) hit.tr = { ...hit.tr, ...tr }; else lib.push({ src, tr, origin: 'user' })
      return lib
    })
  }

  remove(src: string): void {
    const k = src.toLowerCase()
    this.terms = this.terms.filter(t => t.src.toLowerCase() !== k)
    this.save()
    this.saveLibrary(lib => lib.filter(t => t.src.toLowerCase() !== k))
  }

  private saveLibrary(edit: (lib: Term[]) => Term[]): void {
    if (!this.library) return
    try { writeFileSync(this.library, JSON.stringify(edit(readTerms(this.library)), null, 2)) } catch (err) { this.log(`glossary library: ${(err as Error).message}`) }
  }

  /** Call after each finished, translated cue. */
  noteFinished(recent: Cue[]): void {
    if (++this.pending < this.batch || this.busy) return
    this.pending = 0
    void this.extract(recent.slice(-this.batch * 2))
  }

  private async extract(lines: Cue[]): Promise<void> {
    const handle = this.llm()
    if (!handle || lines.length === 0) { this.log(`glossary: skipped (${handle ? 'no lines' : 'no model'})`); return }
    this.busy = true
    try {
      const names = this.targets.map(t => `"${t}" (${LANGS[t] ?? t})`).join(', ')
      const system = [
        'You maintain a glossary for live subtitle translation.',
        'From the transcript lines below, list proper nouns, product and model names, people, organisations, places and recurring domain terms that a translator must render consistently.',
        `For each, give its rendering in: ${names}. Keep names that are normally left untranslated (brands, model names) identical.`,
        'Prefer entries a recogniser or translator could get wrong: people, products, model names, organisations, jargon, acronyms. Skip everyday words and famous places whose translation is obvious (China, Beijing, market). If a name appears misspelled by speech recognition, list the correct spelling.',
        'At most 15 entries. Reply with JSON only: [{"src": "...", "tr": {"<lang>": "..."}}].',
      ].join(' ')
      const text = [
        this.terms.length ? `Already in the glossary (do not repeat): ${this.terms.map(t => t.src).join(', ')}\n` : '',
        'Lines:',
        ...lines.map(c => `- ${c.src}${c.tr ? ` => ${JSON.stringify(c.tr)}` : ''}`),
      ].join('\n')
      const { provider, model } = handle.selection()
      const asm = new BlockAssembler()
      for await (const chunk of handle.stream({
        provider, model, system, maxTokens: 4000, purpose: 'live-glossary',
        messages: [createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'dsh-live' } })],
      })) asm.push(chunk as never)
      const out = asm.blocks().filter((b: { type: string }) => b.type === 'text').map((b: { type: string; text?: string }) => b.text ?? '').join('')
      const found = parseTerms(out)
      if (!found.length) { this.log(`glossary: no entries in reply (${out.slice(0, 160)})`); return }
      let added = 0
      for (const f of found) {
        if (typeof f.src !== 'string' || !f.src.trim()) continue
        const tr = (f.tr && typeof f.tr === 'object' ? f.tr : {}) as Record<string, string>
        const existing = this.find(f.src)
        if (existing) {
          if (existing.origin === 'auto') existing.tr = { ...tr, ...existing.tr }
          continue
        }
        this.terms.push({ src: f.src.trim(), tr, origin: 'auto' })
        added++
      }
      this.log(`glossary: +${added}, ${this.terms.length} total`)
      if (added) this.save()
    } catch (err) {
      this.log(`glossary: ${(err as Error).message}`)
    } finally {
      this.busy = false
    }
  }
}

function readTerms(file?: string): Term[] {
  if (!file || !existsSync(file)) return []
  try { return JSON.parse(readFileSync(file, 'utf8')) as Term[] } catch { return [] }
}

/** Read the model's JSON list; if the reply was cut off, keep every complete entry. */
export function parseTerms(out: string): { src?: unknown; tr?: unknown }[] {
  const m = out.match(/\[[\s\S]*\]/)
  if (m) {
    try { return JSON.parse(m[0]) } catch {}
  }
  const items: { src?: unknown; tr?: unknown }[] = []
  for (const obj of out.match(/\{[^{}]*\{[^{}]*\}[^{}]*\}|\{[^{}]*\}/g) ?? []) {
    try { const v = JSON.parse(obj); if (v && typeof v.src === 'string') items.push(v) } catch {}
  }
  return items
}
