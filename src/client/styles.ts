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

.dshl-seg { display: inline-flex; height: var(--h); padding: 3px; gap: 2px; border-radius: 9px; background: color-mix(in srgb, var(--ink) 7%, transparent); flex: none; }
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
.dshl-pop.settings .srow > select, .dshl-pop.settings .srow > .dshl-seg { width: 148px; }
.dshl-pop.settings .srow > .dshl-seg button { flex: 1; padding: 0 6px; }
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
.dshl-pushinfo { display: inline-grid; gap: 10px; margin-top: 32px; padding: 14px 18px; border-radius: 12px; background: var(--l1); text-align: left; font-size: 13px; color: var(--muted); max-width: 100%; }
.dshl-pushinfo .title { display: flex; align-items: center; gap: 8px; color: var(--ink); font-weight: 550; }
.dshl-pushinfo .title svg { color: var(--muted); }
.dshl-pushinfo .title span { color: var(--faint); font-weight: 400; font-size: 12px; }
.dshl-pushinfo dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; margin: 0; align-items: center; }
.dshl-pushinfo dt { color: var(--faint); font-size: 12px; }
.dshl-pushinfo dd { margin: 0; display: flex; align-items: center; gap: 14px; min-width: 0; }
.dshl-pushinfo .val { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; color: var(--ink); user-select: all; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshl-pushinfo .dshl-link { font-size: 12.5px; flex: none; }

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


/* Player menus: dark and translucent like the control bar; inner parts use the same tokens */
.dshl-menu { position: absolute; right: 10px; bottom: 60px; z-index: 5; width: min(320px, calc(100% - 20px)); max-height: calc(100% - 72px); display: flex; flex-direction: column;
  --bg: #1f1f22; --ink: #f2f2f3; --muted: #b4b4ba; --faint: #8b8b92; --line: rgba(255,255,255,.14); --line-soft: rgba(255,255,255,.08);
  --l1: rgba(255,255,255,.06); --l2: rgba(255,255,255,.1); --hover: rgba(255,255,255,.08); --accent: #7aa2ff;
  background: rgba(28,28,31,.94); color: var(--ink); border: 1px solid rgba(255,255,255,.08); border-radius: 12px;
  box-shadow: 0 16px 40px rgba(0,0,0,.45); backdrop-filter: blur(16px); font-size: 13px; }
.dshl-menu .head { display: flex; align-items: center; gap: 10px; padding: 10px 8px 6px 14px; font-weight: 600; font-size: 13.5px; }
.dshl-menu .head .grow { flex: 1; }
.dshl-menu .head .ghost { color: var(--muted); }
.dshl-menu .body { overflow: auto; padding: 2px 8px 10px; display: grid; gap: 10px; min-height: 0; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.25) transparent; }
.dshl-menu .body::-webkit-scrollbar { width: 6px; }
.dshl-menu .body::-webkit-scrollbar-thumb { background: rgba(255,255,255,.22); border-radius: 3px; }
.dshl-menu .dshl-panel { padding: 0; }
.dshl-menu .opt { display: grid; grid-template-columns: 64px 1fr; gap: 10px; align-items: center; color: var(--muted); font-size: 13px; padding: 0 6px; }
.dshl-menu .opt input[type=range] { accent-color: var(--accent); }
.dshl-menu .dshl-seg { height: 28px; background: var(--l2); }
.dshl-menu .dshl-seg button.on { background: rgba(255,255,255,.92); color: #111; }
.dshl-menu .dshl-seg button { padding: 0 10px; font-size: 12.5px; }

/* Subtitle menu: a list, then three short options */
.dshl-submenu { display: grid; gap: 4px; }
.dshl-submenu .list { display: grid; }
.dshl-submenu .row { display: flex; align-items: center; gap: 4px; height: 30px; padding: 0 6px 0 0; border-radius: 7px; }
.dshl-submenu .row:hover { background: var(--hover); }
.dshl-submenu .pick { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; height: 100%; padding: 0 6px; border: 0; background: none; color: var(--muted); font: inherit; font-size: 13px; cursor: pointer; text-align: left; }
.dshl-submenu .row.on .pick { color: var(--ink); }
.dshl-submenu .check { width: 16px; text-align: center; color: var(--accent); font-weight: 700; flex: none; }
.dshl-submenu .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshl-submenu .up { width: 24px; height: 24px; border: 0; border-radius: 6px; background: none; color: var(--muted); cursor: pointer; opacity: 0; }
.dshl-submenu .row:hover .up { opacity: 1; }
.dshl-submenu .up:hover { background: var(--l2); color: var(--ink); }
.dshl-submenu .n { width: 18px; height: 18px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600;
  background: var(--l2); color: var(--muted); flex: none; }
.dshl-submenu .row.add { padding-left: 6px; gap: 8px; color: var(--muted); cursor: pointer; }
.dshl-submenu .row.add select { flex: 1; height: 100%; border: 0; background: none; color: var(--muted); font: inherit; font-size: 13px; cursor: pointer; padding: 0; appearance: none; -webkit-appearance: none; }
.dshl-submenu .row.add select option { color: #111; }
.dshl-submenu .opts { position: sticky; bottom: -10px; display: grid; gap: 2px; margin: 0 -8px -10px; padding: 6px 8px 10px; background: rgb(28,28,31); border-top: 1px solid var(--line-soft); }
.dshl-menu .dshl-submenu .opt { display: flex; align-items: center; justify-content: space-between; gap: 10px; height: 32px; padding: 0 6px; color: var(--muted); }
.dshl-menu .dshl-submenu .opt .seg { justify-self: end; flex: none; }
.dshl-submenu .seg { display: inline-flex; padding: 2px; gap: 2px; border-radius: 8px; background: var(--l2); }
.dshl-submenu .seg button { height: 26px; min-width: 40px; padding: 0 10px; border: 0; border-radius: 6px; background: none; color: var(--muted); font: inherit; font-size: 12.5px; cursor: pointer; }
.dshl-submenu .seg button.on { background: rgba(255,255,255,.92); color: #111; font-weight: 600; }
.dshl-menu .dshl-switch { background: rgba(255,255,255,.22); }
.dshl-menu .dshl-switch.on { background: var(--accent); }
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
.dshl-pop.settings .srow > select, .dshl-pop.settings .srow > .dshl-seg { width: 148px; }
.dshl-pop.settings .srow > .dshl-seg button { flex: 1; padding: 0 6px; }
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
.dshl-pushinfo { display: inline-grid; gap: 10px; margin-top: 32px; padding: 14px 18px; border-radius: 12px; background: var(--l1); text-align: left; font-size: 13px; color: var(--muted); max-width: 100%; }
.dshl-pushinfo .title { display: flex; align-items: center; gap: 8px; color: var(--ink); font-weight: 550; }
.dshl-pushinfo .title svg { color: var(--muted); }
.dshl-pushinfo .title span { color: var(--faint); font-weight: 400; font-size: 12px; }
.dshl-pushinfo dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; margin: 0; align-items: center; }
.dshl-pushinfo dt { color: var(--faint); font-size: 12px; }
.dshl-pushinfo dd { margin: 0; display: flex; align-items: center; gap: 14px; min-width: 0; }
.dshl-pushinfo .val { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; color: var(--ink); user-select: all; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshl-pushinfo .dshl-link { font-size: 12.5px; flex: none; }

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

/* Video page (full window) */
.dshl-pagewrap { position: absolute; inset: 0; pointer-events: auto; background: var(--dsw-alias-bg-base, #fff); z-index: 1; }
.dshl.page { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.dshl.page .dshl-main { flex: 1; min-height: 0; grid-template-columns: minmax(0, 1fr) clamp(320px, 30vw, 440px); align-items: stretch; padding-bottom: 16px; }
.dshl.page .dshl-col { overflow: auto; align-content: start; }
.dshl.page .dshl-side { position: static; max-height: none; height: 100%; }
.dshl.page .dshl-side > .dshl-panel { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.dshl.page .dshl-lines { max-height: none; flex: 1; }
.dshl.page.theater .dshl-side { display: flex; }
.dshl-btn.icon.back { width: 40px; padding: 0; color: var(--muted); }
.dshl-btn.icon.back svg { transform: rotate(180deg); }
@media (max-width: 1000px) { .dshl.page { overflow: auto; } .dshl.page .dshl-main { grid-template-columns: minmax(0, 1fr); } .dshl.page .dshl-side { height: 70vh; } }

/* Chat with DeepSeek inside the page */
.dshl-chat { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.dshl-chat .msgs { flex: 1; min-height: 0; overflow: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.dshl-chat .msg { max-width: 92%; padding: 8px 11px; border-radius: 12px; font-size: 13.5px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
.dshl-chat .msg.user { align-self: flex-end; background: color-mix(in srgb, var(--accent) 12%, var(--bg)); }
.dshl-chat .msg.bot { align-self: flex-start; background: var(--bg); border: 1px solid var(--line-soft); }
.dshl-chat .msg.tool { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; font-size: 12px; color: var(--muted); background: var(--l2); border-radius: 999px; }
.dshl-chat .msg.tool svg { width: 12px; height: 12px; }
.dshl-chat .msg.tool.on svg { animation: dshl-spin 1.4s linear infinite; }
.dshl-chat .msg.err { align-self: stretch; color: var(--live); background: color-mix(in srgb, var(--live) 6%, var(--bg)); font-size: 12.5px; }
.dshl-chat .quick { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 12px 0; border-top: 1px solid var(--line); }
.dshl-chat .quick button { height: 28px; padding: 0 10px; border: 1px solid var(--line); border-radius: 999px; background: var(--bg); color: var(--ink); font-size: 12.5px; cursor: pointer; }
.dshl-chat .quick button:hover { border-color: var(--accent); color: var(--accent); }
.dshl-chat .composer { display: flex; gap: 8px; align-items: flex-end; padding: 10px 12px 12px; }
.dshl-chat .composer textarea { flex: 1; min-width: 0; resize: none; padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); color: var(--ink);
  font: inherit; font-size: 13.5px; line-height: 1.5; max-height: 160px; }
.dshl-chat .composer textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent); }
.dshl-chat .composer .dshl-btn { height: 36px; }


/* Markdown in chat replies */
.dshl-chat .msg.bot { white-space: normal; }
.dshl-chat .md > * { margin: 0 0 6px; }
.dshl-chat .md > *:last-child { margin-bottom: 0; }
.dshl-chat .md p { white-space: pre-wrap; }
.dshl-chat .md p.h { font-weight: 650; }
.dshl-chat .md ul, .dshl-chat .md ol { padding-left: 18px; }
.dshl-chat .md li { margin: 2px 0; }
.dshl-chat .md code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; padding: 1px 5px; border-radius: 5px; background: var(--l2); word-break: break-all; }
.dshl-chat .md a { color: var(--accent); text-decoration: none; }
.dshl-chat .md a code { color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); }
.dshl-chat .md pre { overflow: auto; padding: 8px 10px; border-radius: 8px; background: var(--l2); }
.dshl-chat .md pre code { padding: 0; background: none; }
.dshl-chat .md table { border-collapse: collapse; font-size: 12.5px; width: 100%; }
.dshl-chat .md th, .dshl-chat .md td { border-bottom: 1px solid var(--line-soft); padding: 4px 6px; text-align: left; vertical-align: top; }
.dshl-chat .md th { color: var(--muted); font-weight: 550; }
/* Sidebar button and paste prompt (outside .dshl, so host tokens directly) */
.dshl-sidebtn { box-sizing: border-box; display: flex; align-items: center; gap: 8px; flex: 0 0 auto; border: 0; background: none; cursor: pointer; overflow: hidden;
  color: var(--dsw-alias-label-primary, #1b1b19); font-family: inherit; font-size: 14px; line-height: 22px; }
.dshl-sidebtn.wide { width: calc(100% + 4px); height: 42px; margin: 4px -2px 0; padding: 0 10px 0 8px; border-radius: 12px; }
.dshl-sidebtn.rail { width: 36px; height: 36px; margin: 8px 0 0; padding: 0; border-radius: 50%; justify-content: center; }
.dshl-sidebtn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05)); }
.dshl-sidebtn svg { flex: none; }
.dshl-sidebtn .label { white-space: nowrap; overflow: hidden; }

/* Sidebar entry while work goes on: last frame, faded; animated mark; what is running */
.dshl-sidebtn { position: relative; isolation: isolate; }
.dshl-sidebtn .bg { position: absolute; inset: 0; z-index: -1; background: var(--thumb) center / cover no-repeat; opacity: .38; filter: saturate(.85);
  -webkit-mask-image: linear-gradient(to right, #000 0%, #000 35%, transparent 100%); mask-image: linear-gradient(to right, #000 0%, #000 35%, transparent 100%); }
.dshl-sidebtn.rail .bg { -webkit-mask-image: none; mask-image: none; opacity: .45; }
.dshl-sidebtn .bg::after { content: ''; position: absolute; inset: 0; background: color-mix(in srgb, var(--dsw-alias-bg-base, #fff) 35%, transparent); }
.dshl-sidebtn .label { position: relative; }
.dshl-sidebtn .meta { margin-left: auto; font-size: 12px; color: var(--dsw-alias-label-secondary, #66655f); font-variant-numeric: tabular-nums; white-space: nowrap; }
.dshl-mark .c1, .dshl-mark .c2 { stroke-dasharray: 8; stroke-dashoffset: 0; }
.dshl-mark.busy .c1 { animation: dshl-write 1.8s ease-in-out infinite; }
.dshl-mark.busy .c2 { animation: dshl-write 1.8s ease-in-out .45s infinite; }
.dshl-mark.busy .play { animation: dshl-breathe 1.8s ease-in-out infinite; transform-origin: 12px 10px; }
.dshl-mark .rec { animation: dshl-pulse 1.6s ease-in-out infinite; }
@keyframes dshl-write { 0% { stroke-dashoffset: 8; } 45%, 70% { stroke-dashoffset: 0; } 100% { stroke-dashoffset: -8; } }
@keyframes dshl-breathe { 50% { opacity: .55; } }
@media (prefers-reduced-motion: reduce) { .dshl-mark.busy .c1, .dshl-mark.busy .c2, .dshl-mark.busy .play, .dshl-mark .rec { animation: none; } }
.dshl-pastechip { display: flex; box-sizing: border-box; width: 100%; max-width: 812px; margin: 0 auto; padding: 0 16px 8px; }
.dshl-pastechip button { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 12px; border: 0; border-radius: 999px; cursor: pointer; font: inherit; font-size: 12.5px;
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #3b6ef5) 12%, transparent); color: var(--dsw-alias-state-business-primary, #3b6ef5); max-width: 100%; }
.dshl-pastechip button svg { width: 13px; height: 13px; flex: none; }
.dshl-pastechip .url { opacity: .7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Subtitle line chips (one tap each; numbered = shown, top to bottom) */
.dshl-chips .row { display: flex; flex-wrap: wrap; gap: 6px; }
.dshl-chips .chip { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border: 1px solid var(--line); border-radius: 999px;
  background: var(--bg); color: var(--ink); font: inherit; font-size: 13px; cursor: pointer; white-space: nowrap; }
.dshl-chips .chip:hover { border-color: var(--accent); }
.dshl-chips .chip.on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, var(--bg)); color: var(--accent); font-weight: 550; }
.dshl-chips .chip i { display: inline-flex; align-items: center; justify-content: center; width: 17px; height: 17px; margin-left: -4px; border-radius: 50%;
  background: var(--accent); color: #fff; font-size: 11px; font-style: normal; font-weight: 600; }
.dshl-chips .chip.site:not(.on) { border-style: dashed; }
.dshl-chips select.chip.add { appearance: none; -webkit-appearance: none; border-style: dashed; color: var(--muted); padding: 0 12px; }
.dshl-chips .chip.ghost { width: 30px; padding: 0; justify-content: center; color: var(--muted); }
.dshl-more summary { cursor: pointer; color: var(--muted); font-size: 12.5px; list-style: none; }
.dshl-more summary::before { content: '▸ '; }
.dshl-more[open] summary::before { content: '▾ '; }
.dshl-more[open] summary { margin-bottom: 8px; }

/* Switch */
.dshl-switch { position: relative; width: 34px; height: 20px; border: 0; border-radius: 999px; background: color-mix(in srgb, var(--ink) 18%, transparent); cursor: pointer; padding: 0; flex: none; }
.dshl-switch i { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.25); transition: left .15s; }
.dshl-switch.on { background: var(--accent); }
.dshl-switch.on i { left: 16px; }
.dshl-menu .head { gap: 10px; }
.dshl-menu .head .grow { flex: 1; }

/* Player notices, clip range, recording state */
.dshl-toast { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 6; display: inline-flex; align-items: center; gap: 10px; max-width: calc(100% - 24px);
  padding: 8px 14px; border-radius: 10px; background: rgba(20,20,22,.86); color: #fff; font-size: 13px; box-shadow: 0 6px 20px rgba(0,0,0,.3); }
.dshl-toast a, .dshl-toast .dshl-link { color: #8fb4ff; text-decoration: none; white-space: nowrap; }
.dshl-spinner.sm { width: 14px; height: 14px; border-width: 2px; flex: none; }
.dshl-progress i.clip { position: absolute; top: 0; height: 4px; background: rgba(255,215,64,.85); border-radius: 2px; pointer-events: none; }
.dshl-ctrlrow .ic.rec { color: #ffd740; background: rgba(255,215,64,.16); }

/* Subtitle progress inside the pill */
.dshl-subsbtn.running { background: linear-gradient(to right, rgba(127,176,255,.45) var(--p, 0%), rgba(255,255,255,.14) var(--p, 0%)); }

/* Download: choose, then one button */
.dshl-dl { display: grid; gap: 14px; }
.dshl-dl .grp { display: grid; gap: 8px; }
.dshl-dl .cap { font-size: 12px; color: var(--muted); font-weight: 550; }
.dshl-dl .cards { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.dshl-card-opt { display: grid; gap: 2px; text-align: left; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); color: var(--ink); cursor: pointer; font: inherit; }
.dshl-card-opt b { font-size: 13.5px; font-weight: 600; }
.dshl-card-opt span { font-size: 12px; color: var(--muted); }
.dshl-card-opt:hover:not(:disabled) { border-color: var(--accent); }
.dshl-card-opt.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); background: color-mix(in srgb, var(--accent) 6%, var(--bg)); }
.dshl-card-opt:disabled { opacity: .45; cursor: default; }
.dshl-dl .dshl-btn.block { width: 100%; margin: 0; height: 40px; }
.dshl-dl .dshl-btn.block + .dshl-btn.block { margin-top: -6px; }
.dshl-dl .dshl-btn.progress { background: linear-gradient(to right, color-mix(in srgb, var(--accent) 30%, var(--bg)) var(--p, 0%), var(--l1) var(--p, 0%)); cursor: default; }
.dshl-dl .err { margin: 0; color: var(--live); font-size: 12.5px; }

/* Glossary (model-maintained) */
.dshl-gl2 { display: grid; gap: 2px; align-content: start; }
.dshl-gl2 .term { padding: 8px 8px; border-radius: 8px; }
.dshl-gl2 .term:hover { background: var(--hover); }
.dshl-gl2 .line { display: flex; align-items: center; gap: 8px; min-height: 24px; font-size: 13.5px; }
.dshl-gl2 .line .tr { color: var(--muted); }
.dshl-gl2 .line .tr::before { content: '→ '; color: var(--faint); }
.dshl-gl2 .line .grow { flex: 1; }
.dshl-gl2 .line button.ghost { opacity: 0; width: 24px; height: 24px; }
.dshl-gl2 .term:hover .line button.ghost { opacity: 1; }
.dshl-gl2 .tag { font-size: 11px; padding: 0 6px; border-radius: 999px; background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent); }
.dshl-gl2 .meta { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 2px; font-size: 12px; color: var(--faint); }
.dshl-gl2 .term.edit { display: grid; gap: 6px; background: var(--l1); }
.dshl-gl2 .term.edit input { height: 30px; padding: 0 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--ink); font: inherit; font-size: 13px; }
.dshl-gl2 .term.edit .acts { display: flex; justify-content: flex-end; align-items: center; gap: 12px; }

/* Transcript: lines vs reading */
.dshl-line.raw .main, .dshl-line.raw .sub { opacity: .62; }
.dshl-tools .dshl-seg { height: 30px; }
.dshl-tools .grow { flex: 1; }
.dshl-read { overflow: auto; flex: 1; min-height: 0; display: grid; gap: 14px; align-content: start; padding: 2px 2px 12px; max-height: calc(100vh - 290px); }
.dshl.page .dshl-read { max-height: none; }
.dshl-read section { padding: 2px 8px 2px 10px; border-left: 2px solid transparent; }
.dshl-read section.active { border-left-color: var(--accent); }
.dshl-read header { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; font-size: 12.5px; }
.dshl-read header b { color: var(--ink); }
.dshl-read header .ts { border: 0; background: none; padding: 0; color: var(--faint); font: inherit; font-size: 12px; cursor: pointer; font-variant-numeric: tabular-nums; }
.dshl-read p { margin: 0 0 4px; font-size: 14px; line-height: 1.7; }
.dshl-read p.src { color: var(--ink); }
.dshl-read p.tr { color: var(--muted); }


/* Labelled control (subtitle languages) */
.dshl-ctrlrow .pill { display: inline-flex; align-items: center; gap: 6px; height: 30px; max-width: 260px; padding: 0 10px 0 8px; margin: 0 4px; border: 0; border-radius: 8px;
  background: rgba(255,255,255,.12); color: #fff; font: inherit; font-size: 12.5px; cursor: pointer; }
.dshl-ctrlrow .pill:hover, .dshl-ctrlrow .pill.on { background: rgba(255,255,255,.22); }
.dshl-ctrlrow .pill svg { width: 18px; height: 18px; flex: none; }
.dshl-ctrlrow .pill .txt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshl-ctrlrow .pill .caret { width: 5px; height: 5px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: translateY(1px) rotate(-135deg); opacity: .8; flex: none; }
@container (max-width: 640px) { .dshl-ctrlrow .pill .txt, .dshl-ctrlrow .pill .caret { display: none; } .dshl-ctrlrow .pill { padding: 0 6px; } }
/* Generate subtitles: choose first */
.dshl-starter { position: relative; display: inline-flex; }
.dshl-startpop { position: absolute; right: -40px; bottom: calc(100% + 12px); z-index: 6; width: 290px; padding: 12px; display: grid; gap: 10px;
  background: var(--bg); color: var(--ink); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 12px 36px rgba(0,0,0,.35); font-size: 13px; text-align: left; }
.dshl-startpop .head { font-weight: 600; font-size: 13.5px; }
.dshl-startpop .note { margin: -4px 0 0; color: var(--muted); font-size: 12px; }
.dshl-startpop .opts { display: grid; gap: 6px; }
.dshl-startpop .opt { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 9px 12px; border: 1px solid var(--line); border-radius: 10px;
  background: var(--bg); color: var(--ink); font: inherit; cursor: pointer; text-align: left; }
.dshl-startpop .opt b { font-weight: 600; }
.dshl-startpop .opt span { color: var(--faint); font-size: 12px; }
.dshl-startpop .opt:hover { border-color: var(--accent); }
.dshl-startpop .opt.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); background: color-mix(in srgb, var(--accent) 6%, var(--bg)); }
.dshl-startpop .go { width: 100%; height: 36px; }
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
