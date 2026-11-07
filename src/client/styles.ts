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

/* ── Controls: one height, symmetric padding ── */
.dshl { --h: 34px; }
.dshl-top { position: sticky; top: 0; z-index: 10; background: color-mix(in srgb, var(--bg) 94%, transparent); backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--line); padding: 14px 20px 12px; display: grid; gap: 10px; }
.dshl-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; min-width: 0; }
.dshl-bar .grow { flex: 1; }
.dshl-field { display: flex; align-items: center; gap: 10px; flex: 1 1 260px; min-width: 0; height: 40px; padding: 0 6px 0 12px;
  border: 1px solid var(--line); border-radius: var(--r); background: var(--l1); color: var(--faint); transition: border-color .15s, box-shadow .15s; }
.dshl-field:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); background: var(--bg); }
.dshl-field input { flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: none; color: var(--ink); font: inherit; }
.dshl-field input::placeholder { color: var(--faint); }
.dshl-field .pct { font-size: 12px; color: var(--accent); white-space: nowrap; }
.dshl-field.small { flex: 1; height: 32px; padding: 0 10px; gap: 8px; }
.dshl-bar.opts { gap: 8px; }

.dshl-ctl { display: inline-flex; align-items: center; gap: 8px; height: var(--h); padding: 0 12px; border: 1px solid var(--line); border-radius: 9px;
  background: var(--l1); color: var(--ink); font-size: 13px; cursor: pointer; white-space: nowrap; max-width: 100%; }
.dshl-ctl:hover:not(:disabled), .dshl-ctl.on { background: var(--hover); }
.dshl-ctl:disabled { opacity: .55; cursor: default; }
.dshl-ctl > span:not(.dshl-ctl-label):not(.caret) { overflow: hidden; text-overflow: ellipsis; }
.dshl-ctl.icon { width: var(--h); padding: 0; justify-content: center; color: var(--muted); }
.dshl-top .dshl-ctl.icon { width: 40px; height: 40px; border-radius: var(--r); }
.dshl-ctl.icon svg { width: 17px; height: 17px; }
.dshl-ctl-label { color: var(--muted); }
.dshl-ctl .caret { width: 6px; height: 6px; border-right: 1.5px solid var(--faint); border-bottom: 1.5px solid var(--faint); transform: translateY(-2px) rotate(45deg); flex: none; }

.dshl select { height: 30px; padding: 0 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--ink); font: inherit; font-size: 13px; cursor: pointer; }
.dshl select:disabled { opacity: .6; cursor: default; }

.dshl-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 40px; padding: 0 16px; border-radius: var(--r);
  border: 1px solid var(--line); background: var(--l1); cursor: pointer; font-weight: 500; text-decoration: none; color: var(--ink); white-space: nowrap; }
.dshl-btn:hover:not(:disabled) { background: var(--hover); }
.dshl-btn.small { height: 30px; padding: 0 12px; font-size: 13px; border-radius: 8px; font-weight: 450; }
.dshl-btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.dshl-btn.primary:hover:not(:disabled) { filter: brightness(1.06); background: var(--accent); }
.dshl-btn.stop { background: var(--live); border-color: var(--live); color: #fff; height: var(--h); }
.dshl-btn:disabled, .dshl-btn.disabled { opacity: .45; cursor: default; pointer-events: none; }
.dshl-btn svg { flex: none; }
.dshl button.ghost { border: 0; background: none; color: var(--muted); cursor: pointer; width: 28px; height: 28px; padding: 0; border-radius: 7px;
  display: inline-flex; align-items: center; justify-content: center; flex: none; }
.dshl button.ghost:hover:not(:disabled) { background: var(--hover); color: var(--ink); }
.dshl button.ghost:disabled { opacity: .3; cursor: default; }
.dshl-link { border: 0; background: none; padding: 0; color: var(--accent); cursor: pointer; font-size: 13px; }
.dshl-link:hover { text-decoration: underline; }
.dshl .small { font-size: 12px; }

.dshl-seg { display: inline-flex; height: var(--h); padding: 3px; gap: 2px; border-radius: 9px; background: var(--l2); flex: none; }
.dshl-seg button { border: 0; background: none; height: 100%; padding: 0 12px; border-radius: 7px; color: var(--muted); cursor: pointer; font-size: 13px; white-space: nowrap; }
.dshl-seg button:hover:not(.on):not(:disabled) { color: var(--ink); }
.dshl-seg button.on { background: var(--bg); color: var(--ink); font-weight: 550; box-shadow: 0 1px 2px rgba(0,0,0,.12); }
.dshl-seg button:disabled:not(.on) { opacity: .5; cursor: default; }
.dshl-seg.wide { display: flex; width: 100%; margin-bottom: 14px; }
.dshl-seg.wide button { flex: 1; }

/* Popovers */
.dshl-pick { position: relative; min-width: 0; }
.dshl-pop { position: absolute; top: calc(100% + 6px); left: 0; z-index: 40; min-width: 260px; max-width: min(340px, calc(100vw - 32px)); padding: 8px;
  background: var(--bg); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,.14); }
