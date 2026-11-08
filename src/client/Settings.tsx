import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons.tsx'
import type { LiveKey } from './locales.ts'
import { Pick } from './Pick.tsx'

export interface KeyInfo { set: boolean; source?: 'dsh' | 'settings' | 'env' | 'page'; ref?: string; hint?: string; provider?: string }
export interface Browser { id: string; label: string }
/** A recognition engine: this computer, or an online service with its key. */
export interface Provider { id: string; vendor?: string; model?: string; label?: string; online: boolean; region?: 'intl' | 'cn'; ready: boolean; key?: KeyInfo; keyUrl?: string }

/** Who runs a speech engine (engines of one vendor share its key). */
const vendorOf = (p: Provider) => p.vendor ?? p.id

/** The usual model makers, listed first whether or not they are set up in DSH yet (ids and names are matched loosely). */
const MAKERS: { id: string; label: string; re: RegExp }[] = [
  { id: 'deepseek', label: 'DeepSeek', re: /deepseek/ },
  { id: 'openai', label: 'OpenAI', re: /openai|chatgpt/ },
  { id: 'anthropic', label: 'Anthropic', re: /anthropic|claude/ },
  { id: 'google', label: 'Google', re: /google|gemini/ },
  { id: 'qwen', label: 'Qwen', re: /qwen|dashscope|aliyun|bailian|tongyi/ },
  { id: 'glm', label: 'GLM', re: /\bglm|zhipu|bigmodel|z\.ai/ },
  { id: 'kimi', label: 'Kimi', re: /kimi|moonshot/ },
  { id: 'doubao', label: 'Doubao', re: /doubao|volc|\bark\b/ },
  { id: 'minimax', label: 'MiniMax', re: /minimax/ },
  { id: 'xai', label: 'xAI', re: /\bxai\b|x\.ai|grok/ },
]
/** Which maker a DSH model provider belongs to; providers of no listed maker stand on their own. */
const makerOf = (provider: string, name: string) => MAKERS.find(m => m.re.test(`${provider} ${name}`.toLowerCase()))?.id ?? `p:${provider}`

/**
 * Subtitle models worth suggesting first: the fast, cheap tier of each family
 * (flash / mini / turbo / air / lite / haiku), newest first, and the one DSH
 * uses by default.
 */
function recommended(models: { model: string; name: string }[], fallback?: string): Set<string> {
  const ver = (n: string) => Number(/(\d+(?:\.\d+)?)/.exec(n)?.[1] ?? 0)
  // Whole words only ("Gemini" is not a "mini").
  const tier = /(^|[-_\s./])(flash|mini|turbo|air|lite|haiku)($|[-_\s./\d])/i
  const usable = models.filter(m => !/embed|tts|audio|image-|realtime|rerank/i.test(m.model))
  const fast = usable.filter(m => tier.test(m.model) || tier.test(m.name))
  // No fast tier at this provider: its newest model.
  // Versions read from the shown name first (ids like "glm-x-preview-k" carry none).
  const v = (m: { model: string; name: string }) => ver(m.name) || ver(m.model)
  const picks = (fast.length ? fast : usable).slice().sort((a, b) => v(b) - v(a)).slice(0, fast.length ? 2 : 1).map(m => m.model)
  if (fallback && models.some(m => m.model === fallback) && !picks.includes(fallback)) picks.unshift(fallback)
  return new Set(picks)
}

export const engineLabel = (t: (k: LiveKey) => string, id: string) => {
  const v = t(`engine.${id}` as LiveKey)
  return v === `engine.${id}` ? id : v
}

