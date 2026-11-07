import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons.tsx'
import type { LiveKey } from './locales.ts'

export interface KeyInfo { set: boolean; source?: 'page' | 'settings' | 'env'; hint?: string }
export interface Browser { id: string; label: string }

async function post(path: string, body: unknown): Promise<any> {
  const r = await fetch(`/live/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
  return j
}

/** Everything most people never touch, behind one gear: engine, spoken language, site login, OpenAI key. */
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
  openai: KeyInfo
  onOpenai: (k: KeyInfo) => void
  disabled?: boolean
  open: boolean
  onOpen: (v: boolean) => void
  t: (k: LiveKey) => string
}) {
  const { engine, onEngine, mode, onMode, spoken, onSpoken, langOptions, login, onLogin, browsers, openai, onOpenai, disabled, open, onOpen, t } = props
  const box = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) onOpen(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open, onOpen])

  const saveKey = async (key: string) => {
    setBusy(true); setMsg(null)
    try {
      const j = await post('keys', { name: 'openai', key })
      onOpenai(j.openai); setDraft('')
      setMsg({ ok: true, text: key ? t('set.key.ok').replace('{h}', j.openai.hint ?? '') : '' })
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }

  return (
    <div className="dshl-pick" ref={box}>
      <button className={`dshl-ctl icon ${open ? 'on' : ''}`} onClick={() => onOpen(!open)} title={t('in.settings')} aria-expanded={open}><Icon.gear /></button>
      {open && (
        <div className="dshl-pop settings right">
          <label className="srow">
            <span>{t('set.engine')}</span>
            <span className="dshl-seg">
              <button className={engine === 'openai' ? 'on' : ''} disabled={disabled} onClick={() => onEngine('openai')}>{t('set.engine.openai')}</button>
              <button className={engine === 'local' ? 'on' : ''} disabled={disabled} onClick={() => onEngine('local')}>{t('set.engine.local')}</button>
            </span>
          </label>
          {engine === 'openai' && (
            <div className="srow col">
              <span title={t('set.key.tip')}>{t('set.key')}</span>
              {openai.set && !draft
                ? <span className="keyline"><code>{openai.hint}</code>{openai.source === 'page' && <button className="dshl-link" disabled={busy} onClick={() => saveKey('')}>{t('set.key.remove')}</button>}</span>
                : null}
              <span className="keyline">
                <input type="password" autoComplete="off" spellCheck={false} placeholder="sk-…" value={draft} onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && draft.trim()) void saveKey(draft.trim()) }} />
                <button className="dshl-btn small primary" disabled={busy || !draft.trim()} onClick={() => saveKey(draft.trim())}>{busy ? '…' : t('set.key.save')}</button>
              </span>
              {msg?.text && <span className={msg.ok ? 'ok' : 'bad'}>{msg.text}</span>}
              {!openai.set && <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">{t('set.key.get')} ↗</a>}
            </div>
          )}
          <label className="srow">
            <span>{t('set.mode')}</span>
            <span className="dshl-seg">
              <button className={mode === 'realtime' ? 'on' : ''} title={t('mode.realtime.tip')} onClick={() => onMode('realtime')}>{t('mode.realtime')}</button>
              <button className={mode === 'polished' ? 'on' : ''} title={t('mode.polished.tip')} onClick={() => onMode('polished')}>{t('mode.polished')}</button>
            </span>
          </label>
          <label className="srow">
            <span>{t('set.spoken')}</span>
            <select value={spoken} disabled={disabled} onChange={e => onSpoken(e.target.value)}>
              <option value="auto">{t('set.auto')}</option>
              {langOptions.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="srow" title={t('set.login.tip')}>
            <span>{t('set.login')}</span>
            <select value={login} onChange={e => onLogin(e.target.value)}>
              <option value="auto">{t('set.auto')}</option>
              {browsers.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
              <option value="none">{t('set.login.none')}</option>
            </select>
          </label>
        </div>
      )}
    </div>
  )
}