.dshl-pop.right { left: auto; right: 0; }
.dshl-lines-pick .order .row { display: grid; grid-template-columns: 22px 1fr 28px 28px 28px; align-items: center; height: 36px; padding: 0 2px 0 6px; border-radius: 8px; font-size: 13.5px; }
.dshl-lines-pick .order .row:hover { background: var(--l1); }
.dshl-lines-pick .order .n { color: var(--faint); font-size: 12px; font-variant-numeric: tabular-nums; }
.dshl-lines-pick .all { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 4px 4px; margin-top: 6px; border-top: 1px solid var(--line-soft); max-height: 180px; overflow: auto; }
.dshl-lines-pick .opt { display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 10px; border: 1px solid var(--line); border-radius: 999px;
  background: var(--l1); color: var(--ink); font-size: 12.5px; cursor: pointer; }
.dshl-lines-pick .opt:hover { border-color: var(--accent); color: var(--accent); }
.dshl-pop.settings { width: 320px; padding: 6px 12px; }
.dshl .srow { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 46px; font-size: 13.5px; }
.dshl-pop.settings .srow + .srow { border-top: 1px solid var(--line-soft); }
.dshl .srow.col { display: grid; gap: 8px; padding: 10px 0; justify-content: stretch; }
.dshl .srow > select { width: 120px; }
.dshl .srow .keyline { display: flex; gap: 6px; align-items: center; }
.dshl .srow .keyline code { font-size: 12.5px; color: var(--muted); }
.dshl .srow .keyline input { flex: 1; min-width: 0; height: 30px; padding: 0 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--ink);
  font: inherit; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
.dshl .srow .ok { color: var(--ok); font-size: 12.5px; }
.dshl .srow .bad { color: var(--live); font-size: 12.5px; }
.dshl .srow a { color: var(--accent); font-size: 12.5px; text-decoration: none; }

/* Status bar while something plays */
.dshl-time { color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
.dshl-bar .dshl-title { flex: 1; }

.dshl-note { margin: 12px 20px 0; padding: 9px 14px; border-radius: var(--r); background: var(--l1); border: 1px solid var(--line); color: var(--muted); font-size: 13px;
  display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.dshl-note.warn { color: var(--live); border-color: color-mix(in srgb, var(--live) 35%, transparent); background: color-mix(in srgb, var(--live) 6%, var(--bg)); }
.dshl-note code { font-size: 12.5px; padding: 1px 6px; border-radius: 5px; background: var(--bg); border: 1px solid var(--line); color: var(--ink); }

.dshl-tasks { margin: 10px 20px 0; display: grid; gap: 4px; }
.dshl-task { display: flex; align-items: center; gap: 10px; height: 34px; padding: 0 12px; border-radius: 9px; background: var(--l1); font-size: 13px; color: var(--muted); }
.dshl-task .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); }
.dshl-task a { color: var(--accent); text-decoration: none; }
.dshl-task .bad { color: var(--live); }
.dshl .bar { display: block; width: 120px; height: 4px; border-radius: 2px; background: var(--l2); overflow: hidden; flex: none; }
.dshl .bar i { display: block; height: 100%; background: var(--accent); transition: width .3s; }
.dshl-task .pct { font-variant-numeric: tabular-nums; width: 36px; text-align: right; }

/* ── Empty state ── */
.dshl-empty { padding: 28px 20px; }
.dshl-drop { border: 1.5px dashed var(--line); border-radius: 16px; padding: 56px 24px 48px; text-align: center; max-width: 760px; margin: 0 auto; }
.dshl-drop h2 { margin: 0 0 8px; font-size: 22px; font-weight: 650; letter-spacing: -.01em; }
.dshl-drop p { margin: 0; color: var(--muted); }
.dshl-pushinfo { display: inline-flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 8px 12px; margin-top: 28px; padding: 10px 14px;
  border-radius: 12px; background: var(--l1); font-size: 12.5px; color: var(--muted); max-width: 100%; }
