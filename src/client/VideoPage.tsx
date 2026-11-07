import { useSyncExternalStore } from 'react'
import { pageStore, VIDEO_LINK } from './bus.ts'
import type { SessionFaceLike } from './ChatPanel.tsx'
import { Icon } from './icons.tsx'
import type { LiveKey } from './locales.ts'
import { LiveView } from './LiveView.tsx'

/** The client services this page uses (DS-Harness ctx.sessions). */
export interface SessionsLike {
  list: { getSnapshot(): { current?: string; byId: Record<string, unknown> } }
  open(id: string): void
  create(opts: { cwd?: string; workspaceId?: string }): Promise<string>
  binding(id: string): { session: SessionFaceLike } | undefined
}

const PAGE_SESSION = 'dsh-live.pageSession'

export interface WorkspacesLike {
  create(input: { path: string }): Promise<{ workspaceId?: string; id?: string; title?: string }>
  rename(workspaceId: string, title: string): Promise<unknown>
}

/**
 * The video page's own conversation: reused while it exists, created when not.
 * It lives in a "Video" workspace on the video folder, so DeepSeek's own file
 * and shell tools can work on the recordings, clips and frames directly.
 */
async function pageSession(sessions: SessionsLike, workspaces: WorkspacesLike, title: string): Promise<string> {
  let saved: string | null = null
  try { saved = localStorage.getItem(PAGE_SESSION) } catch {}
  if (saved && sessions.list.getSnapshot().byId[saved]) return saved
  const deps = await fetch('/live/api/deps').then(r => r.json()).catch(() => ({}))
  const ws = await workspaces.create({ path: deps.dataDir })
  const workspaceId = ws.workspaceId ?? ws.id
  if (workspaceId && ws.title !== title) await workspaces.rename(workspaceId, title).catch(() => {})
  const id = await sessions.create(workspaceId ? { workspaceId } : { cwd: deps.dataDir })
  try { localStorage.setItem(PAGE_SESSION, id) } catch {}
  return id
}

/**
 * Show the video page. Without a session it uses the page's own conversation;
 * with one (a conversation that asked to open a video) it shows that one.
 * The page's session becomes current so its chat is live; closing goes back.
 */
export async function openPage(sessions: SessionsLike, opts: { sessionId?: string; pending?: string; workspaces?: WorkspacesLike; title?: string } = {}): Promise<void> {
  const current = sessions.list.getSnapshot().current
  const sid = opts.sessionId ?? await pageSession(sessions, opts.workspaces!, opts.title ?? 'Video')
  if (sid !== current) sessions.open(sid)
  const prev = pageStore.get()
  pageStore.set({ open: true, sessionId: sid, returnTo: prev.open ? prev.returnTo : (sid !== current ? current : undefined), pending: opts.pending })
}

export function closePage(sessions: SessionsLike): void {
  const { returnTo } = pageStore.get()
  pageStore.set({ open: false, pending: undefined })
  if (returnTo && sessions.list.getSnapshot().byId[returnTo]) sessions.open(returnTo)
}

/** Full-window video page (shell.overlay): player, subtitles, terms and the chat with DeepSeek. */
export function VideoPage(props: { sessions: SessionsLike; t: (k: LiveKey) => string }) {
  const { sessions, t } = props
  const page = useSyncExternalStore(pageStore.subscribe, pageStore.get)
  if (!page.open || !page.sessionId) return null
  return (
    <div className="dshl-pagewrap">
      <LiveView key={page.sessionId} sessionId={page.sessionId} t={t}
        chatFace={sessions.binding(page.sessionId)?.session}
        onClose={() => closePage(sessions)}
        pending={page.pending} onPendingDone={() => pageStore.set({ pending: undefined })} />
    </div>
  )
}

/** Sidebar footer button. */
export function SidebarButton(props: { wide?: boolean; sessions: SessionsLike; workspaces: WorkspacesLike; t: (k: LiveKey) => string }) {
  const { wide, sessions, workspaces, t } = props
  return (
    <button className={`dshl-sidebtn ${wide ? 'wide' : 'rail'}`} title={t('page.open')} onClick={() => void openPage(sessions, { workspaces, title: t('view.live') })}>
      <Icon.video />{wide && <span className="label">{t('page.open')}</span>}
    </button>
  )
}

/** Above the composer: when the draft holds a video link, offer to open it in the player. */
export function PasteChip(props: { input?: { draft?: string }; sessionId: string; sessions: SessionsLike; t: (k: LiveKey) => string }) {
  const { input, sessionId, sessions, t } = props
  const m = (input?.draft ?? '').match(VIDEO_LINK)
  if (!m) return null
  const link = m[0]
  return (
    <div className="dshl-pastechip">
      <button onClick={() => void openPage(sessions, { sessionId, pending: link })}>
        <Icon.play /> {t('paste.open')} <span className="url">{link.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48)}</span>
      </button>
    </div>
  )
}
