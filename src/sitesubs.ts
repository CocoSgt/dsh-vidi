import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** A subtitle track the site itself offers (uploaded, or the site's own auto captions). */
export interface SiteTrack {
  /** Line key used across the plugin: "site:<lang>". */
  key: string
  lang: string
  /** Site's display name of the track, when given. */
  name?: string
  /** The site's automatic captions (usually less accurate). */
  auto: boolean
}

export interface SiteCue { start: number; end: number; text: string }

/**
 * Pick the tracks worth fetching from yt-dlp's info: every uploaded track
 * (minus chat replays and danmaku), plus automatic captions only in the
 * video's own language — YouTube offers auto-translations into ~100 languages,
 * which are machine output of machine output and not worth a reference.
 */
export function pickTracks(info: Record<string, any>): SiteTrack[] {
  const out: SiteTrack[] = []
  const skip = /^(live_chat|danmaku|comments?)$/i
  for (const [lang, list] of Object.entries((info.subtitles ?? {}) as Record<string, { name?: string }[]>)) {
    if (skip.test(lang)) continue
    out.push({ key: `site:${lang}`, lang, name: list?.[0]?.name, auto: false })
  }
  const own = String(info.language ?? '')
  for (const lang of Object.keys((info.automatic_captions ?? {}) as Record<string, unknown>)) {
    const orig = lang.endsWith('-orig') || (own && (lang === own || lang.split('-')[0] === own.split('-')[0]))
    if (!orig || out.some(t => t.lang === lang.replace(/-orig$/, ''))) continue
    out.push({ key: `site:${lang}`, lang, auto: true })
  }
  return out.slice(0, 6)
}

const t = (s: string) => {
  const m = /(?:(\d+):)?(\d+):(\d+)[.,](\d+)/.exec(s)
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(`0.${m[4]}`) : 0
}
const clean = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim()

/** YouTube json3: events with segments. */
function parseJson3(text: string): SiteCue[] {
  const j = JSON.parse(text) as { events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] }[] }
  return (j.events ?? []).filter(e => e.segs?.length).map(e => ({
    start: (e.tStartMs ?? 0) / 1000, end: ((e.tStartMs ?? 0) + (e.dDurationMs ?? 0)) / 1000,
    text: clean((e.segs ?? []).map(s => s.utf8 ?? '').join('')),
  })).filter(c => c.text)
}

/** WebVTT or SRT; YouTube's rolling auto captions repeat the previous line, so repeats are dropped. */
function parseCues(text: string): SiteCue[] {
  const out: SiteCue[] = []
  for (const block of text.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n')
    const i = lines.findIndex(l => l.includes('-->'))
    if (i < 0) continue
    const [a, b] = lines[i]!.split('-->')
    const body = lines.slice(i + 1).map(clean).filter(Boolean)
    if (!body.length) continue
    const prev = out.at(-1)
    const fresh = body.filter(l => !prev || !prev.text.includes(l))
    if (!fresh.length) { if (prev) prev.end = t(b!); continue }
    out.push({ start: t(a!), end: t(b!), text: fresh.join(' ') })
  }
  return out
}

export function parseSubtitleFile(path: string): SiteCue[] {
  const text = readFileSync(path, 'utf8')
  return path.endsWith('.json3') ? parseJson3(text) : parseCues(text)
}

/**
 * Download the chosen tracks next to the job and turn each into
 * site.<lang>.json ([{start,end,text}]). Returns the tracks that worked.
 */
export async function fetchSiteSubs(url: string, dir: string, tracks: SiteTrack[], browser?: string): Promise<SiteTrack[]> {
  if (!tracks.length) return []
  await run('yt-dlp', [
    '--no-warnings', '--no-playlist', ...(browser ? ['--cookies-from-browser', browser] : []),
    '--skip-download', '--write-subs', '--write-auto-subs', '--sub-langs', tracks.map(t => t.lang).join(','),
    '--sub-format', 'json3/vtt/srt/best', '-o', join(dir, 'site.%(ext)s'), url,
  ], { timeout: 180_000 }).catch(() => undefined)
  const got: SiteTrack[] = []
  for (const tr of tracks) {
    const file = readdirSync(dir).find(f => f.startsWith(`site.${tr.lang}.`) && /\.(json3|vtt|srt)$/.test(f))
    if (!file) continue
    try {
      const cues = parseSubtitleFile(join(dir, file))
      if (!cues.length) continue
      writeFileSync(join(dir, `site.${tr.lang}.json`), JSON.stringify(cues))
      got.push(tr)
    } catch {}
  }
  writeFileSync(join(dir, 'site.tracks.json'), JSON.stringify(got, null, 1))
  return got
}

/** Tracks already fetched for a job folder (after a restart). */
export function loadSiteSubs(dir: string): { tracks: SiteTrack[]; cues: Map<string, SiteCue[]> } {
  const cues = new Map<string, SiteCue[]>()
  if (!existsSync(join(dir, 'site.tracks.json'))) return { tracks: [], cues }
  try {
    const tracks = JSON.parse(readFileSync(join(dir, 'site.tracks.json'), 'utf8')) as SiteTrack[]
    for (const tr of tracks) cues.set(tr.key, JSON.parse(readFileSync(join(dir, `site.${tr.lang}.json`), 'utf8')))
    return { tracks, cues }
  } catch {
    return { tracks: [], cues }
  }
}
