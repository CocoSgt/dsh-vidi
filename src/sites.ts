import { resolveXiaoyuzhou, XIAOYUZHOU } from './xiaoyuzhou.ts'
import { pickTracks, type SiteTrack } from './sitesubs.ts'
import { execFile, spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * Browsers whose saved logins yt-dlp can reuse (--cookies-from-browser), with
 * the folder that tells us the browser is installed on this Mac. Cookies are
 * read locally by yt-dlp and only sent to the video site itself.
 */
const BROWSERS: { id: string; label: string; dir: string }[] = [
  { id: 'chrome', label: 'Chrome', dir: 'Library/Application Support/Google/Chrome' },
  { id: 'edge', label: 'Edge', dir: 'Library/Application Support/Microsoft Edge' },
  { id: 'brave', label: 'Brave', dir: 'Library/Application Support/BraveSoftware/Brave-Browser' },
  { id: 'vivaldi', label: 'Vivaldi', dir: 'Library/Application Support/Vivaldi' },
  { id: 'firefox', label: 'Firefox', dir: 'Library/Application Support/Firefox' },
  { id: 'safari', label: 'Safari', dir: 'Library/Containers/com.apple.Safari' },
]

/** 'auto': try without a login, retry with the first installed browser when the site asks for one. */
export type CookieChoice = 'auto' | 'none' | string

export function installedBrowsers(): { id: string; label: string }[] {
  return BROWSERS.filter(b => existsSync(join(homedir(), b.dir))).map(({ id, label }) => ({ id, label }))
}

/** Picture for watching at up to `h` lines; prefer H.264 (plays everywhere, copies into HLS without re-encoding). */
export const watchFormat = (h = 720) => [
  `bv*[height<=${h}][vcodec^=avc1]+ba[acodec^=mp4a]`, `bv*[height<=${h}][vcodec^=avc1]+ba`, `b[height<=${h}][vcodec^=avc1]`,
  `b[height<=${h}]`, `bv*[height<=${h}]+ba`, 'b', 'ba',
].join('/')
export const WATCH_FORMAT = watchFormat(720)

/** Best quality for keeping. */
export const ORIGINAL_FORMAT = 'bv*+ba/b'
/** Highest resolution first; at equal resolution prefer H.264/AAC, which every editor opens. */
export const ORIGINAL_SORT = 'res,fps,vcodec:h264,acodec:aac'

export interface MediaInput { url: string; headers: Record<string, string>; vcodec?: string; acodec?: string }

export interface Resolved {
  title?: string
  isLive: boolean
  /** Seconds, for videos (not live streams). */
  duration?: number
  /** One input (muxed) or two (video, audio). */
  inputs: MediaInput[]
  /** Browser whose login was used, if any. */
  cookiesFrom?: string
  /** Subtitle tracks the site offers (fetched separately, as a reference). */
  siteTracks: SiteTrack[]
  /** The page's own words about the video (title, channel, tags, chapters, description): background for polishing and the glossary. */
  brief: string
  /** The video's language as the site states it (e.g. "en", "zh-Hans" → "zh"). */
  language?: string
  /** Picture heights the site offers (for the quality choice). */
  heights: number[]
  /** Cover image to show for audio-only sources (podcasts). */
  cover?: string
}

const CLK = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** Page metadata as a short text block. */
export function briefOf(info: Record<string, any>): string {
  const tags = [...new Set([...(info.tags ?? []), ...(info.categories ?? [])])].slice(0, 25)
  const chapters = (info.chapters ?? []).slice(0, 40).map((c: { start_time: number; title: string }) => `${CLK(c.start_time)} ${c.title}`)
  return [
    info.title && `Title: ${info.title}`,
    (info.uploader || info.channel) && `Channel: ${info.uploader || info.channel}`,
    tags.length && `Tags: ${tags.join(', ')}`,
    chapters.length && `Chapters: ${chapters.join('; ')}`,
    info.description && `Description: ${String(info.description).replace(/\s+\n/g, '\n').slice(0, 1800)}`,
  ].filter(Boolean).join('\n')
}

/** Top comments under the video (names fans spell right; jokes and context). Best effort, background only. */
export async function fetchComments(url: string, browser?: string): Promise<string[]> {
  try {
    const { stdout } = await run('yt-dlp', ['--no-warnings', '--no-playlist', ...cookieArgs(browser), '-J', '--skip-download', '--write-comments',
      '--extractor-args', 'youtube:max_comments=60,all,0,0;comment_sort=top', url], { timeout: 120_000, maxBuffer: 128 * 1024 * 1024 })
    const info = JSON.parse(stdout) as { comments?: { text?: string; like_count?: number; parent?: string }[] }
    return (info.comments ?? []).filter(c => c.text && (!c.parent || c.parent === 'root'))
      .sort((a, b) => (b.like_count ?? 0) - (a.like_count ?? 0)).slice(0, 30)
      .map(c => String(c.text).replace(/\s+/g, ' ').slice(0, 120))
  } catch {
    return []
  }
}

/** Thrown when the site wants a login that no available browser session provides. */
export class LoginRequired extends Error {
  constructor(readonly site: string, readonly triedBrowser: string | undefined, detail: string) {
    super(`login required: ${detail}`)
  }
}

export function siteOf(url: string): string {
  try { return new URL(url).hostname.replace(/^(www|m|live)\./, '') } catch { return url }
}

/** Errors that a logged-in browser session usually fixes. */
const NEEDS_LOGIN = /HTTP Error (401|403|412)|sign in|log ?in|login|cookies|members|premium|private video|age|not a bot|confirm you|precondition/i

function cookieArgs(browser?: string): string[] {
  return browser ? ['--cookies-from-browser', browser] : []
}

/** Which browser to use for a retry, given the user's choice. */
function loginBrowser(choice: CookieChoice): string | undefined {
  if (choice === 'none') return undefined
  if (choice !== 'auto') return choice
  return installedBrowsers()[0]?.id
}

/** Cookie pairs from yt-dlp's per-format cookie string ("a=1; Domain=…; Path=/; b=2; …"). */
function cookieHeader(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw) return undefined
  const attrs = /^(domain|path|secure|expires|httponly|max-age|samesite)$/i
  const pairs = raw.split(/;\s*/).map(p => p.split('=')).filter(([k, v]) => k && v !== undefined && !attrs.test(k.trim()))
  return pairs.length ? pairs.map(([k, ...v]) => `${k!.trim()}=${v.join('=')}`).join('; ') : undefined
}

