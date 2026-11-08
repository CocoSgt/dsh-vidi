import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons.tsx'
import type { LiveKey } from './locales.ts'
import { Pick } from './Pick.tsx'

export interface KeyInfo { set: boolean; source?: 'dsh' | 'settings' | 'env' | 'page'; ref?: string; hint?: string; provider?: string }
export interface Browser { id: string; label: string }
/** A recognition engine: this computer, or an online service with its key. */
export interface Provider { id: string; label?: string; online: boolean; ready: boolean; key?: KeyInfo; keyUrl?: string }

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
  mode: 'site' | 'realtime' | 'polished'
  onMode: (m: 'site' | 'realtime' | 'polished') => void
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
  const [models, setModels] = useState<{ models: ModelRow[]; chosen: { provider: string; model: string } | null; fallback: { provider: string; model: string } | null } | null>(null)
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
  const providersOf = [...new Set((models?.models ?? []).map(m => m.providerName))]
  const current = models?.chosen ?? models?.fallback
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
          <div className="srow">
            <span title={t('set.engine.tip')}>{t('set.engine')}</span>
            <Pick value={engine} disabled={disabled} onChange={onEngine}
              options={providers.map(p => ({ value: p.id, label: name(p.id), hint: p.ready ? undefined : t(p.online ? 'set.engine.noKey' : 'set.engine.notInstalled') }))} />
          </div>
          {cur?.online && (
            <div className="srow col">
              <span title={t(shared ? 'set.key.tip.shared' : 'set.key.tip')}>{t('set.key').replace('{s}', name(cur.id))}</span>
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
            <span className="pair">
              <span title={t('set.model.tip')}>{t('set.model')}</span>
              <Pick value={models?.chosen ? modelKey(models.chosen) : ''} onChange={chooseModel}
                options={[
                  { value: '', label: models?.fallback ? t('set.model.default').replace('{m}', modelName(models.fallback)) : t('set.model.dsh') },
                  ...providersOf.flatMap(pn => models!.models.filter(m => m.providerName === pn).map(m => ({ value: modelKey(m), label: m.name, hint: m.image ? t('set.model.image') : undefined, group: pn }))),
                ]} />
            </span>
            <span className="hint">{t(sees ? 'set.model.sees' : 'set.model.text')}</span>
          </div>
          <div className="srow col">
            <span className="pair">
              <span>{t('set.mode')}</span>
              <span className="dshl-seg">
                {(['site', 'realtime', 'polished'] as const).map(m => <button key={m} className={mode === m ? 'on' : ''} title={t(`mode.${m}.tip`)} onClick={() => onMode(m)}>{t(`mode.${m}`)}</button>)}
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
