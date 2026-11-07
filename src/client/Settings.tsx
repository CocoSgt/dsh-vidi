import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons.tsx'
import type { LiveKey } from './locales.ts'

export interface KeyInfo { set: boolean; source?: 'dsh' | 'settings' | 'env' | 'page'; ref?: string; hint?: string }
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
  mode: 'realtime' | 'polished'
  onMode: (m: 'realtime' | 'polished') => void
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
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) onOpen(false) }
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
  const from = key.source === 'dsh' ? t('set.key.fromDsh') : key.source === 'env' ? t('set.key.fromEnv') : ''

  return (
    <div className="dshl-pick" ref={box}>
      <button className={`dshl-ctl icon ${open ? 'on' : ''}`} onClick={() => onOpen(!open)} title={t('in.settings')} aria-expanded={open}><Icon.gear /></button>
      {open && (
        <div className="dshl-pop settings right">
          <div className="srow">
            <span title={t('set.engine.tip')}>{t('set.engine')}</span>
            <select value={engine} disabled={disabled} onChange={e => onEngine(e.target.value)}>
              {providers.map(p => <option key={p.id} value={p.id}>{name(p.id)}{p.ready ? '' : ` · ${t(p.online ? 'set.engine.noKey' : 'set.engine.notInstalled')}`}</option>)}
            </select>
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
              <select value={models?.chosen ? modelKey(models.chosen) : ''} onChange={e => chooseModel(e.target.value)}>
                <option value="">{models?.fallback ? t('set.model.default').replace('{m}', modelName(models.fallback)) : t('set.model.dsh')}</option>
                {providersOf.map(pn => (
                  <optgroup key={pn} label={pn}>
                    {models!.models.filter(m => m.providerName === pn).map(m => <option key={modelKey(m)} value={modelKey(m)}>{m.name}{m.image ? ` · ${t('set.model.image')}` : ''}</option>)}
                  </optgroup>
                ))}
              </select>
            </span>
            <span className="hint">{t(sees ? 'set.model.sees' : 'set.model.text')}</span>
          </div>
          <div className="srow">
            <span>{t('set.mode')}</span>
            <span className="dshl-seg">
              <button className={mode === 'realtime' ? 'on' : ''} title={t('mode.realtime.tip')} onClick={() => onMode('realtime')}>{t('mode.realtime')}</button>
              <button className={mode === 'polished' ? 'on' : ''} title={t('mode.polished.tip')} onClick={() => onMode('polished')}>{t('mode.polished')}</button>
            </span>
          </div>
          <div className="srow">
            <span>{t('set.spoken')}</span>
            <select value={spoken} disabled={disabled} onChange={e => onSpoken(e.target.value)}>
              <option value="auto">{t('set.auto')}</option>
              {langOptions.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="srow" title={t('set.login.tip')}>
            <span>{t('set.login')}</span>
            <select value={login} onChange={e => onLogin(e.target.value)}>
              <option value="auto">{t('set.auto')}</option>
              {browsers.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
              <option value="none">{t('set.login.none')}</option>
            </select>
          </div>
        </div>
      )}
    </div>
  )
}