async function dump(url: string, browser: string | undefined, height = 720): Promise<Resolved> {
  let stdout = ''
  // A logged-in request can still get 412/429 when the site is rate-limiting: wait and retry.
  for (const wait of browser ? [0, 3000, 8000] : [0]) {
    if (wait) await new Promise(r => setTimeout(r, wait))
    try {
      stdout = (await run('yt-dlp', ['--no-warnings', '--no-playlist', ...cookieArgs(browser), '-J', '-f', watchFormat(height), url],
        { timeout: 120_000, maxBuffer: 64 * 1024 * 1024 })).stdout
      break
    } catch (err) {
      const msg = String((err as { stderr?: string }).stderr || (err as Error).message)
      if (wait === 8000 || !browser || !/HTTP Error (412|429)/.test(msg)) throw err
    }
  }
  const info = JSON.parse(stdout) as Record<string, any>
  const formats: Record<string, any>[] = info.requested_formats ?? [info]
  const inputs = formats.filter(f => f.url).map(f => {
    const headers: Record<string, string> = { ...(f.http_headers ?? info.http_headers ?? {}) }
    const cookie = cookieHeader(f.cookies ?? info.cookies)
    if (cookie) headers.Cookie = cookie
    return { url: String(f.url), headers, vcodec: f.vcodec, acodec: f.acodec }
  })
  if (!inputs.length) throw new Error('the site returned no playable stream')
  return {
    title: info.title, isLive: info.is_live === true || info.live_status === 'is_live',
    duration: typeof info.duration === 'number' ? info.duration : undefined,
    inputs, cookiesFrom: browser, siteTracks: pickTracks(info), brief: briefOf(info),
    heights: [...new Set(((info.formats ?? []) as { height?: number; vcodec?: string }[]).filter(f => f.height && f.vcodec !== 'none').map(f => f.height!))]
      .filter(h => h >= 360).map(h => [360, 480, 720, 1080, 1440, 2160].find(s => h <= s) ?? h).filter((h, i, a) => a.indexOf(h) === i).sort((a, b) => a - b),
    language: typeof info.language === 'string' && info.language ? (/^zh-(hant|tw|hk)/i.test(info.language) ? 'zh-Hant' : info.language.split('-')[0]) : undefined,
  }
}

