import { Icon } from './icons.tsx'
import type { LiveKey } from './locales.ts'
import type { Browser } from './Settings.tsx'
import { Pick } from './Pick.tsx'

/** Shown when a site needs a login no browser session provided: sign in there, pick a browser, retry. */
export function LoginDialog(props: {
  site: string
  browser: string
  browsers: Browser[]
  onBrowser: (id: string) => void
  onRetry: () => void
  onClose: () => void
  t: (k: LiveKey) => string
}) {
  const { site, browser, browsers, onBrowser, onRetry, onClose, t } = props
  return (
    <div className="dshl-modal" role="dialog" aria-modal="true" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="box">
        <button className="ghost x" onClick={onClose} title={t('login.close')}><Icon.close /></button>
        <div className="ico"><Icon.lock /></div>
        <h3>{t('login.title').replace('{site}', site)}</h3>
        <p>{t('login.body')}</p>
        <div className="srow">
          <span>{t('login.from')}</span>
          <Pick value={browser} onChange={onBrowser} options={browsers.map(b => ({ value: b.id, label: b.label }))} />
        </div>
        <div className="acts">
          <a className="dshl-btn" href={`https://${site}`} target="_blank" rel="noreferrer">{t('login.open')} ↗</a>
          <button className="dshl-btn primary" onClick={onRetry}>{t('st.retry')}</button>
        </div>
      </div>
    </div>
  )
}
