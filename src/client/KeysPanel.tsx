import { useState } from 'react'
import type { LiveKey } from './locales.ts'

export interface KeyInfo { set: boolean; source?: 'page' | 'settings' | 'env'; hint?: string }

async function call(body: unknown): Promise<any> {
  const r = await fetch('/live/api/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
  return j
}

/** Online services and their API keys. Keys are checked before saving and only a masked hint comes back. */
export function KeysPanel(props: { openai: KeyInfo; onChange: (info: KeyInfo) => void; onClose: () => void; t: (k: LiveKey) => string }) {
  const { openai, onChange, onClose, t } = props
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setMsg(null)
    try { await fn() } catch (e) { setMsg({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }
  const save = () => run(async () => {
    const j = await call({ name: 'openai', key: draft })
    onChange(j.openai); setDraft(''); setMsg({ ok: true, text: t('keys.saved') })
  })
  const test = () => run(async () => { await call({ name: 'openai', test: true }); setMsg({ ok: true, text: t('keys.works') }) })
  const remove = () => run(async () => { const j = await call({ name: 'openai', key: '' }); onChange(j.openai); setMsg({ ok: true, text: t('keys.removed') }) })

  return (
    <div className="dshl-card dshl-keys" role="dialog" aria-label={t('keys.title')}>
      <div className="head">
        <h3>{t('keys.title')}</h3>
        <button className="mini" onClick={onClose} title={t('keys.close')}>×</button>
      </div>
      <div className="svc">
        <div className="svc-head">
          <strong>OpenAI</strong>
          <span className={`dshl-tag ${openai.set ? 'ok' : ''}`}>
            {openai.set ? `${t('keys.set')} ${openai.hint ?? ''} · ${t(`keys.src.${openai.source ?? 'page'}` as LiveKey)}` : t('keys.unset')}
          </span>
        </div>
        <p className="dshl-muted">{t('keys.openai.desc')}</p>
        <div className="row">
          <input type="password" autoComplete="off" spellCheck={false} placeholder={openai.set ? t('keys.replace') : 'sk-…'}
            value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && draft.trim()) void save() }} />
          <button className="dshl-btn primary" disabled={busy || !draft.trim()} onClick={() => void save()}>{busy ? '…' : t('keys.save')}</button>
        </div>
        <div className="row actions">
          {openai.set && <button className="dshl-btn small" disabled={busy} onClick={() => void test()}>{t('keys.test')}</button>}
          {openai.set && openai.source === 'page' && <button className="dshl-btn small" disabled={busy} onClick={() => void remove()}>{t('keys.remove')}</button>}
          <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">{t('keys.get')}</a>
        </div>
        {msg && <div className={`dshl-note ${msg.ok ? '' : 'warn'}`}>{msg.text}</div>}
      </div>
      <p className="dshl-muted small">{t('keys.storage')}</p>
    </div>
  )
}
