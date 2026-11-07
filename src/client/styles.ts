const CSS = `
.dshl { --bg: #ffffff; --panel: #f6f6f4; --ink: #1c1c1a; --muted: #6e6d68; --line: #e3e2dd; --accent: #2f6fde; --live: #d93a32;
  height: 100%; overflow: auto; background: var(--bg); color: var(--ink); font-size: 14px; }
@media (prefers-color-scheme: dark) { .dshl { --bg: #161615; --panel: #1f1f1d; --ink: #ecebe6; --muted: #9b9a94; --line: #33322f; --accent: #6d9cf0; } }
.dshl-form { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--bg); z-index: 2; }
.dshl-form input[type=text] { flex: 1 1 320px; min-width: 200px; padding: 7px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); color: var(--ink); font: inherit; }
.dshl-form select, .dshl-btn { padding: 6px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); color: var(--ink); font: inherit; cursor: pointer; }
.dshl-btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; min-width: 72px; }
.dshl-btn.stop { background: var(--live); border-color: var(--live); color: #fff; }
.dshl-seg { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.dshl-seg button { border: 0; padding: 6px 10px; background: var(--panel); color: var(--muted); font: inherit; cursor: pointer; }
.dshl-seg button.on { background: var(--accent); color: #fff; }
.dshl-hint { flex-basis: 100%; color: var(--muted); font-size: 12px; }
.dshl-warn { margin: 10px 16px 0; padding: 8px 12px; border-radius: 8px; background: rgba(217,58,50,.08); color: var(--live); font-size: 13px; }
.dshl-body { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; padding: 16px; }
@media (max-width: 960px) { .dshl-body { grid-template-columns: minmax(0, 1fr); } }
.dshl-stage { container-type: inline-size; position: relative; background: #000; border-radius: 10px; overflow: hidden; aspect-ratio: 16 / 9; }
.dshl-stage video { width: 100%; height: 100%; display: block; background: #000; }
.dshl-sub { position: absolute; left: 50%; bottom: 5%; transform: translateX(-50%); width: 88%; text-align: center; pointer-events: none; }
.dshl-sub span { display: inline; padding: 2px 10px; line-height: 1.7; background: rgba(0,0,0,.62); color: #fff; box-decoration-break: clone; -webkit-box-decoration-break: clone; border-radius: 4px; }
.dshl-sub .tgt { font-size: clamp(12px, 3.6cqw, 34px); font-weight: 600; }
.dshl-sub .src { font-size: clamp(10px, 2.4cqw, 22px); color: #e4e4e4; }
.dshl-sub .draft { color: #bdbdbd; }
.dshl-sub div + div { margin-top: 4px; }
.dshl-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #ddd; font-size: 14px; }
.dshl-bar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-top: 10px; color: var(--muted); font-size: 13px; }
.dshl-bar input[type=range] { width: 160px; accent-color: var(--accent); }
.dshl-pill { padding: 2px 10px; border-radius: 999px; border: 1px solid var(--line); }
.dshl-pill.live { color: var(--live); border-color: var(--live); }
.dshl-side { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.dshl-card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; }
.dshl-card h3 { margin: 0 0 8px; font-size: 12px; color: var(--muted); font-weight: 600; letter-spacing: .03em; }
.dshl-lines { max-height: 56vh; overflow: auto; }
.dshl-line { padding: 6px 0; border-bottom: 1px dashed var(--line); }
.dshl-line:last-child { border: 0; }
.dshl-line .t { color: var(--accent); font-variant-numeric: tabular-nums; font-size: 12px; margin-right: 6px; }
.dshl-line .tgt { font-weight: 600; }
.dshl-line .src { color: var(--muted); font-size: 13px; }
.dshl-files a { display: block; color: var(--accent); text-decoration: none; padding: 2px 0; word-break: break-all; }
.dshl-empty { padding: 48px 16px; text-align: center; color: var(--muted); }
.dshl-empty h2 { color: var(--ink); font-size: 20px; margin: 0 0 6px; }
`

let done = false
export function ensureStyles(): void {
  if (done || typeof document === 'undefined') return
  done = true
  const el = document.createElement('style')
  el.dataset.dshLive = ''
  el.textContent = CSS
  document.head.append(el)
}
