import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname, delimiter } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { checkDeps } from './deps.ts'

/**
 * One-click setup of what Vidi needs on this Mac: the missing command-line tools through Homebrew
 * (yt-dlp, ffmpeg, whisper-cpp) and the whisper model for local subtitles, both at once. The tools go
 * into one `brew install` (Homebrew downloads them in parallel itself; two brew processes would only
 * wait on each other's lock). Runs in the background; the page polls `state()` for progress.
 */

/** Where Homebrew puts its commands (Apple silicon, Intel). */
const BREW_BINS = ['/opt/homebrew/bin', '/usr/local/bin']
/** The model, from Hugging Face; the mirror when Hugging Face cannot be reached (mainland China). */
const MODEL_URLS = [
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
  'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
]
/** The model is about 574 MB; anything much smaller is an error page, not the model. */
const MODEL_MIN_BYTES = 500_000_000
export const HOMEBREW_INSTALL = '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'

/** Which Homebrew package provides each tool. */
const FORMULA: Record<string, string> = { 'yt-dlp': 'yt-dlp', ffmpeg: 'ffmpeg', 'whisper-server': 'whisper-cpp' }

export type StepState = 'wait' | 'run' | 'done' | 'fail' | 'skip'
export interface SetupStep { id: string; state: StepState; detail?: string; pct?: number }
export interface SetupState {
  running: boolean
  steps: SetupStep[]
  /** Why it stopped: 'no-brew' (Homebrew is not installed), or an error message. */
  error?: string
  /** The command that installs Homebrew, when it is missing. */
  brewInstall?: string
  finishedAt?: number
}

/**
 * Commands installed by Homebrew must be found by this process even when the app was started from the
 * Dock (which gives it a short PATH): add Homebrew's folders at the end of PATH when they exist.
 */
export function ensureBrewPath(): void {
  const parts = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  let changed = false
  for (const dir of BREW_BINS) if (existsSync(dir) && !parts.includes(dir)) { parts.push(dir); changed = true }
  if (changed) process.env.PATH = parts.join(delimiter)
}

function findBrew(): string | undefined {
  for (const dir of BREW_BINS) if (existsSync(`${dir}/brew`)) return `${dir}/brew`
  for (const dir of (process.env.PATH ?? '').split(delimiter)) if (dir && existsSync(`${dir}/brew`)) return `${dir}/brew`
  return undefined
}

export class Setup {
  private s: SetupState = { running: false, steps: [] }

  constructor(private readonly whisperModel: string, private readonly log: (msg: string) => void) {}

  state(): SetupState {
    return JSON.parse(JSON.stringify(this.s)) as SetupState
  }

  /** Start installing what is missing (does nothing while a run is going on). */
  start(opts: { local: boolean }): SetupState {
    if (!this.s.running) void this.run(opts.local)
    return this.state()
  }

  private step(id: string): SetupStep {
    return this.s.steps.find(x => x.id === id)!
  }

  private async run(local: boolean): Promise<void> {
    ensureBrewPath()
    const deps = await checkDeps(this.whisperModel)
    const need = (name: string) => deps.some(d => d.name === name && !d.ok)
    const tools = ['yt-dlp', 'ffmpeg', ...(local ? ['whisper-server'] : [])].filter(need)
    const model = local && need('whisper model')
    this.s = {
      running: true,
      steps: [...tools.map(id => ({ id, state: 'wait' as StepState })), ...(model ? [{ id: 'model', state: 'wait' as StepState }] : [])],
    }
    try {
      await Promise.all([tools.length ? this.tools(tools) : undefined, model ? this.model() : undefined])
    } finally {
      this.s.running = false
      this.s.finishedAt = Date.now()
      this.log(`setup: ${this.s.steps.map(x => `${x.id} ${x.state}`).join(', ') || 'nothing missing'}${this.s.error ? ` (${this.s.error})` : ''}`)
    }
  }

  /** Every missing tool in one `brew install`; afterwards each is checked for itself. */
  private async tools(tools: string[]): Promise<void> {
    const brew = findBrew()
    if (!brew) {
      for (const t of tools) this.step(t).state = 'fail'
      this.s.error ??= 'no-brew'
      this.s.brewInstall = HOMEBREW_INSTALL
      return
    }
    const steps = tools.map(t => this.step(t))
    for (const st of steps) st.state = 'run'
    let failure: string | undefined
    try {
      await this.brew(brew, tools.map(t => FORMULA[t]!), steps)
    } catch (err) {
      failure = (err as Error).message
    }
    ensureBrewPath()
    // One tool failing does not mean the others did: ask each one.
    const now = await checkDeps(this.whisperModel)
    for (const st of steps) {
      if (now.some(d => d.name === st.id && d.ok)) { st.state = 'done'; st.detail = undefined }
      else { st.state = 'fail'; st.detail = failure ?? st.detail; this.s.error ??= `${st.id}: ${failure ?? 'not installed'}` }
    }
  }

