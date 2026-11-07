/**
 * Browser-side shared state for dsh-live:
 * - one EventSource to /live/api/bus ("show this video" from tools and /video);
 * - the video page: open or not, and which session it is bound to.
 */

type Listener = () => void

export interface OpenRequest { sessionId: string; jobId: string }

export interface PageState {
  open: boolean
  /** Session whose video and chat the page shows. */
  sessionId?: string
  /** Session that was current before the page took over (restored on close). */
  returnTo?: string
  /** Link to load when the page opens (paste chip, sidebar). */
  pending?: string
}

let page: PageState = { open: false }
const pageListeners = new Set<Listener>()
const openListeners = new Set<(r: OpenRequest) => void>()
let source: EventSource | undefined

export const pageStore = {
  get: () => page,
  set(patch: Partial<PageState>) { page = { ...page, ...patch }; for (const l of pageListeners) l() },
  subscribe(l: Listener) { pageListeners.add(l); return () => { pageListeners.delete(l) } },
}

/** The last frame the user saw (small JPEG), for the sidebar entry while work goes on elsewhere. */
export interface LastFrame { dataUrl: string; jobId: string; conversationId: string; title?: string }
let lastFrame: LastFrame | undefined
try { const raw = sessionStorage.getItem('dsh-live.lastFrame'); if (raw) lastFrame = JSON.parse(raw) } catch {}
const frameListeners = new Set<Listener>()
export const frameStore = {
  get: () => lastFrame,
  set(f: LastFrame) {
    lastFrame = f
    try { sessionStorage.setItem('dsh-live.lastFrame', JSON.stringify(f)) } catch {}
    for (const l of frameListeners) l()
  },
  subscribe(l: Listener) { frameListeners.add(l); return () => { frameListeners.delete(l) } },
}

/** Subscribe to "show video" requests; the first subscriber opens the stream. */
export function onOpenRequest(fn: (r: OpenRequest) => void): () => void {
  openListeners.add(fn)
  if (!source) {
    source = new EventSource('/live/api/bus')
    source.addEventListener('show', e => {
      const data = (e as MessageEvent).data
      if (typeof data !== 'string') return
      try { const r = JSON.parse(data) as OpenRequest; for (const l of openListeners) l(r) } catch {}
    })
  }
  return () => {
    openListeners.delete(fn)
    if (!openListeners.size) { source?.close(); source = undefined }
  }
}

/** Video links worth offering to open in the player. */
export const VIDEO_LINK = /\bhttps?:\/\/(?:www\.|m\.|live\.)?(?:youtube\.com\/(?:watch|live|shorts)|youtu\.be\/|bilibili\.com\/(?:video|bangumi)|b23\.tv\/|live\.bilibili\.com\/|twitch\.tv\/|vimeo\.com\/|x\.com\/\S+\/status|twitter\.com\/\S+\/status|douyin\.com\/|v\.douyin\.com\/|ixigua\.com\/|weibo\.com\/tv|tiktok\.com\/|kick\.com\/|xiaoyuzhoufm\.com\/episode\/)\S*|\b\S+\.m3u8\b|\brtmps?:\/\/\S+|\bsrt:\/\/\S+/i