/** Resolve a page URL (YouTube, Bilibili, any yt-dlp site) into ffmpeg inputs, using a browser login when needed. */
export async function resolveSite(url: string, choice: CookieChoice, log: (m: string) => void, onLoginRetry?: (browser: string) => void, height = 720): Promise<Resolved> {
  // Sites yt-dlp can't read, handled here.
  if (XIAOYUZHOU.test(url)) return resolveXiaoyuzhou(url)
  const browser = loginBrowser(choice)
  // 'auto' starts without a login; an explicit browser choice uses it straight away.
  const first = choice === 'auto' ? undefined : browser
  if (first) onLoginRetry?.(first)
  try {
    return await dump(url, first, height)
  } catch (err) {
    const msg = String((err as { stderr?: string }).stderr || (err as Error).message)
    if (!NEEDS_LOGIN.test(msg)) throw new Error(ytdlpError(err))
    if (first === undefined && browser) {
      log(`site asked for a login, retrying with ${browser}'s saved login`)
      onLoginRetry?.(browser)
      try { return await dump(url, browser, height) } catch (err2) {
        const msg2 = String((err2 as { stderr?: string }).stderr || (err2 as Error).message)
        if (NEEDS_LOGIN.test(msg2)) throw new LoginRequired(siteOf(url), browser, ytdlpError(err2))
        throw new Error(ytdlpError(err2))
      }
    }
    throw new LoginRequired(siteOf(url), first, ytdlpError(err))
  }
}

/** The useful line of a yt-dlp failure. */
export function ytdlpError(err: unknown): string {
  const text = String((err as { stderr?: string }).stderr || (err as Error).message || err)
  const line = text.split('\n').reverse().find(l => /ERROR:/.test(l)) ?? text.split('\n').find(Boolean) ?? 'yt-dlp failed'
  return line.replace(/^.*?ERROR:\s*/, '').slice(0, 300)
}

/** ffmpeg arguments for one resolved input: headers (Referer, User-Agent, Cookie) and reconnects. */
export function ffmpegInput(input: MediaInput): string[] {
  const { 'User-Agent': ua, ...rest } = input.headers
  const http = /^https?:/i.test(input.url)
  const headerBlock = Object.entries(rest).map(([k, v]) => `${k}: ${v}\r\n`).join('')
  return [
    ...(http ? ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_on_network_error', '1', '-reconnect_delay_max', '5'] : []),
    ...(ua ? ['-user_agent', ua] : []),
    ...(headerBlock ? ['-headers', headerBlock] : []),
    '-thread_queue_size', '4096', '-i', input.url,
  ]
}

/**
 * Download the original at best quality next to the job files. Progress is
 * reported as 0–100. Resolves to the saved file path.
 */
export function downloadOriginal(url: string, dir: string, browser: string | undefined, onProgress: (pct: number) => void, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      '--no-warnings', '--no-playlist', ...cookieArgs(browser), '-f', ORIGINAL_FORMAT, '-S', ORIGINAL_SORT, '--merge-output-format', 'mp4',
      '--newline', '--progress-template', 'download:%(progress._percent_str)s',
      '-o', join(dir, 'original.%(ext)s'), '--print', 'after_move:filepath', url,
    ]
    const p = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'], signal })
    let out = '', err = ''
    // Video and audio download one after the other, each 0→100%: report the current one.
    p.stdout.on('data', (d: Buffer) => {
      out += d.toString()
      const m = d.toString().match(/([\d.]+)%\s*$/m)
      if (m) onProgress(Math.min(99, Math.round(Number(m[1]))))
    })
    p.stderr.on('data', (d: Buffer) => { err += d.toString() })
    p.on('error', reject)
    p.on('exit', code => {
      const file = out.split('\n').map(l => l.trim()).filter(l => l.startsWith('/')).at(-1)
      if (code === 0 && file && existsSync(file)) { onProgress(100); resolve(file) }
      else reject(new Error(ytdlpError({ stderr: err })))
    })
  })
}

/** Download only the sound of a page URL (best audio stream), next to the job files. Resolves to the saved file path. */
export function downloadAudio(url: string, dir: string, browser: string | undefined, onProgress: (pct: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      '--no-warnings', '--no-playlist', ...cookieArgs(browser), '-f', 'bestaudio[ext=m4a]/bestaudio/best',
      '--newline', '--progress-template', 'download:%(progress._percent_str)s',
      '-o', join(dir, 'audio-src.%(ext)s'), '--print', 'after_move:filepath', url,
    ]
    const p = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    p.stdout.on('data', (d: Buffer) => {
      out += d.toString()
      const m = d.toString().match(/([\d.]+)%\s*$/m)
      if (m) onProgress(Math.min(99, Math.round(Number(m[1]))))
    })
    p.stderr.on('data', (d: Buffer) => { err += d.toString() })
    p.on('error', reject)
    p.on('exit', code => {
      const file = out.split('\n').map(l => l.trim()).filter(l => l.startsWith('/')).at(-1)
      if (code === 0 && file && existsSync(file)) resolve(file)
      else reject(new Error(ytdlpError({ stderr: err })))
    })
  })
}

/** Keep the most recent downloaded original of a job dir, if any. */
export function findOriginal(dir: string): string | undefined {
  if (!existsSync(dir)) return undefined
  const f = readdirSync(dir).find(n => /^original\.(mp4|mkv|webm|m4a|mp3)$/.test(n))
  return f ? join(dir, f) : undefined
}
