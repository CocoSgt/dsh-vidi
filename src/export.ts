import type { Cue } from './types.ts'

export type ExportFormat = 'srt' | 'vtt' | 'txt' | 'md'

/** Text of one cue for the chosen lines ('src' = original, else a language code), in order. */
function lines(c: Cue, langs: string[]): string[] {
  return langs.map(l => (l === 'src' ? c.src : c.tr?.[l] ?? '')).filter(Boolean)
}

const stamp = (s: number, sep: string) => {
  const ms = Math.max(0, Math.round(s * 1000))
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}${sep}${p(ms % 1000, 3)}`
}
const clock = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = Math.floor(s % 60)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`
}

/** Group cues into readable paragraphs: break on a pause > 2.5 s or after ~45 s. */
function paragraphs(cues: Cue[]): Cue[][] {
  const out: Cue[][] = []
  let cur: Cue[] = []
  for (const c of cues) {
    const prev = cur.at(-1)
    if (prev && (c.start - prev.end > 2.5 || c.end - cur[0]!.start > 45)) { out.push(cur); cur = [] }
    cur.push(c)
  }
  if (cur.length) out.push(cur)
  return out
}

/** Join text pieces: no space between CJK pieces, a space otherwise. */
function join(parts: string[]): string {
  const cjk = /[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/
  const joined = parts.reduce((acc, p) => (!acc ? p : cjk.test(acc.at(-1)!) && cjk.test(p[0]!) ? acc + p : `${acc} ${p}`), '')
  // Translations sometimes leave a space after full-width punctuation.
  return joined.replace(/([\u3001\u3002\uff0c\uff01\uff1f\uff1b\uff1a])\s+/g, '$1')
}

/**
 * Export finished cues. `langs` picks and orders the lines: e.g. ['src'] for
 * the original only, ['zh'] for one translation, ['zh', 'src'] bilingual,
 * ['zh', 'ja', 'src'] multilingual.
 */
export function exportCues(cues: Cue[], langs: string[], format: ExportFormat, title = ''): string {
  const rows = cues.filter(c => c.final && lines(c, langs).length)
  if (format === 'srt') return rows.map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${lines(c, langs).join('\n')}\n`).join('\n')
  if (format === 'vtt') return 'WEBVTT\n\n' + rows.map(c => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${lines(c, langs).join('\n')}\n`).join('\n')
  // Readable transcript: paragraphs with a timestamp, each selected language as its own paragraph block.
  const md = format === 'md'
  const head = md && title ? `# ${title}\n\n` : title ? `${title}\n\n` : ''
  return head + paragraphs(rows).map(p => {
    const ts = md ? `**[${clock(p[0]!.start)}]**` : `[${clock(p[0]!.start)}]`
    const blocks = langs.map(l => join(p.map(c => (l === 'src' ? c.src : c.tr?.[l] ?? '')).filter(Boolean))).filter(Boolean)
    return `${ts} ${blocks.join(md ? '\n\n' : '\n')}`
  }).join('\n\n') + '\n'
}

/** The default set written when a job stops. */
export function defaultExports(targets: string[]): { name: string; langs: string[]; formats: ExportFormat[] }[] {
  return [
    { name: 'source', langs: ['src'], formats: ['srt', 'vtt', 'txt'] },
    ...targets.map(t => ({ name: t, langs: [t], formats: ['srt', 'vtt', 'txt'] as ExportFormat[] })),
    { name: 'multilingual', langs: [...targets, 'src'], formats: ['srt', 'vtt', 'md'] },
  ]
}
