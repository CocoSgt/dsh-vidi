import { useEffect, useState, useSyncExternalStore } from 'react'
import { frameStore, pageStore, VIDEO_LINK } from './bus.ts'
import type { SessionFaceLike } from './ChatPanel.tsx'
import { Icon } from './icons.tsx'
import type { LiveKey } from './locales.ts'
import { LiveView } from './LiveView.tsx'

/** The client services this page uses (DS-Harness ctx.sessions). */
/** A changing value the page can subscribe to (DS-Harness snapshot sources). */
export interface Source<T> { getSnapshot(): T; subscribe(fn: () => void): () => void }

/** The conversation services this page uses, smoothed over DS-Harness versions (see index.ts). */
export interface SessionsLike {
  /** The conversation on screen. */
  current(): string | undefined
  has(id: string): boolean
  open(id: string): void
  create(opts: { cwd?: string; workspaceId?: string }): Promise<string>
  /** Send, stop, running state. */
  face(id: string): SessionFaceLike | undefined
  /** The conversation's messages (newer DS-Harness keeps them apart from the session state). */
  chat(id: string): Source<any> | undefined
  /** Fires when the conversation list changes (opened, created, loaded). */
  subscribe(fn: () => void): () => void
  /** Rename a conversation (newer DS-Harness). */
  rename?(id: string, title: string): void
  /** A conversation's title and folder, when the list has it. */
  info?(id: string): { title?: string; cwd?: string } | undefined
}

const PAGE_SESSION = 'dsh-live.pageSession'

/** The id of the video page among DS-Harness's main panels (beside the conversation, Plugins…). */
export const PANEL_ID = 'vidi'

/**
 * Newer DS-Harness (ctx.layout): the page is one of the main panels, so the
 * sidebar stays with it and opens and closes with the app's own button.
 * Without it the page covers the window (shell.overlay) with a back button.
 */
export interface PanelHost {
  select(id: string | null): void
  info: Source<{ activePanelId: string | null }>
}
let panelHost: PanelHost | undefined
export function setPanelHost(host: PanelHost | undefined): () => void {
  panelHost = host
  if (!host) return () => {}
  // Another panel or a conversation chosen in the sidebar: the page is no longer on screen.
  const sync = () => {
    const here = host.info.getSnapshot().activePanelId === PANEL_ID
    if (pageStore.get().open !== here) pageStore.set({ open: here, ...(here ? {} : { pending: undefined }) })
  }
  const off = host.info.subscribe(sync)
  return () => { off(); if (panelHost === host) panelHost = undefined }
}
export const inPanel = () => !!panelHost

export interface WorkspacesLike {
  create(input: { path: string }): Promise<{ workspaceId?: string; id?: string; title?: string }>
  rename(workspaceId: string, title: string): Promise<unknown>
  /** Newer DS-Harness: the registered workspaces. */
  list?: { getSnapshot(): { items?: readonly { workspaceId: string; path: string; title: string }[] } }
}

const samePath = (a?: string, b?: string) => !!a && !!b && a.replace(/\/+$/, '') === b.replace(/\/+$/, '')

/**
 * The video page's own conversation: reused while it exists, created when not.
 * It lives in a "Video" workspace on the video folder, so DeepSeek's own file
 * and shell tools can work on the recordings, clips and frames directly.
 */
async function pageSession(sessions: SessionsLike, workspaces: WorkspacesLike, title: string, fresh = false): Promise<string> {
  let saved: string | null = null
  try { saved = localStorage.getItem(PAGE_SESSION) } catch {}
  if (!fresh && saved && sessions.has(saved)) return saved
  const deps = await fetch('/live/api/deps').then(r => r.json())
  if (!deps?.dataDir) throw new Error('the video plugin is not running yet')
  // The video folder may already be a workspace (an earlier install): reuse it rather than create it again.
  const known = () => workspaces.list?.getSnapshot().items?.find(w => samePath(w.path, deps.dataDir))
  let ws: { workspaceId?: string; id?: string; title?: string } | undefined = known()
  if (!ws) ws = await workspaces.create({ path: deps.dataDir }).catch(err => { const again = known(); if (again) return again; throw err })
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
  try {
    await showPage(sessions, opts)
  } catch (err) {
    // Say why instead of doing nothing.
    console.error('[dsh-vidi] could not open the video page', err)
    pageStore.set({ error: (err as Error).message || String(err) })
    setTimeout(() => { if (pageStore.get().error) pageStore.set({ error: undefined }) }, 6000)
  }
}

