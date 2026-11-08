import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

/** Online speech services; each reads its key from the names DSH and other tools already use. */
export const KEY_REFS = {
  openai: ['OPENAI_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  groq: ['GROQ_API_KEY'],
  siliconflow: ['SILICONFLOW_API_KEY'],
  glm: ['GLM_API_KEY', 'ZHIPUAI_API_KEY', 'ZAI_API_KEY'],
  deepgram: ['DEEPGRAM_API_KEY'],
  elevenlabs: ['ELEVENLABS_API_KEY', 'XI_API_KEY'],
  mistral: ['MISTRAL_API_KEY'],
  dashscope: ['DASHSCOPE_API_KEY', 'BAILIAN_API_KEY'],
  volc: ['VOLC_SPEECH_API_KEY', 'VOLCENGINE_SPEECH_API_KEY'],
} as const satisfies Record<string, readonly string[]>

export type KeyName = keyof typeof KEY_REFS
export const KEY_NAMES = Object.keys(KEY_REFS) as KeyName[]

/** A model provider configured in DSH that can also do speech recognition. */
export interface DshProvider { service: KeyName; ref?: string; base?: string; name: string }

export interface KeyInfo {
  set: boolean
  /** The DSH provider whose key this is (its display name), when it comes from DSH's model setup. */
  provider?: string
  /** Where the key comes from: the DSH key store (shared with Models), the plugin settings, or the environment. */
  source?: 'dsh' | 'settings' | 'env' | 'page'
  /** Name it is stored under, e.g. GOOGLE_API_KEY. */
  ref?: string
  /** Masked form for display, e.g. "sk-…a1b2". */
  hint?: string
}

/** The part of DSH's credential service this plugin uses (keys live in ~/.dsh/.credentials.yaml). */
export interface Credentials {
  resolve(ref: string): Promise<{ value: string; source: string } | undefined>
  set(ref: string, value: string): Promise<void>
  unset(ref: string): Promise<void>
}

const mask = (k: string) => (k.length > 10 ? `${k.slice(0, 3)}…${k.slice(-4)}` : '••••')

/**
 * API keys for the online speech services. Inside DSH they live in its own
 * key store, the same one the Models page uses, so a Google or SiliconFlow
 * key added there works here and a key saved on the video page shows up
 * there. Without that service (older hosts) keys fall back to a file only
 * this user can read, the plugin settings and the environment. Keys never go
 * to the browser, only a masked hint. Lookups are cached and refreshed when
 * the store changes, so providers can read them synchronously.
 */
export class KeyStore {
  private cache = new Map<KeyName, { key: string; info: KeyInfo }>()
  creds?: Credentials
  /** Model providers configured in DSH (their key names and addresses), read fresh on each refresh. */
  discover?: () => DshProvider[]
  /** Addresses from DSH's provider setup, per service (e.g. SiliconFlow's international endpoint). */
  bases = new Map<KeyName, string>()

  constructor(private readonly file: string, private readonly settings: () => Partial<Record<KeyName, string>>) {}

  private readFile(): Partial<Record<KeyName, string>> {
    if (!existsSync(this.file)) return {}
    try { return JSON.parse(readFileSync(this.file, 'utf8')) } catch { return {} }
  }

  async refresh(): Promise<void> {
    const file = this.readFile()
    const next = new Map<KeyName, { key: string; info: KeyInfo }>()
    const found = (() => { try { return this.discover?.() ?? [] } catch { return [] } })()
    this.bases = new Map(found.filter(p => p.base).map(p => [p.service, p.base!]))
    for (const name of KEY_NAMES) {
      let hit: { key: string; info: KeyInfo } | undefined
      // First the providers set up in DSH (whatever their key is called), then the usual names.
      const fromDsh = found.filter(p => p.service === name && p.ref)
      const refs = [...fromDsh.map(p => ({ ref: p.ref!, provider: p.name })), ...KEY_REFS[name].map(ref => ({ ref, provider: undefined }))]
      for (const { ref, provider } of refs) {
        const r = await this.creds?.resolve(ref).catch(() => undefined)
        if (r?.value.trim()) { hit = { key: r.value.trim(), info: { set: true, source: r.source === 'file' || provider ? 'dsh' : 'env', ref, provider } }; break }
      }
      if (!hit && file[name]?.trim()) hit = { key: file[name]!.trim(), info: { set: true, source: 'page' } }
      if (!hit && this.settings()[name]?.trim()) hit = { key: this.settings()[name]!.trim(), info: { set: true, source: 'settings' } }
      if (!hit && !this.creds) {
        for (const ref of KEY_REFS[name]) {
          const v = process.env[ref]?.trim()
          if (v) { hit = { key: v, info: { set: true, source: 'env', ref } }; break }
        }
      }
      if (hit) next.set(name, { key: hit.key, info: { ...hit.info, hint: mask(hit.key) } })
    }
    this.cache = next
  }

  get(name: KeyName): string | undefined {
    return this.cache.get(name)?.key
  }

  info(name: KeyName): KeyInfo {
    return this.cache.get(name)?.info ?? { set: false }
  }

  all(): Record<KeyName, KeyInfo> {
    return Object.fromEntries(KEY_NAMES.map(n => [n, this.info(n)])) as Record<KeyName, KeyInfo>
  }

  /** Save (or with an empty value, remove) a key entered on the page: into DSH's store when there is one. */
  async save(name: KeyName, key: string): Promise<void> {
    if (this.creds) {
      // Replace the stored key under the name it already has (e.g. GOOGLE_API_KEY), else the usual name.
      const cur = this.info(name)
      const ref = cur.source === 'dsh' && cur.ref ? cur.ref : KEY_REFS[name][0]
      if (key.trim()) await this.creds.set(ref, key.trim())
      else if (cur.source === 'dsh') await this.creds.unset(ref)
    } else {
      const all = this.readFile()
      if (key.trim()) all[name] = key.trim(); else delete all[name]
      writeFileSync(this.file, JSON.stringify(all, null, 2), { mode: 0o600 })
      try { chmodSync(this.file, 0o600) } catch {}
    }
    await this.refresh()
  }
}
