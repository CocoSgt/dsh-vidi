import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { exportCues } from './export.ts'
import { LANGS } from './translate.ts'
import { downloadOriginal, findOriginal, installedBrowsers, siteOf, type CookieChoice } from './sites.ts'
import type { Cue } from './types.ts'

const run = promisify(execFile)

export interface Task {
  id: string
  kind: 'original' | 'subtitled' | 'video'
  /** What is happening now, for multi-step tasks: 'download' (original) / 'mux' (adding subtitle tracks). */
  stage?: 'download' | 'mux'
  /** File name to save as (says which version it is). */
  saveAs?: string
  conversationId: string
  /** Page URL, for originals (to retry). */
  url?: string
  /** Folder name under jobs/ that holds the result (the job's own folder, or a download-only folder). */
  dirId: string
  title?: string
  status: 'running' | 'done' | 'error'
  pct: number
  /** File name inside the folder, when done. */
  file?: string
  error?: string
  needsLogin?: { site: string; browser?: string; detail: string }
  startedAt: number
}

/** ISO 639-2 codes for MP4 subtitle tracks. */
const ISO3: Record<string, string> = {
  zh: 'chi', 'zh-Hant': 'chi', en: 'eng', ja: 'jpn', ko: 'kor', es: 'spa', fr: 'fre', de: 'ger', pt: 'por', ru: 'rus',
  it: 'ita', ar: 'ara', hi: 'hin', id: 'ind', vi: 'vie', th: 'tha', tr: 'tur', nl: 'dut', pl: 'pol',
}

const NEEDS_LOGIN = /HTTP Error (401|403|412)|sign in|log ?in|login|cookies|members|premium|private video|age|not a bot|confirm you|precondition/i

/**
 * Background video jobs: download the original at best quality, and build an
 * MP4 with subtitle tracks (each chosen language, plus one combined track).
 * Tasks are kept per conversation so the live page can show their progress.
 */
export class Downloads {
  private tasks = new Map<string, Task>()

  constructor(private readonly jobsDir: string, private readonly cookies: () => CookieChoice, private readonly log: (m: string) => void) {}

  /** How many downloads are still going (any conversation). */
  running(): number {
    return [...this.tasks.values()].filter(t => t.status === 'running').length
  }

  list(conversationId: string): Task[] {
    return [...this.tasks.values()].filter(t => t.conversationId === conversationId).sort((a, b) => b.startedAt - a.startedAt).slice(0, 12)
  }

  private add(task: Omit<Task, 'id' | 'status' | 'pct' | 'startedAt'>): Task {
    const t: Task = { ...task, id: Math.random().toString(36).slice(2, 10), status: 'running', pct: 0, startedAt: Date.now() }
    this.tasks.set(t.id, t)
    return t
  }

  /**
   * Download a page URL's original video. With `dirId` it lands in that job's
   * folder; otherwise a download-only folder is created.
   */
  original(opts: { conversationId: string; url: string; dirId?: string; title?: string; browser?: string }): Task {
    const dirId = opts.dirId ?? `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-dl${Math.random().toString(36).slice(2, 5)}`
    const dir = join(this.jobsDir, dirId)
    mkdirSync(dir, { recursive: true })
    const task = this.add({ kind: 'original', conversationId: opts.conversationId, url: opts.url, dirId, title: opts.title ?? siteOf(opts.url) })
    const choice = this.cookies()
    const auto = installedBrowsers()[0]?.id
    // Same policy as watching: the browser already known to work, else try without a login and retry with one.
    const first = opts.browser ?? (choice === 'auto' || choice === 'none' ? undefined : choice)
    const retry = first === undefined && choice === 'auto' ? auto : undefined
    // Sites like Bilibili answer 412 now and then under load: wait and try again before giving up.
    const go = async (browser: string | undefined): Promise<string> => {
      for (const wait of [0, 3000, 8000]) {
        if (wait) { this.log(`download: site refused, retrying in ${wait / 1000}s`); await new Promise(r => setTimeout(r, wait)) }
        try { return await downloadOriginal(opts.url, dir, browser, pct => { task.pct = pct }) } catch (err) {
          if (wait === 8000 || !/HTTP Error (412|429)|timed out|reset/i.test((err as Error).message)) throw err
        }
      }
      throw new Error('unreachable')
    }
    void go(first)
      .catch(err => {
        if (retry && NEEDS_LOGIN.test((err as Error).message)) { this.log(`download: retrying with ${retry}'s saved login`); task.pct = 0; return go(retry) }
        throw err
      })
      .then(file => { task.file = basename(file); task.status = 'done'; task.pct = 100 })
      .catch(err => {
        const msg = (err as Error).message
        task.status = 'error'
        task.error = msg
        // Only ask for a login when none was used; a logged-in refusal (412/429) is the site rate-limiting.
        const usedLogin = !!(first ?? retry)
        if (NEEDS_LOGIN.test(msg) && (!usedLogin || /sign in|log ?in|members|premium|private video/i.test(msg))) task.needsLogin = { site: siteOf(opts.url), browser: first ?? retry, detail: msg }
        else if (/HTTP Error (412|429)/.test(msg)) task.error = `${siteOf(opts.url)} is refusing requests for now (rate limit); try again in a minute`
        this.log(`download failed: ${msg}`)
      })
    return task
  }

