/**
 * dsh-stream browser half:
 * - a "Video" tab beside Chat in every conversation (conversation.view);
 * - a "Watch video" button in the sidebar footer that opens the full video page (shell.overlay);
 * - a prompt above the composer when a video link is pasted (conversation.input.dock);
 * - "show this video" requests from DeepSeek's live_open tool and the /video command.
 */
import { onOpenRequest, pageStore } from './bus.ts'
import { LiveView, type LiveViewInjected } from './LiveView.tsx'
import { en, NS, zh, type LiveKey } from './locales.ts'
import { ensureStyles } from './styles.ts'
import { openPage, PasteChip, SidebarButton, VideoPage, type SessionsLike } from './VideoPage.tsx'

export const inject = ['slots', 'locale', 'sessions', 'workspaces']

/**
 * The conversation services the pages use, the same on older and newer
 * DS-Harness: newer versions open conversations through uiWorkspace, mark the
 * one on screen as retained by the main view, and assemble messages in
 * uiConversation.
 */
function sessionsOf(ctx: any, extra: { uiWorkspace?: any; uiConversation?: any }): SessionsLike {
  const s = ctx.sessions
  const list = () => s.list.getSnapshot()
  return {
    current: () => list().current ?? (Object.values(list().byId ?? {}) as any[]).find(x => (x?.retainedBy?.mainView ?? 0) > 0)?.id,
    has: id => !!list().byId?.[id],
    open: id => (extra.uiWorkspace?.openSession ? extra.uiWorkspace.openSession(id) : s.open(id)),
    create: o => s.create(o),
    face: id => s.binding(id)?.session,
    chat: id => {
      const b = s.binding(id)
      if (!b || !extra.uiConversation) return undefined
      try { return extra.uiConversation.binding(b).target('chat') } catch { return undefined }
    },
    subscribe: fn => s.list.subscribe(fn),
  }
}

export function apply(ctx: any): void {
  ensureStyles()
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-stream: dictionaries')
  const t = ctx.locale.bind(NS) as (key: LiveKey) => string
  // Newer DS-Harness services, picked up when present (older versions have neither).
  const extra: { uiWorkspace?: any; uiConversation?: any } = {}
  ctx.inject(['uiWorkspace'], (c: any) => { c.effect(() => { extra.uiWorkspace = c.uiWorkspace; return () => { extra.uiWorkspace = undefined } }, 'dsh-stream: workspace navigation') })
  ctx.inject(['uiConversation'], (c: any) => { c.effect(() => { extra.uiConversation = c.uiConversation; return () => { extra.uiConversation = undefined } }, 'dsh-stream: conversation view') })
  let adapter: SessionsLike | undefined
  const sessions = (): SessionsLike => (adapter ??= sessionsOf(ctx, extra))

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'live',
    order: 30,
    locale: NS,
    label: () => t('view.live'),
    inject: (sessionId: string): LiveViewInjected => ({ sessionId, t }),
  }, LiveView))

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'dsh-stream',
    order: 50,
    label: () => t('page.open'),
    inject: () => ({ sessions: sessions(), workspaces: ctx.workspaces, t }),
  }, SidebarButton))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'dsh-stream.page',
    order: 50,
    label: () => t('page.open'),
    inject: () => ({ sessions: sessions(), t }),
  }, VideoPage))

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'dsh-stream.paste',
    order: 40,
    inject: (sessionId: string) => ({ sessionId, sessions: sessions(), t }),
  }, PasteChip))

  // DeepSeek (live_open) or /video asked to show a video: open the page for that conversation
  // when it is the one on screen (or the page's own).
  ctx.effect(() => onOpenRequest(r => {
    const s = sessions()
    if (!s) return
    const page = pageStore.get()
    if (page.open && page.sessionId === r.sessionId) return
    if (s.current() !== r.sessionId) return
    void openPage(s, { sessionId: r.sessionId })
  }), 'dsh-stream: open requests')
}