.dshl-pushinfo svg { color: var(--faint); }
.dshl-pushinfo .kv { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.dshl-pushinfo em { font-style: normal; color: var(--faint); }
.dshl-copy { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 8px; border: 1px solid var(--line); border-radius: 7px; background: var(--bg);
  color: var(--muted); cursor: pointer; max-width: 100%; min-width: 0; }
.dshl-copy:hover { border-color: var(--accent); color: var(--accent); }
.dshl-copy code { font-size: 12px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

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
.dshl-progress input { -webkit-appearance: none; appearance: none; width: 100%; height: 4px; margin: 0 0 6px; border-radius: 2px; cursor: pointer;
  background: linear-gradient(to right, var(--live) 0 var(--pos, 0%), rgba(255,255,255,.55) var(--pos, 0%) var(--done, 100%), rgba(255,255,255,.18) var(--done, 100%)); }
.dshl-progress input::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%; background: var(--live); border: 0; }
.dshl-progress input::-moz-range-thumb { width: 12px; height: 12px; border-radius: 50%; background: var(--live); border: 0; }
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

.dshl-done { display: flex; align-items: center; gap: 10px; font-size: 13px; min-width: 0; }
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
.dshl-side { position: sticky; top: 112px; min-width: 0; display: flex; flex-direction: column; max-height: calc(100vh - 150px);
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
.dshl-line .main { font-weight: 550; }
.dshl-line .sub { color: var(--muted); font-size: 13px; }

.dshl-subcfg h3 { margin: 14px 0 4px; }
.dshl-subcfg h3:first-child { margin-top: 0; }
.dshl-subcfg .opt { display: grid; grid-template-columns: 84px 1fr; gap: 10px; align-items: center; min-height: 36px; font-size: 13px; color: var(--muted); }
.dshl-subcfg input[type=range] { width: 100%; accent-color: var(--accent); }
.dshl-subcfg > .dshl-link { margin-top: 14px; }

/* Download tab */
.dshl-dl h3 { margin: 4px 0 6px; display: flex; gap: 8px; align-items: baseline; text-transform: none; letter-spacing: 0; font-size: 12.5px; }
.dshl-dl h3 + * { margin-top: 0; }
.dshl-dl .dl-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 44px; border-bottom: 1px solid var(--line-soft); font-size: 13.5px; }
.dshl-dl .dl-row:last-child { border-bottom: 0; }
.dshl-dl .dl-row + h3, .dshl-dl .dl-row ~ h3 { margin-top: 18px; }
.dshl-dl .dl-row .dshl-btn.small { max-width: 60%; overflow: hidden; text-overflow: ellipsis; }

.dshl-gl input { height: 30px; padding: 0 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--ink); font: inherit; font-size: 13px; min-width: 0; }
.dshl-gl { display: grid; gap: 8px; }
.dshl-gl .row { display: grid; gap: 6px; padding: 8px 10px 10px; border: 1px solid var(--line-soft); border-radius: 10px; background: var(--bg); }
.dshl-gl .term { display: flex; align-items: center; gap: 8px; min-height: 28px; }
.dshl-gl .term b { flex: 1; font-weight: 600; }
.dshl-gl .tag { font-size: 11px; padding: 0 6px; border-radius: 999px; background: var(--l2); color: var(--faint); }

.dshl-file { display: flex; align-items: center; gap: 8px; padding: 6px 8px; margin: 0 -8px; border-radius: 8px; color: var(--ink); text-decoration: none; font-size: 13px; word-break: break-all; }
.dshl-file:hover { background: var(--hover); }
.dshl-file svg { color: var(--faint); flex: none; }

.dshl-dropzone { position: absolute; inset: 0; z-index: 20; display: flex; align-items: center; justify-content: center; padding: 24px;
  background: color-mix(in srgb, var(--accent) 10%, color-mix(in srgb, var(--bg) 85%, transparent)); }
.dshl-dropzone div { padding: 40px 56px; border: 2px dashed var(--accent); border-radius: 18px; color: var(--accent); font-size: 17px; font-weight: 600; background: var(--bg); }


/* Player menus (open above the control bar, follow the page theme) */
.dshl-menu { position: absolute; right: 10px; bottom: 62px; z-index: 5; width: min(340px, calc(100% - 20px)); max-height: calc(100% - 76px); display: flex; flex-direction: column;
  background: var(--bg); color: var(--ink); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 12px 36px rgba(0,0,0,.35); font-size: 13.5px; }