async function post(path: string, body: unknown): Promise<any> {
  const r = await fetch(`/live/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
  return j
}

/** Everything most people never touch, behind one gear: recognition and its key, mode, spoken language, site login. */
export function Settings(props: {
  engine: string
  onEngine: (e: string) => void
  mode: 'live' | 'realtime' | 'polished'
  onMode: (m: 'live' | 'realtime' | 'polished') => void
  spoken: string
  onSpoken: (l: string) => void
  langOptions: [string, string][]
  login: string
  onLogin: (l: string) => void
  browsers: Browser[]
  providers: Provider[]
  /** Keys are kept in DSH's key store (shared with its Models page). */
  shared: boolean
  name: (id: string) => string
  onKey: (id: string, k: KeyInfo) => void
  disabled?: boolean
  open: boolean
  onOpen: (v: boolean) => void
  t: (k: LiveKey) => string
}) {
  const { engine, onEngine, mode, onMode, spoken, onSpoken, langOptions, login, onLogin, browsers, providers, shared, name, onKey, disabled, open, onOpen, t } = props
  const box = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const cur = providers.find(p => p.id === engine)
  const key = cur?.key ?? { set: false }
  // Transcription: who, then which model; the key belongs to the vendor.
  const vendorName = (v: string) => { const x = t(`vendor.${v}` as LiveKey); return x === `vendor.${v}` ? name(v) : x }
  const vendors = [...new Map(providers.map(p => [vendorOf(p), p])).values()]
  const curVendor = cur ? vendorOf(cur) : 'local'
  const vendorEngines = providers.filter(p => vendorOf(p) === curVendor)

  useEffect(() => {
    if (!open) return
    // (A drop-down's list sits outside the panel, at the page's top level.)
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('.dshl-options')) onOpen(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open, onOpen])
  useEffect(() => { setDraft(''); setMsg(null) }, [engine])

  // Subtitle model (translation, polishing, glossary): the models DSH has, loaded when the panel opens.
  type ModelRow = { provider: string; providerName: string; model: string; name: string; image: boolean }
  const [models, setModels] = useState<{ models: ModelRow[]; chosen: { provider: string; model: string } | null; fallback: { provider: string; model: string } | null; current?: { provider: string; model: string } | null } | null>(null)
  useEffect(() => {
    if (!open || models) return
    fetch('/live/api/models').then(r => r.json()).then(setModels).catch(() => {})
  }, [open, models])
  const modelKey = (m?: { provider: string; model: string } | null) => (m ? `${m.provider}/${m.model}` : '')
  const modelName = (m?: { provider: string; model: string } | null) => {
    const row = models?.models.find(x => modelKey(x) === modelKey(m))
    return row?.name ?? m?.model ?? ''
  }
  const chooseModel = (key: string) => {
    const row = models?.models.find(x => modelKey(x) === key)
    const subsModel = row ? { provider: row.provider, model: row.model } : null
    setModels(v => v && { ...v, chosen: subsModel })
    void post('settings', { subsModel })
  }
  // What runs now: the user's choice, else DeepSeek's default, else what DSH picks.
  const current = models?.chosen ?? models?.fallback ?? models?.current ?? undefined
  const providersOf = [...new Map([
    ...(current && !(models?.models ?? []).some(m => m.provider === current.provider) ? [[current.provider, { id: current.provider, name: current.provider }] as const] : []),
    ...(models?.models ?? []).map(m => [m.provider, { id: m.provider, name: m.providerName }] as const),
  ]).values()]
  // Subtitle model: the maker first (as in DSH's model settings), then its model.
  const makerProviders = (maker: string) => providersOf.filter(p => (maker.startsWith('p:') ? `p:${p.id}` === maker : makerOf(p.id, p.name) === maker)).map(p => p.id)
  const [makerPick, setMakerPick] = useState<string | null>(null)
  const shownMaker = makerPick ?? (current ? makerOf(current.provider, providersOf.find(p => p.id === current.provider)?.name ?? '') : 'deepseek')
  const makerUnset = makerProviders(shownMaker).length === 0
  const chooseMaker = (maker: string) => {
    const ids = makerProviders(maker)
    if (!ids.length) { setMakerPick(maker); return }
    setMakerPick(null)
    // A maker picked: its first recommended model goes with it.
    const list = (models?.models ?? []).filter(m => ids.includes(m.provider))
    const fb = models?.fallback && ids.includes(models.fallback.provider) ? models.fallback.model : undefined
    const rec = recommended(list, fb)
    const pick = list.find(m => rec.has(m.model)) ?? list[0]
    if (pick) chooseModel(modelKey(pick))
  }
  const sees = !!models?.models.find(x => modelKey(x) === modelKey(current))?.image

  const saveKey = async (value: string) => {
    if (!cur) return
    setBusy(true); setMsg(null)
    try {
      const j = await post('keys', { name: cur.id, key: value })
      onKey(cur.id, j.key); setDraft('')
      setMsg({ ok: true, text: value ? t('set.key.ok').replace('{h}', j.key.hint ?? '') : '' })
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }
  const from = key.source === 'dsh' ? (key.provider ? t('set.key.fromDshP').replace('{p}', key.provider) : t('set.key.fromDsh')) : key.source === 'env' ? t('set.key.fromEnv') : ''

  return (
    <div className="dshl-pick" ref={box}>
      <button className={`dshl-ctl icon ${open ? 'on' : ''}`} onClick={() => onOpen(!open)} title={t('in.settings')} aria-expanded={open}><Icon.gear /></button>
      {open && (
        <div className="dshl-pop settings right">
          <div className="srow col">
            <span title={t('set.engine.tip')}>{t('set.engine')}</span>
            <span className="duo">
              <Pick value={curVendor} disabled={disabled} onChange={v => { const first = providers.find(p => vendorOf(p) === v); if (first) onEngine(first.id) }}
                options={vendors.map(p => ({ value: vendorOf(p), label: vendorName(vendorOf(p)), hint: p.ready ? undefined : t(p.online ? 'set.engine.noKey' : 'set.engine.notInstalled') }))} />
              <Pick value={engine} disabled={disabled || vendorEngines.length < 2} onChange={onEngine}
                options={vendorEngines.map((p, i) => ({ value: p.id, label: p.model ?? name(p.id), hint: t(`engine.note.${p.id}` as LiveKey) !== `engine.note.${p.id}` ? t(`engine.note.${p.id}` as LiveKey) : i === 0 && vendorEngines.length > 1 ? t('set.recommended') : undefined }))} />
            </span>
          </div>
          {cur?.online && (
            <div className="srow col">
              <span title={t(shared ? 'set.key.tip.shared' : 'set.key.tip')}>{t('set.key').replace('{s}', vendorName(curVendor))}</span>
              {key.set && !draft && (
                <span className="keyline">
                  <code>{key.hint}</code>{from && <span className="from">{from}</span>}
                  {(key.source === 'dsh' || key.source === 'page') && <button className="dshl-link" disabled={busy} onClick={() => saveKey('')}>{t('set.key.remove')}</button>}
                </span>
              )}
              <span className="keyline">
                <input type="password" autoComplete="off" spellCheck={false} placeholder={key.set ? t('set.key.replace') : t('set.key.paste')} value={draft} onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && draft.trim()) void saveKey(draft.trim()) }} />
                <button className="dshl-btn small primary" disabled={busy || !draft.trim()} onClick={() => saveKey(draft.trim())}>{busy ? '…' : t('set.key.save')}</button>
              </span>
              {msg?.text && <span className={msg.ok ? 'ok' : 'bad'}>{msg.text}</span>}
              <span className="keyfoot">
                <span>{t(shared ? 'set.key.tip.shared' : 'set.key.tip')}</span>
                {cur.keyUrl && <a href={cur.keyUrl} target="_blank" rel="noreferrer">{t('set.key.get')} ↗</a>}
              </span>
            </div>
          )}
          {cur && !cur.online && !cur.ready && <div className="srow col"><span className="hint">{t('set.local.missing')}</span></div>}
          <div className="srow col">
            <span title={t('set.model.tip')}>{t('set.model')}</span>
            <span className="duo">
              <Pick value={shownMaker} placeholder="…" onChange={chooseMaker}
                options={[
                  ...MAKERS.map(m => ({ value: m.id, label: t(`maker.${m.id}` as LiveKey) !== `maker.${m.id}` ? t(`maker.${m.id}` as LiveKey) : m.label, hint: makerProviders(m.id).length ? undefined : t('set.model.notSet') })),
                  ...providersOf.filter(p => makerOf(p.id, p.name).startsWith('p:')).map(p => ({ value: `p:${p.id}`, label: p.name, group: t('set.others') })),
                ]} />
              <Pick value={makerUnset ? '' : modelKey(current)} placeholder={makerUnset ? '—' : '…'} disabled={makerUnset} onChange={chooseModel}
                options={(() => {
                  const ids = makerProviders(shownMaker)
                  const listed = (models?.models ?? []).filter(m => ids.includes(m.provider))
                  // The model in use is always on the list, even when its provider does not list it.
                  const list = current && ids.includes(current.provider) && !listed.some(m => m.provider === current.provider && m.model === current.model)
                    ? [{ provider: current.provider, providerName: current.provider, model: current.model, name: current.model, image: false }, ...listed] : listed
                  const fb = models?.fallback && ids.includes(models.fallback.provider) ? models.fallback.model : undefined
                  const rec = recommended(list, fb)
                  const several = ids.length > 1
                  const tag = (m: ModelRow) => [several ? m.providerName : '', modelKey(m) === modelKey(models?.fallback) ? t('set.model.dshDefault') : '', m.image ? t('set.model.image') : ''].filter(Boolean).join(' · ') || undefined
                  const top = list.filter(m => rec.has(m.model))
                  return [
                    ...top.map(m => ({ value: modelKey(m), label: m.name, hint: tag(m), group: t('set.recommended') })),
                    ...list.filter(m => !top.includes(m)).map(m => ({ value: modelKey(m), label: m.name, hint: tag(m), group: top.length ? (several ? m.providerName : t('set.allModels')) : undefined })),
                  ]
                })()} />
            </span>
            {makerUnset && <span className="hint">{t('set.model.addInDsh').replace('{v}', MAKERS.find(m => m.id === shownMaker)?.label ?? shownMaker)}</span>}
            <span className="hint">{t(sees ? 'set.model.sees' : 'set.model.text')}</span>
          </div>
          <div className="srow col">
            <span className="pair">
              <span>{t('set.mode')}</span>
              <span className="dshl-seg">
                {(['live', 'realtime', 'polished'] as const).map(m => <button key={m} className={mode === m ? 'on' : ''} title={t(`mode.${m}.tip`)} onClick={() => onMode(m)}>{t(`mode.${m}`)}</button>)}
              </span>
            </span>
            <span className="hint">{t(`mode.${mode}.tip`)}</span>
          </div>
          <div className="srow">
            <span>{t('set.spoken')}</span>
            <Pick value={spoken} disabled={disabled} onChange={onSpoken} options={[{ value: 'auto', label: t('set.auto') }, ...langOptions.map(([k, v]) => ({ value: k, label: v }))]} />
          </div>
          <div className="srow" title={t('set.login.tip')}>
            <span>{t('set.login')}</span>
            <Pick value={login} onChange={onLogin} options={[{ value: 'auto', label: t('set.auto') }, ...browsers.map(b => ({ value: b.id, label: b.label })), { value: 'none', label: t('set.login.none') }]} />
          </div>
        </div>
      )}
    </div>
  )
}