async function showPage(sessions: SessionsLike, opts: { sessionId?: string; pending?: string; workspaces?: WorkspacesLike; title?: string }): Promise<void> {
  const current = sessions.current()
  const sid = opts.sessionId ?? await pageSession(sessions, opts.workspaces!, opts.title ?? 'Video')
  if (sid !== current) sessions.open(sid)
  if (panelHost) {
    // Opening a conversation shows its chat; then put the video page in its place.
    pageStore.set({ open: true, sessionId: sid, returnTo: undefined, pending: opts.pending })
    panelHost.select(PANEL_ID)
    return
  }
  const prev = pageStore.get()
  pageStore.set({ open: true, sessionId: sid, returnTo: prev.open ? prev.returnTo : (sid !== current ? current : undefined), pending: opts.pending })
}

export function closePage(sessions: SessionsLike): void {
  const { returnTo } = pageStore.get()
  pageStore.set({ open: false, pending: undefined })
  if (returnTo && sessions.has(returnTo)) sessions.open(returnTo)
}

/** The video folder (the "Video" workspace), asked once. */
let dataDirP: Promise<string | undefined> | undefined
const videoFolder = () => (dataDirP ??= fetch('/live/api/deps').then(r => r.json()).then(d => d?.dataDir as string | undefined).catch(() => { dataDirP = undefined; return undefined }))

/**
 * Each video gets a conversation of its own, named after it ("▶ title"), so
 * the history lists videos rather than a row of "Untitled". This applies to
 * the conversations in the video folder; a chat elsewhere that opened a video
 * keeps its own name and switches video in place.
 */
export function videoHandlers(sessions: SessionsLike, workspaces: WorkspacesLike | undefined, sessionId: string, fallbackTitle: string) {
  const own = async () => {
    const cwd = sessions.info?.(sessionId)?.cwd
    const dir = await videoFolder()
    return !!cwd && !!dir && samePath(cwd, dir)
  }
  return {
    onNewVideo: async (link: string): Promise<boolean> => {
      if (!workspaces || !(await own())) return false
      try {
        const id = await pageSession(sessions, workspaces, fallbackTitle, true)
        await openPage(sessions, { sessionId: id, pending: link, workspaces })
        return true
      } catch { return false }
    },
    onTitle: (title: string) => {
      void own().then(yes => {
        const now = sessions.info?.(sessionId)?.title
        // Untitled, or named by this page before: name it after the video. A name the user gave stays.
        if (yes && sessions.rename && (!now || now.startsWith('▶ '))) sessions.rename(sessionId, `▶ ${title}`.slice(0, 80))
      })
    },
  }
}

/** The video page as a main panel (newer DS-Harness): the app's sidebar and its toggle stay. */
export function VideoPanel(props: { sessions: SessionsLike; workspaces?: WorkspacesLike; t: (k: LiveKey) => string }) {
  const { sessions, workspaces, t } = props
  const page = useSyncExternalStore(pageStore.subscribe, pageStore.get)
  const face = useSyncExternalStore(sessions.subscribe, () => page.sessionId ? sessions.face(page.sessionId) : undefined)
  const chat = useSyncExternalStore(sessions.subscribe, () => page.sessionId ? sessions.chat(page.sessionId) : undefined)
  if (!page.sessionId) return null
  return (
    <div className="dshl-panelwrap">
      <LiveView key={page.sessionId} sessionId={page.sessionId} t={t} page
        chatFace={face} chatSource={chat} {...videoHandlers(sessions, workspaces, page.sessionId, t('view.live'))}
        pending={page.pending} onPendingDone={() => pageStore.set({ pending: undefined })} />
    </div>
  )
}

