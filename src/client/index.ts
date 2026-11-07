/**
 * dsh-live browser half:
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

export function apply(ctx: any): void {
  ensureStyles()
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-live: dictionaries')
  const t = ctx.locale.bind(NS) as (key: LiveKey) => string
  const sessions = (): SessionsLike => ctx.sessions

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
    id: 'dsh-live',
    order: 50,
    label: () => t('page.open'),
    inject: () => ({ sessions: sessions(), workspaces: ctx.workspaces, t }),
  }, SidebarButton))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'dsh-live.page',
    order: 50,
    label: () => t('page.open'),
    inject: () => ({ sessions: sessions(), t }),
  }, VideoPage))

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'dsh-live.paste',
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
    if (s.list.getSnapshot().current !== r.sessionId) return
    void openPage(s, { sessionId: r.sessionId })
  }), 'dsh-live: open requests')
}
