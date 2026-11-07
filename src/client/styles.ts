/**
 * Styles ride on the host's design tokens (--dsw-alias-*) so the Live tab
 * follows DS-Harness's light/dark theme and accent; fallbacks keep it usable
 * on its own. Everything is prefixed .dshl to stay out of the host's way.
 */
const CSS = `
.dshl {
  --bg: var(--dsw-alias-bg-base, #ffffff);
  --l1: var(--dsw-alias-bg-layer-1, #f7f7f5);
  --l2: var(--dsw-alias-bg-layer-2, #efefec);
  --ink: var(--dsw-alias-label-primary, #1b1b19);
  --muted: var(--dsw-alias-label-secondary, #66655f);
  --faint: var(--dsw-alias-label-tertiary, #9a9993);
  --line: var(--dsw-alias-border-l2, #e4e3de);
  --line-soft: var(--dsw-alias-border-l1, #efeee9);
  --hover: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05));
  --accent: var(--dsw-alias-state-business-primary, #3b6ef5);
  --live: var(--dsw-alias-state-error-primary, #e5484d);
  --ok: var(--dsw-alias-state-success-primary, #2e9e5b);
  --warn: var(--dsw-alias-state-warn-primary, #d9822b);
  --r: 10px;
  position: relative; height: 100%; overflow: auto; background: var(--bg); color: var(--ink);
  font-size: 14px; line-height: 1.5; -webkit-font-smoothing: antialiased;
}
.dshl * { box-sizing: border-box; }
.dshl button { font: inherit; color: inherit; }
.dshl-muted { color: var(--muted); }
.dshl .pad { padding: 16px 4px; }

/* ── Top bar ── */
.dshl-top { position: sticky; top: 0; z-index: 5; background: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--line); padding: 12px 20px 10px; display: grid; gap: 10px; }
.dshl-tabs { display: flex; gap: 4px; }
.dshl-tabs button { border: 0; background: none; padding: 4px 10px; border-radius: 999px; color: var(--muted); cursor: pointer; font-size: 13px; }
.dshl-tabs button:hover:not(:disabled) { background: var(--hover); color: var(--ink); }
.dshl-tabs button.on { background: var(--ink); color: var(--bg); }
.dshl-tabs button:disabled:not(.on) { opacity: .45; cursor: default; }
.dshl-input { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dshl .field { display: flex; align-items: center; gap: 8px; padding: 0 12px; height: 38px; border: 1px solid var(--line); border-radius: var(--r);
  background: var(--l1); color: var(--faint); transition: border-color .15s, box-shadow .15s; }
.dshl .field:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
.dshl .field.grow { flex: 1 1 320px; min-width: 0; }
.dshl .field.small { height: 32px; }
.dshl .field input { flex: 1; min-width: 0; border: 0; outline: 0; background: none; color: var(--ink); font: inherit; }
.dshl-opts { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dshl select { height: 30px; padding: 0 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--l1); color: var(--ink); font: inherit; font-size: 13px; cursor: pointer; }
.dshl select.add { border-style: dashed; color: var(--muted); }
.dshl select:disabled { opacity: .6; cursor: default; }
.dshl-hint { color: var(--faint); font-size: 12px; margin-left: 4px; }

.dshl-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 38px; padding: 0 16px; border-radius: var(--r);
  border: 1px solid var(--line); background: var(--l1); cursor: pointer; font-weight: 500; text-decoration: none; color: var(--ink); white-space: nowrap; }
.dshl-btn:hover:not(:disabled) { background: var(--hover); }
.dshl-btn.small { height: 30px; padding: 0 12px; font-size: 13px; border-radius: 8px; }
.dshl-btn.block { display: flex; width: 100%; margin: 4px 0 16px; }
.dshl-btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.dshl-btn.primary:hover:not(:disabled) { filter: brightness(1.06); background: var(--accent); }
.dshl-btn.stop { background: var(--live); border-color: var(--live); color: #fff; }
.dshl-btn:disabled, .dshl-btn.disabled { opacity: .5; cursor: default; pointer-events: none; }
.dshl button.ghost { border: 0; background: none; color: var(--muted); cursor: pointer; padding: 4px 6px; border-radius: 6px; display: inline-flex; }
.dshl button.ghost:hover { background: var(--hover); color: var(--ink); }

.dshl-seg { display: inline-flex; padding: 2px; border-radius: 9px; background: var(--l2); }
.dshl-seg button { border: 0; background: none; padding: 3px 12px; border-radius: 7px; color: var(--muted); cursor: pointer; font-size: 13px; }
.dshl-seg button.on { background: var(--bg); color: var(--ink); box-shadow: 0 1px 2px rgba(0,0,0,.12); }
.dshl-seg button:disabled:not(.on) { opacity: .5; cursor: default; }
.dshl-chip { display: inline-flex; align-items: center; gap: 2px; height: 30px; padding: 0 4px 0 10px; border-radius: 999px; font-size: 13px;
  background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent); }
.dshl-chip button { border: 0; background: none; color: inherit; cursor: pointer; width: 20px; height: 20px; border-radius: 50%; opacity: .7; }
.dshl-chip button:hover { opacity: 1; background: color-mix(in srgb, var(--accent) 18%, transparent); }

.dshl-note { margin: 12px 20px 0; padding: 9px 14px; border-radius: var(--r); background: var(--l1); border: 1px solid var(--line); color: var(--muted); font-size: 13px;
  display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.dshl-note.warn { color: var(--live); border-color: color-mix(in srgb, var(--live) 35%, transparent); background: color-mix(in srgb, var(--live) 6%, var(--bg)); }

/* ── Empty state ── */
.dshl-empty { padding: 28px 20px; }
.dshl-drop { border: 1.5px dashed var(--line); border-radius: 16px; padding: 56px 24px; text-align: center; max-width: 760px; margin: 0 auto; }
.dshl-drop h2 { margin: 0 0 8px; font-size: 22px; font-weight: 650; letter-spacing: -.01em; }
.dshl-drop p { margin: 6px 0; }
.dshl-kbd { margin-top: 18px !important; color: var(--faint); font-size: 12px; }

/* ── Main layout ── */
.dshl-main { display: grid; grid-template-columns: minmax(0, 1fr) clamp(300px, 28vw, 400px); gap: 18px; padding: 18px 20px 28px; align-items: start; }
.dshl.theater .dshl-main { grid-template-columns: minmax(0, 1fr); }
.dshl.theater .dshl-side { display: none; }
@media (max-width: 1000px) { .dshl-main { grid-template-columns: minmax(0, 1fr); } }
.dshl-col { min-width: 0; display: grid; gap: 12px; }

/* ── Player ── */
.dshl-stage { container-type: inline-size; position: relative; background: #000; border-radius: 12px; overflow: hidden; aspect-ratio: 16 / 9; outline: none;
  box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 8px 28px rgba(0,0,0,.10); }
.dshl-stage.full { border-radius: 0; aspect-ratio: auto; width: 100vw; height: 100vh; }
.dshl-stage.pagefull { position: fixed; inset: 0; z-index: 2147483000; border-radius: 0; aspect-ratio: auto; width: 100vw; height: 100vh; box-shadow: none; }
.dshl-stage video { width: 100%; height: 100%; display: block; background: #000; object-fit: contain; }
.dshl-stage.idle { cursor: none; }
.dshl-overlay { position: absolute; inset: 0; display: flex; flex-direction: column; gap: 14px; align-items: center; justify-content: center; color: #cfcfcf; font-size: 14px; }
.dshl-spinner { width: 28px; height: 28px; border-radius: 50%; border: 2.5px solid rgba(255,255,255,.18); border-top-color: #fff; animation: dshl-spin .9s linear infinite; }
@keyframes dshl-spin { to { transform: rotate(360deg); } }

.dshl-sub { position: absolute; left: 50%; transform: translateX(-50%); width: 92%; text-align: center; pointer-events: none; z-index: 2; transition: bottom .2s, top .2s; }
.dshl-sub span { display: inline; padding: .08em .45em; line-height: 1.55; border-radius: .22em; background: rgba(0,0,0,var(--subbg,.62)); color: #fff;
  box-decoration-break: clone; -webkit-box-decoration-break: clone; text-shadow: 0 1px 2px rgba(0,0,0,.45); }
.dshl-sub .tgt { font-weight: 600; letter-spacing: .01em; }
.dshl-sub .src { color: #e6e6e6; }
.dshl-sub .draft { color: #b8b8b8; font-style: italic; }
.dshl-sub div + div { margin-top: .3em; }
/* Lift bottom subtitles above the control bar while it is visible. */
.dshl-stage:not(.idle) .dshl-sub[data-pos=bottom] { transform: translate(-50%, -64px); }
.dshl-stage:not(.idle) .dshl-sub[data-pos=top] { transform: translate(-50%, 34px); }
.dshl-sub { transition: transform .25s; }

.dshl-livebadge { position: absolute; top: 12px; left: 12px; z-index: 3; display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px;
  border: 0; border-radius: 6px; background: rgba(0,0,0,.55); color: #fff; font-size: 12px; font-weight: 600; letter-spacing: .04em; cursor: pointer; transition: opacity .25s; }
.dshl-livebadge svg { color: #9a9a9a; }
.dshl-livebadge.on { background: var(--live); }
.dshl-livebadge.on svg { color: #fff; animation: dshl-pulse 1.6s ease-in-out infinite; }
@keyframes dshl-pulse { 50% { opacity: .35; } }

.dshl-controls { position: absolute; left: 0; right: 0; bottom: 0; z-index: 3; padding: 26px 12px 8px; color: #fff;
  background: linear-gradient(to top, rgba(0,0,0,.72), rgba(0,0,0,0)); transition: opacity .25s; }
.dshl-stage.idle .dshl-controls, .dshl-stage.idle .dshl-livebadge { opacity: 0; }
.dshl-progress input { width: 100%; height: 4px; accent-color: var(--live); cursor: pointer; margin: 0 0 4px; }
.dshl-ctrlrow { display: flex; align-items: center; gap: 4px; }
.dshl-ctrlrow .grow { flex: 1; }
.dshl-ctrlrow .ic { width: 36px; height: 36px; border: 0; border-radius: 8px; background: none; color: #fff; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; opacity: .88; }
.dshl-ctrlrow .ic:hover { background: rgba(255,255,255,.14); opacity: 1; }
.dshl-ctrlrow .ic.on { color: #fff; background: rgba(255,255,255,.16); }
.dshl-ctrlrow .vol { width: 80px; accent-color: #fff; }
.dshl-ctrlrow .time { font-size: 12px; font-variant-numeric: tabular-nums; opacity: .85; margin-left: 6px; }
.dshl-ctrlrow .delay { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; opacity: .9; margin-right: 6px; }
.dshl-ctrlrow .delay input { width: 90px; accent-color: #fff; }
@container (max-width: 520px) { .dshl-ctrlrow .vol, .dshl-ctrlrow .delay { display: none; } }

.dshl-status { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 13px; }
.dshl-title { color: var(--ink); font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }
.dshl-pill { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px; border-radius: 999px; font-size: 12px; font-weight: 600;
  background: var(--l2); color: var(--muted); }
.dshl-pill.live { background: color-mix(in srgb, var(--live) 12%, transparent); color: var(--live); }
.dshl-pill.err { background: color-mix(in srgb, var(--live) 12%, transparent); color: var(--live); }
.dshl-pill .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; animation: dshl-pulse 1.6s ease-in-out infinite; }

.dshl-card { background: var(--l1); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
.dshl-card h3, .dshl-panel h3 { margin: 0 0 10px; font-size: 12px; font-weight: 600; color: var(--muted); letter-spacing: .04em; text-transform: uppercase; }
.dshl-card.push .kv { display: grid; grid-template-columns: 90px 1fr; gap: 8px; align-items: center; padding: 4px 0; }
.dshl-card.push p { margin: 8px 0 0; font-size: 12px; }
.dshl-copyable { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
.dshl-copyable code { font-size: 12.5px; padding: 3px 8px; border-radius: 6px; background: var(--bg); border: 1px solid var(--line); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ── Side panel ── */
.dshl-side { position: sticky; top: 132px; min-width: 0; display: flex; flex-direction: column; max-height: calc(100vh - 150px);
  background: var(--l1); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
@media (max-width: 1000px) { .dshl-side { position: static; max-height: none; } }
.dshl-sidetabs { display: flex; gap: 2px; padding: 6px; border-bottom: 1px solid var(--line); background: var(--l1); }
.dshl-sidetabs button { flex: 1; border: 0; background: none; padding: 6px 4px; border-radius: 8px; color: var(--muted); cursor: pointer; font-size: 13px; white-space: nowrap; }
.dshl-sidetabs button:hover { background: var(--hover); color: var(--ink); }
.dshl-sidetabs button.on { background: var(--bg); color: var(--ink); font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.dshl-sidetabs em { font-style: normal; margin-left: 4px; font-size: 11px; padding: 0 5px; border-radius: 999px; background: var(--l2); color: var(--muted); }
.dshl-panel { padding: 12px 14px 16px; overflow: auto; min-height: 0; }
.dshl-tools { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
.dshl-check { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); cursor: pointer; white-space: nowrap; }
.dshl-check input { accent-color: var(--accent); }
.dshl-checks { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-bottom: 16px; }

.dshl-lines { display: flex; flex-direction: column; gap: 2px; max-height: calc(100vh - 290px); overflow: auto; margin: 0 -6px; }
@media (max-width: 1000px) { .dshl-lines { max-height: 60vh; } }
.dshl-line { display: grid; grid-template-columns: 46px 1fr; gap: 6px; text-align: left; border: 0; background: none; padding: 7px 6px; border-radius: 8px; cursor: pointer; color: var(--ink); }
.dshl-line:hover { background: var(--hover); }
.dshl-line.active { background: color-mix(in srgb, var(--accent) 10%, transparent); }
.dshl-line .ts { color: var(--faint); font-size: 12px; font-variant-numeric: tabular-nums; padding-top: 2px; }
.dshl-line.active .ts { color: var(--accent); font-weight: 600; }
.dshl-line .txt { display: grid; gap: 2px; }
.dshl-line .tgt { font-weight: 550; }
.dshl-line .src { color: var(--muted); font-size: 13px; }

.dshl-presets { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; font-size: 13px; }
.dshl-subcfg { border: 0; background: none; padding: 0; }
.dshl-subcfg .row { display: grid; grid-template-columns: 20px 1fr 120px 26px 26px; gap: 8px; align-items: center; padding: 5px 0; font-size: 13px; }
.dshl-subcfg input[type=range] { width: 100%; accent-color: var(--accent); }
.dshl-subcfg input[type=checkbox] { accent-color: var(--accent); }
.dshl-subcfg .opt { display: grid; grid-template-columns: 110px 1fr; gap: 8px; align-items: center; padding: 7px 0; font-size: 13px; color: var(--muted); }
.dshl-subcfg .mini { height: 26px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--muted); cursor: pointer; }
.dshl-subcfg .mini:hover { color: var(--ink); }
.dshl-subcfg > .dshl-btn { margin-top: 8px; height: 30px; font-size: 13px; }

.dshl-gl-add { display: grid; grid-template-columns: 1fr; gap: 6px; margin: 10px 0 14px; }
.dshl-gl-add input, .dshl-gl input { height: 30px; padding: 0 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--ink); font: inherit; font-size: 13px; min-width: 0; }
.dshl-gl { display: grid; gap: 8px; }
.dshl-gl .row { display: grid; grid-template-columns: 1fr auto; gap: 6px; padding: 10px; border: 1px solid var(--line-soft); border-radius: 10px; background: var(--bg); }
.dshl-gl .row > input { grid-column: 1; }
.dshl-gl .row > button { grid-column: 2; grid-row: 1; align-self: start; }
.dshl-gl .term { display: flex; align-items: center; gap: 8px; }
.dshl-gl .tag { font-size: 11px; padding: 0 6px; border-radius: 999px; background: var(--l2); color: var(--faint); }
.dshl-gl .tag.user { background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent); }

.dshl-file { display: flex; align-items: center; gap: 8px; padding: 6px 8px; margin: 0 -8px; border-radius: 8px; color: var(--ink); text-decoration: none; font-size: 13px; word-break: break-all; }
.dshl-file:hover { background: var(--hover); }
.dshl-file svg { color: var(--faint); flex: none; }

.dshl-dropzone { position: absolute; inset: 0; z-index: 20; display: flex; align-items: center; justify-content: center; padding: 24px;
  background: color-mix(in srgb, var(--accent) 10%, color-mix(in srgb, var(--bg) 85%, transparent)); }
.dshl-dropzone div { padding: 40px 56px; border: 2px dashed var(--accent); border-radius: 18px; color: var(--accent); font-size: 17px; font-weight: 600; background: var(--bg); }

/* Services & keys */
.dshl-keys { margin: 0 20px 4px; max-width: 560px; box-shadow: 0 8px 28px rgba(0,0,0,.08); }
.dshl-keys .head { display: flex; align-items: center; justify-content: space-between; }
.dshl-keys .head h3 { margin: 0; }
.dshl-keys .mini { width: 26px; height: 26px; border: 0; border-radius: 6px; background: none; color: var(--muted); cursor: pointer; font-size: 18px; line-height: 1; }
.dshl-keys .mini:hover { background: var(--hover); color: var(--ink); }
.dshl-keys .svc { margin-top: 10px; display: grid; gap: 8px; }
.dshl-keys .svc-head { display: flex; align-items: center; gap: 10px; }
.dshl-keys .svc p { margin: 0; font-size: 12.5px; line-height: 1.55; }
.dshl-keys .row { display: flex; gap: 8px; align-items: center; }
.dshl-keys .row input { flex: 1; min-width: 0; height: 38px; padding: 0 12px; border: 1px solid var(--line); border-radius: var(--r); background: var(--bg); color: var(--ink); font: inherit; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.dshl-keys .row input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
.dshl-keys .row.actions { gap: 10px; font-size: 13px; }
.dshl-keys .row.actions a { color: var(--accent); text-decoration: none; margin-left: auto; }
.dshl-keys .dshl-note { margin: 0; }
.dshl-keys p.small { margin: 12px 0 0; font-size: 11.5px; }
.dshl-tag { font-size: 11.5px; padding: 2px 8px; border-radius: 999px; background: var(--l2); color: var(--muted); }
.dshl-tag.ok { background: color-mix(in srgb, #1a9d5a 13%, transparent); color: #168a4f; }
.dshl-btn.small.ghost { background: none; border-color: transparent; color: var(--muted); padding: 0 8px; }
.dshl-btn.small.ghost:hover, .dshl-btn.small.ghost.on { background: var(--hover); color: var(--ink); }
.dshl-btn.small.ghost svg { width: 15px; height: 15px; }
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
