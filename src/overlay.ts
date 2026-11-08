import { createServer, type Server } from 'node:http'
import type { LiveJob } from './job.ts'
import type { Cue } from './types.ts'

/**
 * Subtitles as a page of their own, for OBS's Browser Source (or any
 * broadcast tool that layers a web page): transparent background, the newest
 * line of the video being worked on, styled like the player. It lives on a
 * fixed local port so the address in OBS keeps working across restarts.
 *
 *   http://127.0.0.1:<port>/overlay                     newest running video
 *   …/overlay?lines=zh,src&size=4.5&pos=bottom&bg=0.55  lines, size (% of width), position, box opacity
 */
export function startOverlay(port: number, current: () => LiveJob | undefined, onJob: (fn: (job: LiveJob) => void) => () => void, log: (m: string) => void): () => void {
  const clients = new Set<{ write(s: string): void }>()
  let watched: LiveJob | undefined
  let detach: (() => void) | undefined
  const send = (cue: Cue | undefined) => {
    const data = `data: ${JSON.stringify(cue ? { src: cue.src, tr: cue.tr ?? {}, final: cue.final, lang: cue.lang } : null)}\n\n`
    for (const c of clients) c.write(data)
  }
  // Follow the newest video: its lines as they come in (drafts included, so words show up as they are heard).
  const follow = (job: LiveJob | undefined) => {
    if (job === watched) return
    detach?.()
    watched = job
    if (!job) return
    const onCue = (c: Cue) => send(c)
    job.on('cue', onCue)
    detach = () => job.off('cue', onCue)
  }
  follow(current())
  const offJob = onJob(job => follow(job))

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/overlay/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'access-control-allow-origin': '*' })
      const c = { write: (s: string) => res.write(s) }
      clients.add(c)
      const last = watched?.cues.at(-1)
      if (last) res.write(`data: ${JSON.stringify({ src: last.src, tr: last.tr ?? {}, final: last.final, lang: last.lang })}\n\n`)
      const ping = setInterval(() => res.write(': ping\n\n'), 15_000)
      req.on('close', () => { clearInterval(ping); clients.delete(c) })
      return
    }
    if (url.pathname === '/overlay' || url.pathname === '/overlay/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(PAGE)
      return
    }
    if (url.pathname === '/screen' || url.pathname === '/screen/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(SCREEN)
      return
    }
    res.writeHead(404); res.end()
  })
  server.on('error', err => log(`overlay: port ${port} unavailable (${(err as Error).message})`))
  // Read-only subtitle pages: on the local network too, so a big screen or another computer can open /screen.
  server.listen(port, () => log(`overlay: http://127.0.0.1:${port}/overlay, /screen`))
  return () => { offJob(); detach?.(); server.close() }
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Vidi subtitles</title>
<style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden}
#box{position:absolute;left:50%;width:92%;transform:translateX(-50%);text-align:center;font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",system-ui,sans-serif;transition:opacity .3s}
#box div{text-wrap:balance;line-break:strict}#box div+div{margin-top:.3em}
#box span{display:inline;padding:.08em .45em;border-radius:.22em;color:#fff;line-height:1.55;-webkit-box-decoration-break:clone;box-decoration-break:clone;text-shadow:0 1px 2px rgba(0,0,0,.45)}
#box .main{font-weight:600}
#box .sub{color:#e8e8e8}
</style></head><body><div id="box"></div>
<script>
const q = new URLSearchParams(location.search)
const lines = (q.get('lines') || 'zh,src').split(',')
const size = Number(q.get('size') || 4.5), bg = q.get('bg') || '0.55', pos = q.get('pos') || 'bottom', offset = Number(q.get('offset') || 6)
const box = document.getElementById('box')
box.style[pos === 'top' ? 'top' : 'bottom'] = offset + '%'
let hide
function show(c) {
  clearTimeout(hide)
  if (!c) { box.style.opacity = 0; return }
  const seen = new Set()
  const rows = lines.map(k => (k === 'src' ? c.src : (c.tr || {})[k]) || '').map(s => s.trim()).filter(s => s && !seen.has(s) && seen.add(s))
  box.innerHTML = ''
  rows.forEach((text, i) => {
    const d = document.createElement('div'), s = document.createElement('span')
    s.className = i ? 'sub' : 'main'
    s.style.fontSize = (i ? size * 0.68 : size) + 'vw'
    s.style.background = 'rgba(0,0,0,' + bg + ')'
    s.textContent = text
    d.appendChild(s); box.appendChild(d)
  })
  box.style.opacity = rows.length ? 1 : 0
  // A line stays up a while after it is finished, then the screen clears.
  if (c.final) hide = setTimeout(() => { box.style.opacity = 0 }, 6000)
}
function connect() {
  const es = new EventSource('/overlay/events')
  es.onmessage = e => { try { show(JSON.parse(e.data)) } catch {} }
  es.onerror = () => { es.close(); setTimeout(connect, 2000) }
}
connect()
</script></body></html>`

/**
 * Subtitles as the whole picture, for a big screen (a hall, a projector, a
 * second monitor, or OBS as a source of its own): 16:9, the current line large
 * with the original under it, the two before it smaller and dimmed above.
 *   …/screen?lines=zh,src&theme=dark|light
 */
const SCREEN = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vidi · subtitles</title>
<style>
html,body{margin:0;height:100%;background:#000;overflow:hidden;cursor:none}
body.light{background:#f4f3ef}
#stage{position:absolute;inset:0;margin:auto;width:min(100vw,177.78vh);height:min(56.25vw,100vh);display:flex;flex-direction:column;justify-content:flex-end;box-sizing:border-box;padding:4% 6% 7%;
  font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",system-ui,sans-serif;color:#fff;container-type:inline-size}
body.light #stage{color:#151513}
.cue{text-align:center;text-wrap:balance;line-break:strict;transition:opacity .4s,font-size .3s}
.cue+.cue{margin-top:3.2cqw}
.cue .main{display:block;font-weight:600;line-height:1.35}
.cue .sub{display:block;margin-top:.8cqw;opacity:.62;line-height:1.4}
.cue.now .main{font-size:5.4cqw}.cue.now .sub{font-size:2.9cqw}
.cue.old .main{font-size:3cqw}.cue.old .sub{font-size:1.9cqw}
.cue.old{opacity:.38}.cue.old2{opacity:.2}
.cue.draft .main{opacity:.75}
</style></head><body><div id="stage"></div>
<script>
const q = new URLSearchParams(location.search)
const lines = (q.get('lines') || 'zh,src').split(',')
if (q.get('theme') === 'light') document.body.classList.add('light')
const stage = document.getElementById('stage')
let done = [], draft = null
function texts(c) {
  const seen = new Set()
  return lines.map(k => (k === 'src' ? c.src : (c.tr || {})[k]) || '').map(s => s.trim()).filter(s => s && !seen.has(s) && seen.add(s))
}
function render() {
  const list = [...done.slice(-3), ...(draft ? [draft] : [])].slice(-3)
  stage.innerHTML = ''
  list.forEach((c, i) => {
    const t = texts(c); if (!t.length) return
    const d = document.createElement('div')
    const age = list.length - 1 - i
    d.className = 'cue ' + (age === 0 ? 'now' : age === 1 ? 'old' : 'old old2') + (c.final ? '' : ' draft')
    const m = document.createElement('span'); m.className = 'main'; m.textContent = t[0]; d.appendChild(m)
    if (t[1]) { const s = document.createElement('span'); s.className = 'sub'; s.textContent = t[1]; d.appendChild(s) }
    stage.appendChild(d)
  })
}
function connect() {
  const es = new EventSource('/overlay/events')
  es.onmessage = e => {
    let c; try { c = JSON.parse(e.data) } catch { return }
    if (!c) return
    if (c.final) { draft = null; if (!done.length || done.at(-1).src !== c.src) done.push(c); done = done.slice(-6) } else draft = c
    render()
  }
  es.onerror = () => { es.close(); setTimeout(connect, 2000) }
}
connect()
</script></body></html>`
