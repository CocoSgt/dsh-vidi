/**
 * dsh-live browser half: registers the "Live" tab beside Chat in every
 * session (the conversation.view slot) and its bilingual dictionaries.
 */
import { LiveView, type LiveViewInjected } from './LiveView.tsx'
import { en, NS, zh, type LiveKey } from './locales.ts'
import { ensureStyles } from './styles.ts'

export const inject = ['slots', 'locale']

export function apply(ctx: any): void {
  ensureStyles()
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-live: dictionaries')
  const t = ctx.locale.bind(NS) as (key: LiveKey) => string
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'live',
    order: 30,
    locale: NS,
    label: () => t('view.live'),
    inject: (sessionId: string): LiveViewInjected => ({ sessionId, t }),
  }, LiveView))
}