/** Full-window video page (shell.overlay, older DS-Harness): player, subtitles, terms and the chat with DeepSeek. */
export function VideoPage(props: { sessions: SessionsLike; workspaces?: WorkspacesLike; t: (k: LiveKey) => string }) {
  const { sessions, workspaces, t } = props
  const page = useSyncExternalStore(pageStore.subscribe, pageStore.get)
  // The session's handles appear once it is open: follow the list until they do.
  const face = useSyncExternalStore(sessions.subscribe, () => page.sessionId ? sessions.face(page.sessionId) : undefined)
  const chat = useSyncExternalStore(sessions.subscribe, () => page.sessionId ? sessions.chat(page.sessionId) : undefined)
  if (page.error && !page.open) return <div className="dshl-toast" role="alert">{t('page.failed').replace('{e}', page.error)}</div>
  if (inPanel() || !page.open || !page.sessionId) return null
  return (
    <div className="dshl-pagewrap">
      <LiveView key={page.sessionId} sessionId={page.sessionId} t={t}
        chatFace={face} chatSource={chat} {...videoHandlers(sessions, workspaces, page.sessionId, t('view.live'))}
        onClose={() => closePage(sessions)}
        pending={page.pending} onPendingDone={() => pageStore.set({ pending: undefined })} />
    </div>
  )
}

interface Activity { items: { jobId: string; conversationId: string; title?: string; recording: boolean; loading: boolean; subs?: string; at: number; duration?: number }[]; downloads: number }

/** Sidebar entry: opens the video page; while work goes on it shows where you left off and what is running. */
export function SidebarButton(props: { wide?: boolean; sessions: SessionsLike; workspaces: WorkspacesLike; t: (k: LiveKey) => string }) {
  const { wide, sessions, workspaces, t } = props
  const [act, setAct] = useState<Activity>({ items: [], downloads: 0 })
  const frame = useSyncExternalStore(frameStore.subscribe, frameStore.get)
  const page = useSyncExternalStore(pageStore.subscribe, pageStore.get)
  useEffect(() => {
    let alive = true
    const poll = () => fetch('/live/api/activity').then(r => r.json()).then(a => { if (alive) setAct({ items: Array.isArray(a?.items) ? a.items : [], downloads: Number(a?.downloads) || 0 }) }).catch(() => {})
    void poll()
    const id = setInterval(poll, 3000)
    return () => { alive = false; clearInterval(id) }
  }, [])
  // The job the user last looked at, if still working; else any working job.
  const item = act.items.find(i => i.jobId === frame?.jobId) ?? act.items[0]
  const busy = !!item || act.downloads > 0
  const live = !!item?.recording
  const pct = item?.subs === 'running' && item.duration ? Math.min(99, Math.round((item.at / item.duration) * 100)) : undefined
  const meta = !busy ? '' : item?.subs === 'running' ? (pct !== undefined ? t('side.subs').replace('{p}', String(pct)) : t('side.subsLive'))
    : item?.recording ? t('side.recording') : item?.loading ? t('side.loading') : t('side.downloading')
  const thumb = busy && frame && (!item || frame.jobId === item.jobId) ? frame.dataUrl : undefined
  const open = () => void openPage(sessions, item ? { sessionId: item.conversationId } : { workspaces, title: t('view.live') })
  const tip = busy ? `${t('page.open')} · ${item?.title ?? ''} · ${meta}` : t('page.open')
  return (
    <button className={`dshl-sidebtn ${wide ? 'wide' : 'rail'} ${busy ? 'busy' : ''} ${page.open ? 'here' : ''}`} title={tip} onClick={open}
      style={thumb ? { ['--thumb' as string]: `url(${thumb})` } : undefined}>
      {thumb && <span className="bg" aria-hidden="true" />}
      <Icon.video busy={busy} live={live} />
      {wide && <span className="label">{t('page.open')}</span>}
      {wide && meta && <span className="meta">{meta}</span>}
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