  /**
   * MP4 with soft subtitle tracks: one per chosen language and, when more than
   * one is chosen, a combined track (shown by default). The picture comes from
   * the downloaded original, else the recording, else the source file.
   */
  /** Write an MP4 of `video` with subtitle tracks for `langs` (combined track first when more than one). */
  private async mux(dir: string, video: string, cues: Cue[], langs: string[], title: string | undefined, out: string): Promise<void> {
    const name = (l: string) => (l === 'src' ? 'Original' : (LANGS[l] ?? l))
    const tracks = langs.map(l => ({ langs: [l], name: name(l), code: l === 'src' ? (cues.find(c => c.lang)?.lang ?? 'und') : l }))
    if (langs.length > 1) tracks.unshift({ langs, name: langs.map(name).join(' + '), code: langs.find(l => l !== 'src') ?? 'und' })
    const tmp = join(dir, '.tracks')
    mkdirSync(tmp, { recursive: true })
    const inputs: string[] = []
    const meta: string[] = []
    tracks.forEach((t, i) => {
      const file = join(tmp, `${i}.srt`)
      writeFileSync(file, exportCues(cues, t.langs, 'srt', title))
      inputs.push('-i', file)
      meta.push(`-metadata:s:s:${i}`, `language=${ISO3[t.code] ?? ISO3[t.code.slice(0, 2)] ?? 'und'}`, `-metadata:s:s:${i}`, `title=${t.name}`,
        `-disposition:s:${i}`, i === 0 ? 'default' : '0')
    })
    try {
      await run('ffmpeg', [
        '-v', 'error', '-y', '-i', video, ...inputs,
        '-map', '0:v?', '-map', '0:a?', ...tracks.flatMap((_, i) => ['-map', `${i + 1}:0`]),
        '-c', 'copy', '-c:s', 'mov_text', ...meta, '-movflags', '+faststart', out,
      ], { timeout: 900_000 })
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }

  /**
   * One button, one result: the chosen picture ('original' = best quality from
   * the site, fetched first if needed; 'recording' = what was recorded here),
   * with or without subtitle tracks. `saveAs` names the file by version.
   */
  video(opts: {
    conversationId: string; dirId: string; title?: string; url?: string; browser?: string
    quality: 'original' | 'recording'; langs: string[]; cues: Cue[]; localFile?: string; saveAs: string
  }): Task {
    const dir = join(this.jobsDir, opts.dirId)
    const task = this.add({ kind: 'video', conversationId: opts.conversationId, url: opts.url, dirId: opts.dirId, title: opts.title, saveAs: opts.saveAs })
    void (async () => {
      let source: string | undefined
      if (opts.localFile) source = opts.localFile
      else if (opts.quality === 'original') {
        source = findOriginal(dir)
        if (!source) {
          if (!opts.url) throw new Error('no link to download from')
          task.stage = 'download'
          source = await downloadOriginal(opts.url, dir, opts.browser, pct => { task.pct = Math.round(pct * (opts.langs.length ? 0.9 : 1)) })
        }
      } else {
        source = existsSync(join(dir, 'recording.mp4')) ? join(dir, 'recording.mp4') : undefined
        if (!source) throw new Error('the recording is not finished yet')
      }
      if (!opts.langs.length) { task.file = basename(source); return }
      task.stage = 'mux'
      task.pct = Math.max(task.pct, 90)
      const out = join(dir, `subtitled.${opts.quality}.${opts.langs.join('+').replace(/[^\w+-]/g, '_')}.mp4`)
      await this.mux(dir, source, opts.cues, opts.langs, opts.title, out)
      task.file = basename(out)
    })()
      .then(() => { task.status = 'done'; task.pct = 100; task.stage = undefined })
      .catch(err => {
        const msg = String((err as { stderr?: string }).stderr || (err as Error).message)
        task.status = 'error'
        task.error = /HTTP Error (412|429)/.test(msg) ? 'The site is refusing requests for now (rate limit). Try again in a minute.' : msg.slice(-300)
        this.log(`video download failed: ${task.error}`)
      })
    return task
  }
}

