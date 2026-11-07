import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

export type KeyName = 'openai'

const ENV: Record<KeyName, string> = { openai: 'OPENAI_API_KEY' }

export interface KeyInfo {
  set: boolean
  /** Where the key comes from: saved on this page, the plugin settings, or an environment variable. */
  source?: 'page' | 'settings' | 'env'
  /** Masked form for display, e.g. "sk-…a1b2". */
  hint?: string
}

const mask = (k: string) => (k.length > 10 ? `${k.slice(0, 3)}…${k.slice(-4)}` : '••••')

/**
 * API keys for online services. Keys entered on the live page are stored in
 * a file readable only by the current user; the plugin settings and the
 * usual environment variable work as fallbacks. Keys never go to the browser
 * after saving, only a masked hint.
 */
export class KeyStore {
  constructor(private readonly file: string, private readonly settings: () => Partial<Record<KeyName, string>>) {}

  private read(): Partial<Record<KeyName, string>> {
    if (!existsSync(this.file)) return {}
    try { return JSON.parse(readFileSync(this.file, 'utf8')) } catch { return {} }
  }

  get(name: KeyName): string | undefined {
    return this.resolve(name)?.key
  }

  private resolve(name: KeyName): { key: string; source: KeyInfo['source'] } | undefined {
    const page = this.read()[name]?.trim()
    if (page) return { key: page, source: 'page' }
    const cfg = this.settings()[name]?.trim()
    if (cfg) return { key: cfg, source: 'settings' }
    const env = process.env[ENV[name]]?.trim()
    if (env) return { key: env, source: 'env' }
    return undefined
  }

  info(name: KeyName): KeyInfo {
    const r = this.resolve(name)
    return r ? { set: true, source: r.source, hint: mask(r.key) } : { set: false }
  }

  /** Save (or with an empty value, remove) a key entered on the page. */
  save(name: KeyName, key: string): void {
    const all = this.read()
    if (key.trim()) all[name] = key.trim(); else delete all[name]
    writeFileSync(this.file, JSON.stringify(all, null, 2), { mode: 0o600 })
    try { chmodSync(this.file, 0o600) } catch {}
  }
}
