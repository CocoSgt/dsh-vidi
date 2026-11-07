import type { Resolved } from './sites.ts'

/** 小宇宙 (Xiaoyuzhou) episode pages: https://www.xiaoyuzhoufm.com/episode/<id>. yt-dlp has no extractor for them. */
export const XIAOYUZHOU = /^https?:\/\/(?:www\.)?xiaoyuzhoufm\.com\/episode\/([0-9a-f]{16,32})/i

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36'

const text = (html: string) => html
  .replace(/<br\s*\/?>|<\/p>|<\/li>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\n{3,}/g, '\n\n').trim()

/**
 * An episode is read from the page's own data: the full audio (m4a), its
 * length, the show and the show notes (names, guests, topics — good
 * background for polishing and the glossary), and the cover, which becomes
 * the picture. Video episodes only show a one-minute preview on the web (the
 * full video needs the app and a login), so they open as audio with the
 * cover too.
 */
export async function resolveXiaoyuzhou(url: string): Promise<Resolved & { cover?: string }> {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(20_000) })
  if (!r.ok) throw new Error(`小宇宙 page: HTTP ${r.status}`)
  const html = await r.text()
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)
  if (!m) throw new Error('小宇宙 page: no episode data')
  const ep = JSON.parse(m[1]!)?.props?.pageProps?.episode
  const audio: string | undefined = ep?.enclosure?.url ?? ep?.media?.source?.url
  if (!audio) throw new Error(ep?.payType && ep.payType !== 'FREE' ? '小宇宙: this is a paid episode; it needs the app and a login' : '小宇宙 page: no audio')
  const podcast = ep.podcast ?? {}
  const notes = text(String(ep.shownotes || ep.description || ''))
  const brief = [
    `Title: ${ep.title}`,
    podcast.title && `Podcast: ${podcast.title}${podcast.author ? ` (${podcast.author})` : ''}`,
    podcast.description && `About the podcast: ${text(String(podcast.description)).slice(0, 400)}`,
    notes && `Show notes: ${notes.slice(0, 2400)}`,
  ].filter(Boolean).join('\n')
  const cover: string | undefined = ep.video?.cover?.picUrl ?? ep.image?.picUrl ?? podcast.image?.picUrl
  return {
    title: ep.title,
    isLive: false,
    duration: typeof ep.duration === 'number' ? ep.duration : undefined,
    inputs: [{ url: audio, headers: { 'user-agent': UA, referer: 'https://www.xiaoyuzhoufm.com/' }, vcodec: 'none', acodec: 'aac' }],
    siteTracks: [],
    brief,
    heights: [],
    cover,
  }
}