  private async model(): Promise<void> {
    const st = this.step('model')
    st.state = 'run'
    try {
      await this.download(st)
      st.state = 'done'; st.detail = undefined; st.pct = 100
    } catch (err) {
      st.state = 'fail'; st.detail = (err as Error).message
      this.s.error ??= `model: ${(err as Error).message}`
    }
  }

  /**
   * `brew install <formulas…>`. Each line of output goes to the step of the tool it names (Homebrew says
   * "Pouring ffmpeg…", "Installing yt-dlp…"); lines naming none (dependencies) go to every step still running.
   */
  private brew(brew: string, formulas: string[], steps: SetupStep[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const env = { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_ENV_HINTS: '1', HOMEBREW_NO_INSTALL_CLEANUP: '1', NONINTERACTIVE: '1', HOMEBREW_NO_COLOR: '1' }
      const p = spawn(brew, ['install', ...formulas], { env, stdio: ['ignore', 'pipe', 'pipe'] })
      let tail = '', rest = ''
      const take = (b: Buffer) => {
        tail = (tail + b.toString()).slice(-4000)
        const lines = (rest + b.toString()).split(/[\r\n]/)
        rest = lines.pop() ?? ''
        for (const raw of lines) {
          const line = raw.replace(/\x1b\[[0-9;]*m/g, '').trim().slice(0, 160)
          if (!line) continue
          const named = steps.filter((_, i) => new RegExp(`(^|[\\s/])${formulas[i]!.replace(/-/g, '\\-')}(@|--|[:,/\\s]|$)`).test(line))
          for (const st of named.length === 1 ? named : steps) if (st.state === 'run') st.detail = line
        }
      }
      p.stdout!.on('data', take)
      p.stderr!.on('data', take)
      p.on('error', reject)
      p.on('exit', code => {
        if (code === 0) return resolve()
        const last = tail.split('\n').map(l => l.trim()).filter(l => /error/i.test(l)).at(-1) ?? tail.split('\n').map(l => l.trim()).filter(Boolean).at(-1)
        reject(new Error(last ? last.slice(0, 200) : `brew exited (${code})`))
      })
    })
  }

  /** The whisper model, to a .part file renamed into place when complete. */
  private async download(st: SetupStep): Promise<void> {
    mkdirSync(dirname(this.whisperModel), { recursive: true })
    const part = `${this.whisperModel}.part`
    let last: Error | undefined
    for (const url of MODEL_URLS) {
      const host = new URL(url).host
      try {
        st.detail = host; st.pct = 0
        const ac = new AbortController()
        // No first byte within 20 s: this host is out of reach from here, try the next one.
        let timer = setTimeout(() => ac.abort(), 20_000)
        const res = await fetch(url, { signal: ac.signal, redirect: 'follow' })
        if (!res.ok || !res.body) throw new Error(`${host}: HTTP ${res.status}`)
        const total = Number(res.headers.get('content-length')) || 0
        let got = 0
        const body = Readable.fromWeb(res.body as never)
        body.on('data', (c: Buffer) => {
          got += c.length
          // A stall of 60 s gives up this host.
          clearTimeout(timer); timer = setTimeout(() => ac.abort(), 60_000)
          if (total) st.pct = Math.min(99, Math.floor((got / total) * 100))
          st.detail = `${host} · ${(got / 1e6).toFixed(0)}${total ? ` / ${(total / 1e6).toFixed(0)}` : ''} MB`
        })
        try { await pipeline(body, createWriteStream(part)) } finally { clearTimeout(timer) }
        const size = statSync(part).size
        if ((total && size !== total) || size < MODEL_MIN_BYTES) throw new Error(`${host}: incomplete download (${(size / 1e6).toFixed(0)} MB)`)
        renameSync(part, this.whisperModel)
        return
      } catch (err) {
        last = (err as Error).name === 'AbortError' ? new Error(`${host}: no response`) : err as Error
        this.log(`setup: model from ${host} failed: ${last.message}`)
        rmSync(part, { force: true })
      }
    }
    throw last ?? new Error('download failed')
  }
}