.dshl-menu .head { display: flex; align-items: center; justify-content: space-between; padding: 8px 8px 4px 14px; font-weight: 600; }
.dshl-menu .body { overflow: auto; padding: 4px 14px 14px; display: grid; gap: 12px; }
.dshl-menu .dshl-panel { padding: 0; }
.dshl-menu .dshl-seg.wide { margin: 0; }
.dshl-menu .opt { display: grid; grid-template-columns: 84px 1fr; gap: 10px; align-items: center; color: var(--muted); font-size: 13px; }
.dshl-menu .opt input[type=range] { accent-color: var(--accent); }
.dshl-lines-pick .order .row { display: grid; grid-template-columns: 22px 1fr 28px 28px 28px; align-items: center; height: 36px; padding: 0 2px 0 6px; border-radius: 8px; font-size: 13.5px; }
.dshl-lines-pick .order .row:hover { background: var(--l1); }
.dshl-lines-pick .order .n { color: var(--faint); font-size: 12px; font-variant-numeric: tabular-nums; }
.dshl-lines-pick .all { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 0 0; margin-top: 6px; border-top: 1px solid var(--line-soft); max-height: 120px; overflow: auto; }
.dshl-lines-pick .opt { display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 10px; border: 1px solid var(--line); border-radius: 999px;
  background: var(--l1); color: var(--ink); font-size: 12.5px; cursor: pointer; }
.dshl-lines-pick .opt:hover { border-color: var(--accent); color: var(--accent); }

/* Subtitle start / pause in the control bar */
.dshl-subsbtn { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 12px; margin: 0 6px; border: 0; border-radius: 999px;
  background: var(--accent); color: #fff; font-size: 12.5px; font-weight: 600; cursor: pointer; white-space: nowrap; font-variant-numeric: tabular-nums; }
.dshl-subsbtn:hover { filter: brightness(1.08); }
.dshl-subsbtn.running { background: rgba(255,255,255,.16); font-weight: 500; }
.dshl-subsbtn.running .dot { width: 7px; height: 7px; border-radius: 50%; background: #ff5a5f; animation: dshl-pulse 1.6s ease-in-out infinite; }
.dshl-subsbtn.done { background: none; opacity: .8; cursor: default; }
.dshl-subsbtn.running .act { display: none; }
.dshl-subsbtn.running:hover .now { display: none; }
.dshl-subsbtn.running:hover .act { display: inline; }
.dshl-subsbtn.running:hover .dot { animation: none; border-radius: 1px; width: 8px; height: 8px; background: #fff; }
@container (max-width: 520px) { .dshl-subsbtn { padding: 0 9px; margin: 0 2px; } }

/* Progress: played (red), loaded (light), subtitles ready (blue line under the track) */
.dshl-progress { position: relative; }
.dshl-progress i.subs { position: absolute; left: 0; top: 7px; height: 2px; width: var(--subs, 0%); background: #7fb0ff; border-radius: 1px; pointer-events: none; }

/* Status row under the player */
.dshl-done .dshl-title { flex: 1; }
.dshl-usage { position: relative; }
.dshl-usage > .dshl-pill { border: 0; cursor: pointer; font-weight: 500; font-variant-numeric: tabular-nums; }
.dshl-pop.up { top: auto; bottom: calc(100% + 6px); }
.dshl-pop.usage { min-width: 320px; padding: 12px 14px; }
.dshl-pop.usage h3 { margin: 0 0 8px; font-size: 12.5px; font-weight: 600; color: var(--muted); }
.dshl-pop.usage table { width: 100%; border-collapse: collapse; font-size: 12.5px; font-variant-numeric: tabular-nums; }
.dshl-pop.usage th { text-align: right; font-weight: 500; color: var(--faint); padding: 2px 0 6px 10px; }
.dshl-pop.usage td { text-align: right; padding: 4px 0 4px 10px; border-top: 1px solid var(--line-soft); }
.dshl-pop.usage th:first-child, .dshl-pop.usage td:first-child { text-align: left; padding-left: 0; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshl-pop.usage p { margin: 8px 0 0; }
.dshl-btn.icon { width: 40px; padding: 0; }
/* Login dialog */
.dshl-modal { position: fixed; inset: 0; z-index: 2147483001; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(0,0,0,.36); }
.dshl-modal .box { position: relative; width: min(400px, 100%); padding: 28px 24px 20px; border-radius: 16px; background: var(--bg); color: var(--ink);
  box-shadow: 0 24px 64px rgba(0,0,0,.28); text-align: center; }
.dshl-modal .x { position: absolute; top: 10px; right: 10px; }
.dshl-modal .ico { width: 48px; height: 48px; margin: 0 auto 12px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent); }
.dshl-modal h3 { margin: 0 0 6px; font-size: 17px; font-weight: 650; }
.dshl-modal p { margin: 0 0 14px; color: var(--muted); font-size: 13.5px; }
.dshl-modal .srow { padding: 0 2px; border-top: 1px solid var(--line-soft); border-bottom: 1px solid var(--line-soft); text-align: left; }
.dshl-modal .acts { display: flex; gap: 8px; justify-content: center; margin-top: 18px; }
.dshl-modal .acts .dshl-btn { height: 36px; }
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
