/**
 * dsh-vidi styles, one rule per component, grouped top to bottom as the page
 * reads. Colours ride on DS-Harness's tokens (--dsw-alias-*), so light/dark
 * themes follow the host; menus inside the player use a dark set. Sizes:
 * controls 40 (top bar) / 32 / 28 px, radii 10 / 8 / 6, text 14 / 13 / 12.
 */
const CSS = `
/* ── Tokens and base ── */
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
  --track: color-mix(in srgb, var(--ink) 7%, transparent);
  position: relative; height: 100%; overflow: auto; background: var(--bg); color: var(--ink);
  font-size: 14px; line-height: 1.5; -webkit-font-smoothing: antialiased;
}
.dshl *, .dshl-menu *, .dshl-sheetwrap * { box-sizing: border-box; }
.dshl button, .dshl-menu button, .dshl-startpop button { font: inherit; color: inherit; }
.dshl-muted { color: var(--muted); }
.dshl .pad { padding: 16px 4px; }
.dshl .small { font-size: 12px; }
.dshl .grow, .dshl-menu .grow { flex: 1; }

/* ── Controls ── */
.dshl-field { display: flex; align-items: center; gap: 10px; flex: 1 1 260px; min-width: 0; height: 40px; padding: 0 6px 0 12px;
  border: 1px solid var(--line); border-radius: 10px; background: var(--l1); color: var(--faint); transition: border-color .15s, box-shadow .15s; }
.dshl-field:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent); background: var(--bg); }
.dshl-field input { flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: none; color: var(--ink); font: inherit; }
.dshl-field input::placeholder { color: var(--faint); }
.dshl-field .pct { font-size: 12px; color: var(--accent); white-space: nowrap; }
.dshl-field.small { flex: 1; height: 32px; padding: 0 10px; gap: 8px; border-radius: 8px; font-size: 13px; }
.dshl-field.block { display: flex; width: 100%; flex: none; margin: 0 0 8px; }

.dshl-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 40px; padding: 0 16px; border-radius: 10px; flex: none;
  border: 1px solid var(--line); background: var(--l1); color: var(--ink); cursor: pointer; font-weight: 500; text-decoration: none; white-space: nowrap; }
.dshl-btn:hover:not(:disabled) { background: var(--hover); }
.dshl-btn svg { flex: none; }
.dshl-btn.small { height: 32px; padding: 0 12px; font-size: 13px; border-radius: 8px; font-weight: 450; }
.dshl-btn.quiet { border-color: transparent; background: none; color: var(--muted); padding: 0 8px; }
.dshl-btn.quiet:hover:not(:disabled) { background: var(--hover); color: var(--ink); }
.dshl-btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.dshl-btn.primary:hover:not(:disabled) { background: var(--accent); filter: brightness(1.06); }
.dshl-btn.stop { background: var(--live); border-color: var(--live); color: #fff; }
.dshl-btn.icon { width: 40px; padding: 0; }
.dshl-btn.small.icon { width: 30px; }
.dshl-btn.icon.back { color: var(--muted); }
.dshl-btn.icon.back svg { transform: rotate(180deg); }
.dshl-btn.block { display: flex; width: 100%; }
.dshl-btn:disabled, .dshl-btn.disabled { opacity: .45; cursor: default; pointer-events: none; }

.dshl button.ghost, .dshl-menu button.ghost { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 28px; height: 28px; padding: 0;
  border: 0; border-radius: 6px; background: none; color: var(--muted); cursor: pointer; }
.dshl button.ghost:hover:not(:disabled), .dshl-menu button.ghost:hover { background: var(--hover); color: var(--ink); }
.dshl button.ghost:disabled { opacity: .3; cursor: default; }

.dshl-link { border: 0; background: none; padding: 0; color: var(--accent); cursor: pointer; font-size: 13px; text-decoration: none; }
.dshl-link:hover { text-decoration: underline; }

/* Segmented: a track with one raised choice */
.dshl-seg { display: inline-flex; height: 32px; padding: 2px; gap: 2px; border-radius: 8px; background: var(--track); flex: none; }
.dshl-seg button { height: 100%; padding: 0 12px; border: 0; border-radius: 6px; background: none; color: var(--muted); cursor: pointer; font-size: 13px; white-space: nowrap; }
.dshl-seg button:hover:not(.on):not(:disabled) { color: var(--ink); }
.dshl-seg button.on { background: var(--bg); color: var(--ink); font-weight: 550; box-shadow: 0 1px 2px rgba(0,0,0,.12); }
.dshl-seg button:disabled:not(.on) { opacity: .5; cursor: default; }
.dshl-seg.wide { display: flex; width: 100%; }
.dshl-seg.wide button { flex: 1; }

.dshl-switch { position: relative; flex: none; width: 34px; height: 20px; padding: 0; border: 0; border-radius: 999px; background: color-mix(in srgb, var(--ink) 18%, transparent); cursor: pointer; }
.dshl-switch i { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.25); transition: left .15s; }
.dshl-switch.on { background: var(--accent); }
.dshl-switch.on i { left: 16px; }

.dshl-select { display: inline-flex; align-items: center; gap: 8px; min-width: 0; max-width: 100%; height: 32px; padding: 0 10px; border: 1px solid var(--line); border-radius: 8px;
  background: var(--bg); color: var(--ink); font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.dshl-select .v { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshl-select .caret { flex: none; width: 6px; height: 6px; margin: -3px 1px 0 0; border-right: 1.5px solid var(--faint); border-bottom: 1.5px solid var(--faint); transform: rotate(45deg); transition: transform .15s; }
.dshl-select.open .caret { margin-top: 3px; transform: rotate(-135deg); }
.dshl-select:hover:not(:disabled), .dshl-select.open { border-color: color-mix(in srgb, var(--ink) 25%, var(--line)); }
.dshl-select:focus-visible { outline: 2px solid color-mix(in srgb, var(--accent) 45%, transparent); outline-offset: 1px; }
.dshl-select:disabled { opacity: .5; cursor: default; }
/* The list: drawn at the page's top level (so no panel clips it), in the colours of where it opened. */
.dshl-options { position: fixed; z-index: 2147483000; overflow: auto; overscroll-behavior: contain; padding: 4px; border: 1px solid var(--line, #e4e3de); border-radius: 10px;
  background: var(--bg, #fff); color: var(--ink, #1b1b19); box-shadow: 0 10px 30px rgba(0,0,0,.18), 0 2px 6px rgba(0,0,0,.08); font-size: 13px; line-height: 1.4; -webkit-font-smoothing: antialiased; }
.dshl-options .grp { padding: 8px 10px 4px; color: var(--faint, #9a9993); font-size: 11.5px; font-weight: 600; }
.dshl-options .opt { display: flex; align-items: center; gap: 8px; min-height: 32px; padding: 6px 10px; border-radius: 6px; cursor: pointer; }
.dshl-options .opt.act { background: var(--hover, rgba(0,0,0,.05)); }
.dshl-options .opt.on { font-weight: 550; }
.dshl-options .opt.off { opacity: .45; cursor: default; }
.dshl-options .opt .l { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshl-options .opt .h { flex: none; color: var(--faint, #9a9993); font-size: 12px; }
.dshl-options .opt .ok { flex: none; margin-left: auto; color: var(--accent, #3b6ef5); }

/* Toggle chips (several can be on): languages to show or download */
.dshl-chips .row, .dshl-checks2 { display: flex; flex-wrap: wrap; gap: 6px; }
.dshl-chips .chip, .dshl-checks2 button { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border: 1px solid var(--line); border-radius: 999px;
  background: var(--bg); color: var(--muted); font: inherit; font-size: 12.5px; cursor: pointer; white-space: nowrap; }
.dshl-chips .chip:hover, .dshl-checks2 button:hover { color: var(--ink); border-color: color-mix(in srgb, var(--accent) 50%, var(--line)); }
.dshl-chips .chip.on, .dshl-checks2 button.on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 9%, var(--bg)); color: var(--accent); font-weight: 550; }
.dshl-chips .chip i { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; margin-left: -3px; border-radius: 50%;
  background: var(--accent); color: #fff; font-size: 10.5px; font-style: normal; font-weight: 600; }
.dshl-chips .chip.site:not(.on) { border-style: dashed; }
.dshl-chips .dshl-select.chip.add { height: 28px; border-style: dashed; padding: 0 10px; background: transparent; }
.dshl-chips .dshl-select.chip.add .caret { display: none; }
.dshl-chips .chip.ghost { width: 28px; padding: 0; justify-content: center; }
.dshl-checks2 { margin: 0 0 10px; }
.dshl-checks2 button i { width: 14px; height: 14px; margin-left: -2px; border: 1.5px solid currentColor; border-radius: 4px; opacity: .55; flex: none; }
.dshl-checks2 button.on i { opacity: 1; background: var(--accent) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='8'%3E%3Cpath d='M1 4l3 3 5-6' fill='none' stroke='white' stroke-width='1.8'/%3E%3C/svg%3E") no-repeat center; border-color: var(--accent); }
.dshl-more summary { cursor: pointer; color: var(--muted); font-size: 12.5px; list-style: none; }
.dshl-more summary::-webkit-details-marker { display: none; }
.dshl-more summary::before { content: '▸ '; }
.dshl-more[open] summary::before { content: '▾ '; }
.dshl-more[open] summary { margin-bottom: 8px; }

/* ── Top bar ── */
.dshl-top { position: sticky; top: 0; z-index: 10; display: grid; gap: 10px; padding: 14px 20px 12px; border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--bg) 94%, transparent); backdrop-filter: blur(10px); }
.dshl-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; }
.dshl-pick { position: relative; min-width: 0; }
.dshl-ctl { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 40px; padding: 0 12px; border: 1px solid var(--line); border-radius: 10px;
  background: var(--l1); color: var(--muted); font-size: 13px; cursor: pointer; }
.dshl-ctl.icon { width: 40px; padding: 0; }
.dshl-ctl.icon svg { width: 18px; height: 18px; }
.dshl-ctl.icon.dot { position: relative; }
.dshl-ctl.icon.dot::after { content: ''; position: absolute; top: 8px; right: 8px; width: 7px; height: 7px; border-radius: 50%; background: #e5484d; box-shadow: 0 0 0 2px var(--bg); }
.dshl-ctl:hover, .dshl-ctl.on { background: var(--hover); color: var(--ink); }

.dshl-note { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 12px 20px 0; padding: 9px 14px; border: 1px solid var(--line); border-radius: 10px;
  background: var(--l1); color: var(--muted); font-size: 13px; }
.dshl-note.warn { color: var(--live); border-color: color-mix(in srgb, var(--live) 35%, transparent); background: color-mix(in srgb, var(--live) 6%, var(--bg)); }
.dshl-note code { padding: 1px 6px; border: 1px solid var(--line); border-radius: 5px; background: var(--bg); color: var(--ink); font-size: 12.5px; }

.dshl-tasks { display: grid; gap: 4px; margin: 10px 20px 0; }
.dshl-task { display: flex; align-items: center; gap: 10px; height: 34px; padding: 0 12px; border-radius: 8px; background: var(--l1); color: var(--muted); font-size: 13px; }
.dshl-task .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); }
.dshl-task a { color: var(--accent); text-decoration: none; }
.dshl-task .bad { color: var(--live); }
.dshl-task .pct { width: 36px; text-align: right; font-variant-numeric: tabular-nums; }
.dshl .bar { display: block; flex: none; width: 120px; height: 4px; border-radius: 2px; background: var(--l2); overflow: hidden; }
.dshl .bar i { display: block; height: 100%; background: var(--accent); transition: width .3s; }

/* ── Empty state ── */
.dshl-empty { padding: 28px 20px; }
.dshl.page .dshl-empty { flex: 1; display: flex; align-items: center; justify-content: center; min-height: 0; overflow: auto; }
.dshl.page .dshl-empty > .dshl-drop { border: 0; padding-top: 0; }
.dshl-drop > .dshl-bar.center { display: flex; align-items: center; gap: 8px; width: 100%; max-width: 680px; margin: 22px 0 12px; text-align: left; }
.dshl-drop > .dshl-bar.center + p { font-size: 13px; color: var(--faint); }
.dshl-drop { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; max-width: 760px; margin: 0 auto; padding: 56px 24px 48px;
  border: 1.5px dashed var(--line); border-radius: 16px; text-align: center; }
.dshl-col > .dshl-drop { max-width: none; min-height: 320px; aspect-ratio: 16 / 9; padding: 32px 24px; border-radius: 12px; }
.dshl-drop h2 { margin: 0 0 8px; font-size: 22px; font-weight: 650; letter-spacing: -.01em; }
.dshl-drop p { margin: 0; color: var(--muted); }
.dshl-pushinfo { display: inline-grid; gap: 10px; max-width: 100%; margin-top: 32px; padding: 14px 18px; border-radius: 12px; background: var(--l1); color: var(--muted); font-size: 13px; text-align: left; }
.dshl-pushinfo .title { display: flex; align-items: center; gap: 8px; color: var(--ink); font-weight: 550; }
.dshl-pushinfo .title svg { color: var(--muted); }
.dshl-pushinfo .title span { color: var(--faint); font-size: 12px; font-weight: 400; }
.dshl-pushinfo dl { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 6px 16px; margin: 0; }
.dshl-pushinfo dt { color: var(--faint); font-size: 12px; }
.dshl-pushinfo dd { display: flex; align-items: center; gap: 14px; min-width: 0; margin: 0; }
.dshl-keyedit { width: 140px; height: 26px; padding: 0 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--ink); font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; }
.dshl-keyedit:focus { outline: none; border-color: var(--accent); }
.dshl-pushinfo dd:has(.err) { flex-wrap: wrap; row-gap: 4px; }
.dshl-pushinfo dd .err { flex-basis: 100%; color: #d1434b; font-size: 12px; }
.dshl-pushinfo .val { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; user-select: all; }
.dshl-pushinfo .dshl-link { flex: none; font-size: 12.5px; }
.dshl-bar .dshl-select.srcpick { flex: none; width: auto; height: 40px; padding: 0 10px 0 14px; border-radius: 10px; font-weight: 550; }
.dshl-devbar { display: flex; align-items: center; gap: 8px; flex: 1 1 260px; min-width: 0; }
.dshl-devbar .dshl-select { flex: 1 1 0; min-width: 0; height: 40px; border-radius: 10px; }
.dshl-field.static { color: var(--muted); cursor: default; }
.dshl-field.static .mono { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; user-select: all; }
.dshl-drop > .dshl-btn { margin-top: 20px; }

/* ── Layout ── */
.dshl-main { display: grid; grid-template-columns: minmax(0, 1fr) clamp(300px, 28vw, 400px); align-items: start; gap: 18px; padding: 18px 20px 28px; }
.dshl.theater .dshl-main { grid-template-columns: minmax(0, 1fr); }
.dshl.theater .dshl-side { display: none; }
.dshl-col { display: grid; gap: 10px; min-width: 0; }
@media (max-width: 1000px) { .dshl-main { grid-template-columns: minmax(0, 1fr); } }

/* Video page (full window over the app) */
.dshl-toast { position: fixed; left: 50%; bottom: 28px; z-index: 2147483001; max-width: min(560px, calc(100vw - 32px)); padding: 10px 16px; border-radius: 10px;
  background: rgba(28,28,31,.95); color: #f2f2f3; font: 13.5px/1.5 system-ui, -apple-system, sans-serif; box-shadow: 0 10px 30px rgba(0,0,0,.3); transform: translateX(-50%); pointer-events: none; }
.dshl-pagewrap { position: absolute; inset: 0; z-index: 1; pointer-events: auto; background: var(--dsw-alias-bg-base, #fff); }
/* Desktop app: the page covers the whole window. Windows: start under the title bar. macOS: the
   traffic lights sit over the top-left, so the top bar leaves them room, lines its controls up
   with them, and its empty space moves the window like the app's own top strip. Full screen and
   the web page need none of this. */
.dshl-pagewrap { top: var(--dsh-frame-chrome-top, 0px); }
html[data-platform='darwin']:not([data-fullscreen]) .dshl-pagewrap .dshl.page .dshl-top { padding: 4px 16px 8px 84px; }
@media (max-width: 600px) { html[data-platform='darwin']:not([data-fullscreen]) .dshl-pagewrap .dshl.page .dshl-top { padding-left: 80px; } }
/* Newer DS-Harness: the page is a main panel beside the app's sidebar. When the sidebar is closed
   the app puts its own controls (traffic lights, sidebar toggle, new chat) at the top-left and
   publishes how much room they take: the top bar starts after them. */
.dshl-panelwrap { height: 100%; min-height: 0; background: var(--dsw-alias-bg-base, #fff); }
.dshl-panelwrap .dshl.page .dshl-top { padding-left: max(20px, var(--dsh-frame-leading-clearance, 0px)); }
/* Web page in a narrow window (sidebar as a drawer): the app gives its opener a row of its own above
   the page, so the bar starts at the edge. The desktop app keeps the opener on the bar's row instead
   (beside the traffic lights on macOS), and the clearance above leaves room for it. */
html:not([data-platform]) [data-sidebar-drawer] .dshl-panelwrap .dshl.page .dshl-top { padding-left: 12px; }
/* macOS: the app's window controls (traffic lights, sidebar toggle, new chat) are centred at y 25 in
   every state, full screen included; the bar's 40px row is centred on the same line. */
html[data-platform='darwin'] .dshl-panelwrap .dshl.page .dshl-top { padding-top: 12px; padding-bottom: 12px; }
html[data-platform='darwin'] .dshl.page .dshl-top { -webkit-app-region: drag; app-region: drag; }
html[data-platform='darwin'] .dshl.page .dshl-top :is(button, input, label, a, .dshl-select, .dshl-pick) { -webkit-app-region: no-drag; app-region: no-drag; }
.dshl.page { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.dshl.page .dshl-main { flex: 1; min-height: 0; grid-template-columns: minmax(0, 1fr) var(--side-w, clamp(320px, 30vw, 420px)); align-items: stretch; padding-bottom: 16px; }
/* Video page: player on top, then the status row, then subtitles/glossary filling what is left; chat on the right. */
.dshl.page .dshl-col { display: flex; flex-direction: column; min-height: 0; container-type: size; }
.dshl.page .dshl-col > .dshl-drop { flex: 1; aspect-ratio: auto; min-height: 0; }
.dshl.page .dshl-stage { flex: none; width: 100%; max-height: max(240px, calc(100cqh - 270px)); }
.dshl.page .dshl-side { position: relative; top: auto; height: 100%; max-height: none; }
.dshl.page.noside .dshl-main { grid-template-columns: minmax(0, 1fr); }
.dshl.page.noside .dshl-side { display: none; }
/* Drag the chat panel's left edge to change its width; the player and subtitles take the rest. */
.dshl-resize { position: absolute; top: 0; bottom: 0; left: 0; z-index: 3; width: 8px; cursor: col-resize; }
.dshl-resize::after { content: ''; position: absolute; top: 50%; left: 2px; width: 3px; height: 36px; border-radius: 2px; background: var(--line); transform: translateY(-50%); opacity: 0; transition: opacity .15s; }
.dshl-resize:hover::after { opacity: 1; }
/* Workbench open: the video and its subtitles keep a column on the left; the bench takes the rest. */
.dshl.page.bench .dshl-main { grid-template-columns: clamp(340px, 32vw, 520px) minmax(0, 1fr); }
.dshl-lag { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin: -2px 0 8px; padding: 7px 12px; border-radius: 8px; background: var(--l1, rgba(0,0,0,.04)); color: var(--muted); font-size: 12.5px; }
.dshl-lag.warn { background: color-mix(in srgb, #f5a524 14%, transparent); color: var(--ink); }
.dshl-guard { display: grid; gap: 8px; margin: 12px; padding: 12px 14px; border: 1px solid color-mix(in srgb, #d1434b 35%, var(--line)); border-radius: 10px; color: var(--ink); font-size: 13px; }
.dshl-guard p { margin: 0; line-height: 1.6; }
.dshl-guard code { color: var(--muted); font-size: 12px; white-space: pre-wrap; word-break: break-word; }
.dshl-guard div { display: flex; gap: 8px; }
.dshl-benchbox { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; }
.dshl-under { display: flex; flex-direction: column; flex: 1; min-height: 210px; overflow: hidden; border: 1px solid var(--line); border-radius: 12px; background: var(--l1); }
.dshl-under .dshl-sidetabs { align-items: center; padding: 0 12px 0 10px; }
.dshl-under .dshl-sidetabs > button { flex: none; padding: 0 14px; }
.dshl-tools.inline { flex: 1; justify-content: flex-end; min-width: 0; margin: 0; padding-left: 12px; }
.dshl-tools.inline .dshl-field { flex: 0 1 220px; width: auto; height: 30px; margin: 0; }
.dshl-tools.inline .dshl-seg { flex: none; }
.dshl-under .dshl-panel { padding-top: 8px; }
.dshl.page.theater .dshl-under { display: none; }
.dshl.page.theater .dshl-stage { max-height: 100cqh; }
@media (max-width: 1000px) {
  .dshl.page { display: block; overflow: auto; }
  .dshl-resize { display: none; }
  .dshl.page.bench .dshl-main { grid-template-columns: minmax(0, 1fr); }
  .dshl.page.bench .dshl-side { height: auto; min-height: 0; }
  .dshl-benchbox { overflow: visible; }
  .dshl.page .dshl-main { grid-template-columns: minmax(0, 1fr); align-items: start; }
  .dshl.page .dshl-col { container-type: normal; }
  .dshl.page .dshl-col > .dshl-drop { min-height: 320px; aspect-ratio: 16 / 9; }
  .dshl.page .dshl-stage { max-height: none; }
  .dshl-under { flex: none; height: 60vh; min-height: 360px; }
  .dshl.page .dshl-side { height: 70vh; min-height: 420px; }
}
@media (max-width: 600px) {
  /* Tabs keep their row; the search, line/reading switch and copy move to one of their own. */
  .dshl-under .dshl-sidetabs { flex-wrap: wrap; row-gap: 0; }
  .dshl-tools.inline { flex: 1 0 100%; justify-content: flex-start; padding: 6px 0 8px; }
  .dshl-tools.inline .dshl-field { flex: 1 1 auto; }
  .dshl-top { padding: 10px 12px; }
  .dshl-bar { flex-wrap: nowrap; gap: 6px; }
  .dshl-bar .dshl-field { flex: 1 1 0; height: 38px; padding: 0 4px 0 10px; gap: 6px; }
  .dshl-bar > .dshl-btn, .dshl-bar .dshl-ctl { height: 38px; }
  .dshl-bar > .dshl-btn.icon, .dshl-bar .dshl-ctl.icon { width: 38px; }
  .dshl-bar > .dshl-btn.primary { padding: 0 12px; }
  .dshl-bar > .dshl-btn.icon:not(.back) { display: none; }
  .dshl-main { gap: 12px; padding: 12px 12px 20px; }
  .dshl-note, .dshl-tasks { margin-left: 12px; margin-right: 12px; }
  .dshl-stage { border-radius: 10px; }
}

/* ── Player ── */
.dshl-stage { container-type: inline-size; position: relative; overflow: hidden; aspect-ratio: 16 / 9; border-radius: 12px; background: #000; outline: none; }
.dshl-stage.full { width: 100vw; height: 100vh; aspect-ratio: auto; border-radius: 0; }
.dshl-stage.pagefull { position: fixed; inset: 0; z-index: 2147483000; width: 100vw; height: 100vh; aspect-ratio: auto; border-radius: 0; }
.dshl-stage video { display: block; width: 100%; height: 100%; object-fit: contain; background: #000; }
/* Own camera: the recording sits in a box that becomes a small window while the real-time picture is large. */
.dshl-vbox { position: absolute; inset: 0; container-type: inline-size; }
.dshl-livecam { position: absolute; inset: 0; z-index: 1; container-type: inline-size; background: #000; }
.dshl-livecam img { display: block; width: 100%; height: 100%; object-fit: contain; }
.dshl-vbox.pip, .dshl-livecam.pip { inset: auto 14px 74px auto; z-index: 3; width: 28%; min-width: 180px; height: auto; aspect-ratio: 16 / 9; overflow: hidden; border-radius: 8px;
  outline: 1px solid rgba(255,255,255,.28); box-shadow: 0 6px 24px rgba(0,0,0,.5); cursor: pointer; transition: bottom .25s; }
.dshl-stage.idle .dshl-vbox.pip, .dshl-stage.idle .dshl-livecam.pip { bottom: 14px; }
.dshl-stage .pip .dshl-sub { transform: translateX(-50%) !important; }
.dshl-rs .rs-mode { display: grid; gap: 6px; margin: 10px 0 4px; }
.dshl-rs .rs-mode .seg { display: flex; }
.dshl-rs .rs-mode .seg button { flex: 1; }
.dshl-piplabel { position: absolute; top: 6px; left: 6px; z-index: 3; padding: 2px 7px; border-radius: 5px; background: rgba(0,0,0,.6); color: #fff; font-size: 11px; pointer-events: none; }
.dshl-stage.idle { cursor: none; }
.dshl-holdnote { position: absolute; top: 14px; left: 50%; z-index: 4; display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px; transform: translateX(-50%);
  background: rgba(20,20,22,.78); color: #f2f2f3; font-size: 12.5px; white-space: nowrap; backdrop-filter: blur(8px); }
.dshl-holdnote .dshl-link { color: #9ec0ff; }
.dshl-overlay { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; color: #cfcfcf; font-size: 14px; }
.dshl-spinner { width: 28px; height: 28px; border: 2.5px solid rgba(255,255,255,.18); border-top-color: #fff; border-radius: 50%; animation: dshl-spin .9s linear infinite; }
.dshl-spinner.sm { width: 14px; height: 14px; border-width: 2px; flex: none; }
@keyframes dshl-spin { to { transform: rotate(360deg); } }
@keyframes dshl-pulse { 50% { opacity: .35; } }

/* Subtitles over the picture (sizes in container units: they scale with the player) */
.dshl-sub { position: absolute; left: 50%; z-index: 2; width: 92%; text-align: center; pointer-events: none; transform: translateX(-50%); transition: transform .25s, bottom .2s, top .2s; }
.dshl-sub span { display: inline; padding: .08em .45em; border-radius: .22em; background: rgba(0,0,0,var(--subbg,.62)); color: #fff; line-height: 1.55;
  box-decoration-break: clone; -webkit-box-decoration-break: clone; text-shadow: 0 1px 2px rgba(0,0,0,.45); }
.dshl-sub .tgt { font-weight: 600; letter-spacing: .01em; }
.dshl-sub .src { color: #e8e8e8; }
.dshl-sub .draft { color: #b8b8b8; font-style: italic; }
.dshl-sub div + div { margin-top: .3em; }
/* A line that wraps is split into even halves, not a full line and one orphaned character. */
.dshl-sub div { line-break: strict; }
.dshl-stage:not(.idle) .dshl-sub[data-pos=bottom] { transform: translate(-50%, -64px); }
.dshl-stage:not(.idle) .dshl-sub[data-pos=top] { transform: translate(-50%, 34px); }

.dshl-livebadge { position: absolute; top: 12px; left: 12px; z-index: 3; display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px 0 8px; border: 0; border-radius: 999px;
  background: rgba(0,0,0,.42); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); color: #fff !important; font-size: 11.5px; font-weight: 600; letter-spacing: .06em; line-height: 1; cursor: pointer; transition: opacity .25s, background .15s; }
.dshl-livebadge:hover { background: rgba(0,0,0,.6); }
.dshl-livebadge svg { width: 10px; height: 10px; flex: none; color: rgba(255,255,255,.5); }
.dshl-livebadge.on svg { color: #ff4d4f; filter: drop-shadow(0 0 3px rgba(255,77,79,.8)); animation: dshl-pulse 1.6s ease-in-out infinite; }

.dshl-toast { position: absolute; top: 12px; left: 50%; z-index: 6; display: inline-flex; align-items: center; gap: 10px; max-width: calc(100% - 24px); padding: 8px 14px;
  border-radius: 10px; background: rgba(20,20,22,.86); color: #fff; font-size: 13px; box-shadow: 0 6px 20px rgba(0,0,0,.3); transform: translateX(-50%); }
.dshl-toast a, .dshl-toast .dshl-link { color: #8fb4ff; white-space: nowrap; text-decoration: none; }

/* Control bar */
.dshl-controls { position: absolute; left: 0; right: 0; bottom: 0; z-index: 3; padding: 26px 12px 8px; color: #fff; background: linear-gradient(to top, rgba(0,0,0,.72), rgba(0,0,0,0)); transition: opacity .25s; }
.dshl-stage.idle .dshl-controls, .dshl-stage.idle .dshl-livebadge { opacity: 0; }
.dshl-progress { position: relative; }
.dshl-progress input { -webkit-appearance: none; appearance: none; display: block; width: 100%; height: 4px; margin: 0 0 6px; border-radius: 2px; cursor: pointer;
  background: linear-gradient(to right, var(--live) 0 var(--pos, 0%), rgba(255,255,255,.55) var(--pos, 0%) var(--done, 100%), rgba(255,255,255,.18) var(--done, 100%)); }
.dshl-progress input::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; border: 0; border-radius: 50%; background: var(--live); }
.dshl-progress input::-moz-range-thumb { width: 12px; height: 12px; border: 0; border-radius: 50%; background: var(--live); }
.dshl-progress i.subs { position: absolute; top: 7px; left: 0; height: 2px; width: var(--subs, 0%); border-radius: 1px; background: #7fb0ff; pointer-events: none; }
.dshl-progress i.clip { position: absolute; top: 0; height: 4px; border-radius: 2px; background: rgba(255,215,64,.85); pointer-events: none; }
.dshl-ctrlrow { display: flex; align-items: center; gap: 4px; }
.dshl-ctrlrow .ic { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 36px; height: 36px; border: 0; border-radius: 8px; background: none; color: #fff; opacity: .88; cursor: pointer; }
.dshl-ctrlrow .ic:hover { background: rgba(255,255,255,.14); opacity: 1; }
.dshl-ctrlrow .ic.on { background: rgba(255,255,255,.16); opacity: 1; }
.dshl-ctrlrow .ic.rec { color: #ffd740; background: rgba(255,215,64,.16); }
.dshl-ctrlrow .vol { width: 80px; accent-color: #fff; }
.dshl-ctrlrow .time { margin-left: 6px; font-size: 12px; font-variant-numeric: tabular-nums; opacity: .85; white-space: nowrap; }
.dshl-ctrlrow .pill { display: inline-flex; align-items: center; gap: 6px; flex: 0 1 auto; min-width: 0; max-width: 260px; height: 30px; margin: 0 4px; padding: 0 10px 0 8px;
  border: 0; border-radius: 8px; background: rgba(255,255,255,.12); color: #fff; font-size: 12.5px; line-height: 1; cursor: pointer; }
.dshl-ctrlrow .pill:hover, .dshl-ctrlrow .pill.on { background: rgba(255,255,255,.22); }
.dshl-ctrlrow .pill svg { flex: none; width: 18px; height: 18px; }
.dshl-ctrlrow .pill .txt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshl-ctrlrow .pill .caret { flex: none; width: 5px; height: 5px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; opacity: .8; transform: translateY(1px) rotate(-135deg); }
@container (max-width: 640px) {
  .dshl-ctrlrow .pill .txt, .dshl-ctrlrow .pill .caret { display: none; } .dshl-ctrlrow .pill { padding: 0 6px; }
  /* Narrow player (a workbench beside it, a phone): fewer words, no volume slider (the mute button stays). */
  .dshl-ctrlrow .vol, .dshl-ctrlrow .theater { display: none; }
  .dshl-ctrlrow .ic { width: 32px; height: 32px; }
}
@container (max-width: 520px) {
  .dshl-ctrlrow { gap: 2px; }
  .dshl-ctrlrow .vol, .dshl-ctrlrow .mute, .dshl-ctrlrow .theater { display: none; }
  .dshl-ctrlrow .ic { width: 32px; height: 32px; }
  .dshl-ctrlrow .pill { margin: 0; }
  .dshl-controls { padding: 22px 6px 4px; }
}
@container (max-width: 420px) { .dshl-ctrlrow .time { display: none; } }

/* Subtitle generation button (start / progress / resume) */
.dshl-subsbtn { display: inline-flex; align-items: center; gap: 6px; flex: none; height: 28px; margin: 0 6px; padding: 0 12px; border: 0; border-radius: 999px; line-height: 1;
  background: var(--accent); color: #fff; font-size: 12.5px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; cursor: pointer; }
.dshl-subsbtn:hover { filter: brightness(1.08); }
.dshl-subsbtn.running { background: linear-gradient(to right, rgba(127,176,255,.45) var(--p, 0%), rgba(255,255,255,.14) var(--p, 0%)); font-weight: 500; }
.dshl-subsbtn.running .dot { width: 7px; height: 7px; border-radius: 50%; background: #ff5a5f; animation: dshl-pulse 1.6s ease-in-out infinite; }
.dshl-subsbtn.running .act, .dshl-subsbtn .short { display: none; }
@container (max-width: 640px) { .dshl-subsbtn .now { display: none; } .dshl-subsbtn.running:not(:hover) .short { display: inline; } }
.dshl-subsbtn.running:hover .now { display: none; }
.dshl-subsbtn.running:hover .act { display: inline; }
.dshl-subsbtn.running:hover .dot { width: 8px; height: 8px; border-radius: 1px; background: #fff; animation: none; }
@container (max-width: 520px) { .dshl-subsbtn { margin: 0 2px; padding: 0 9px; } }
.dshl-starter { position: relative; display: inline-flex; }
.dshl-startpop { position: absolute; left: 50%; bottom: calc(100% + 26px); z-index: 6; display: grid; gap: 10px; width: 290px; padding: 12px 12px 14px; transform: translateX(-50%);
  border: 1px solid rgba(255,255,255,.08); border-radius: 12px; background: rgba(28,28,31,.95); color: var(--ink); box-shadow: 0 16px 40px rgba(0,0,0,.45); backdrop-filter: blur(16px);
  font-size: 13px; line-height: 1.5; text-align: left; }
.dshl-startpop .dshl-more summary { color: var(--muted); }
.dshl-startpop .head { font-size: 13.5px; font-weight: 600; }
.dshl-startpop .note { margin: -4px 0 0; color: var(--muted); font-size: 12px; }
.dshl-startpop .opts { display: grid; gap: 6px; }
.dshl-startpop .opt { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 9px 12px; border: 1px solid var(--line); border-radius: 10px;
  background: var(--l1); color: var(--ink); text-align: left; cursor: pointer; }
.dshl-startpop .opt b { font-weight: 600; }
.dshl-startpop .opt span { color: var(--faint); font-size: 12px; }
.dshl-startpop .opt:hover { border-color: rgba(255,255,255,.3); }
.dshl-startpop .opt.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); }
.dshl-startpop .dshl-chips .chip { background: transparent; }
.dshl-startpop .go { width: 100%; height: 36px; }
.dshl-startpop.sheet { position: relative; left: auto; bottom: auto; width: 100%; padding: 18px 16px calc(18px + env(safe-area-inset-bottom)); transform: none; border: 0; border-radius: 16px 16px 0 0;
  font-family: system-ui, -apple-system, "PingFang SC", sans-serif; font-size: 15px; }
.dshl-startpop.sheet .head { font-size: 16px; }
.dshl-startpop.sheet .opt { padding: 13px 14px; }
.dshl-startpop.sheet .go { height: 44px; font-size: 15px; }
.dshl-menu .dshl-btn.primary, .dshl-startpop .dshl-btn.primary { background: #3d6df2; border-color: #3d6df2; color: #fff; }

/* ── Player menus: dark and translucent like the control bar ── */
.dshl-menu, .dshl-startpop {
  --bg: #1f1f22; --ink: #f2f2f3; --muted: #b4b4ba; --faint: #8b8b92; --line: rgba(255,255,255,.14); --line-soft: rgba(255,255,255,.08);
  --l1: rgba(255,255,255,.06); --l2: rgba(255,255,255,.1); --hover: rgba(255,255,255,.08); --track: rgba(255,255,255,.1); --accent: #7aa2ff; }
.dshl-menu { position: absolute; right: 10px; bottom: 60px; z-index: 5; display: flex; flex-direction: column; width: min(360px, calc(100% - 20px)); max-height: calc(100% - 72px);
  border: 1px solid rgba(255,255,255,.08); border-radius: 12px; background: rgba(28,28,31,.95); color: var(--ink); box-shadow: 0 16px 40px rgba(0,0,0,.45); backdrop-filter: blur(16px);
  font-size: 13px; line-height: 1.5; text-align: left; }
.dshl-menu .head { display: flex; align-items: center; gap: 10px; padding: 10px 8px 6px 14px; font-size: 13.5px; font-weight: 600; }
.dshl-menu .head button.ghost { width: 30px; height: 30px; border-radius: 8px; }
.dshl-menu .body { display: grid; gap: 10px; min-height: 0; overflow: auto; padding: 2px 8px 10px; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.25) transparent; }
.dshl-menu .body::-webkit-scrollbar { width: 6px; }
.dshl-menu .body::-webkit-scrollbar-thumb { border-radius: 3px; background: rgba(255,255,255,.22); }
.dshl-menu .dshl-seg { height: 28px; }
.dshl-menu .dshl-seg button { padding: 0 8px; font-size: 12px; font-variant-numeric: tabular-nums; }
.dshl-menu .dshl-seg button.on { background: rgba(255,255,255,.92); color: #111; box-shadow: none; }
.dshl-menu .dshl-switch { background: rgba(255,255,255,.22); }
.dshl-menu .dshl-switch.on { background: var(--accent); }
.dshl-history { width: 100%; max-width: 680px; margin-top: 40px; text-align: left; }
.dshl-history .hh { margin: 0 0 8px 4px; color: var(--faint); font-size: 12.5px; }
.dshl-history .hl { display: grid; gap: 2px; }
.dshl-history .hi { display: flex; align-items: center; gap: 12px; width: 100%; padding: 6px; border: 0; border-radius: 10px; background: none; color: var(--ink); text-align: left; cursor: pointer; }
.dshl-history .hi:hover { background: var(--hover); }
.dshl-history .th { position: relative; flex: none; width: 96px; aspect-ratio: 16 / 9; overflow: hidden; border-radius: 6px; background: var(--l2); }
.dshl-history .th img { display: block; width: 100%; height: 100%; object-fit: cover; }
.dshl-history .dur { position: absolute; right: 4px; bottom: 3px; padding: 0 4px; border-radius: 3px; background: rgba(0,0,0,.65); color: #fff; font-size: 10.5px; line-height: 16px; font-variant-numeric: tabular-nums; }
.dshl-history .tx { display: grid; gap: 3px; min-width: 0; flex: 1; }
.dshl-history .tt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13.5px; font-weight: 550; }
.dshl-history .mm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--faint); font-size: 12px; }
.dshl-history .chip { flex: none; padding: 2px 8px; border-radius: 999px; background: color-mix(in srgb, var(--live) 14%, transparent); color: var(--live); font-size: 11.5px; font-weight: 600; }
.dshl-history .more { margin: 8px 0 0 6px; font-size: 12.5px; }
.dshl-modemenu { display: grid; gap: 4px; width: 300px; max-width: 100%; }
.dshl-modemenu .mm { display: grid; gap: 3px; padding: 9px 10px; border: 0; border-radius: 8px; background: none; color: inherit; text-align: left; cursor: pointer; }
.dshl-modemenu .mm:hover { background: rgba(255,255,255,.08); }
.dshl-modemenu .mm.on { background: rgba(255,255,255,.12); }
.dshl-modemenu .n { display: flex; align-items: center; justify-content: space-between; font-size: 13.5px; font-weight: 600; }
.dshl-modemenu .n svg { width: 14px; height: 14px; }
.dshl-modemenu .d { color: rgba(255,255,255,.62); font-size: 12px; line-height: 1.45; }
.dshl-menu .opt { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 32px; padding: 0 6px; color: var(--muted); }
.dshl-menu .opt .dshl-seg { max-width: 100%; overflow-x: auto; scrollbar-width: none; }
.dshl-menu .opt input[type=range] { flex: 1; max-width: 180px; accent-color: var(--accent); }

/* Subtitle menu: main and second line, then size / position / background */
.dshl-submenu { display: grid; gap: 4px; }
.dshl-submenu .slots { display: grid; gap: 8px; padding: 4px 6px 10px; }
.dshl-submenu .slot { display: grid; grid-template-columns: 56px 1fr; align-items: center; gap: 10px; color: var(--muted); }
.dshl-submenu .slot .dshl-select { width: 100%; height: 34px; background: var(--l1); }
.dshl-submenu .swap { justify-self: start; height: 26px; margin-left: 66px; padding: 0 10px; border: 0; border-radius: 6px; background: var(--l2); color: var(--muted); font-size: 12px; cursor: pointer; }
.dshl-submenu .swap:hover { color: var(--ink); }
.dshl-submenu .opts { position: sticky; bottom: -10px; display: grid; gap: 2px; margin: 0 -8px -10px; padding: 6px 8px 10px; border-top: 1px solid var(--line-soft); background: rgb(28,28,31); }
.dshl-submenu .seg { display: inline-flex; width: 168px; gap: 2px; padding: 2px; border-radius: 8px; background: var(--l2); }
.dshl-submenu .seg button { flex: 1; min-width: 0; height: 26px; padding: 0 10px; border: 0; border-radius: 6px; background: none; color: var(--muted); font-size: 12.5px; cursor: pointer; }
.dshl-submenu .seg button.on { background: rgba(255,255,255,.92); color: #111; font-weight: 600; }

/* Download (inside the dark menu) */
/* Restream (player menu) */
.dshl-rs { display: grid; gap: 10px; padding: 0 6px; }
.dshl-rs .rs-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: var(--muted); font-size: 12.5px; }
.dshl-rs .rs-head .dshl-link { flex: none; font-size: 12.5px; }
.dshl-rs .rs-list { display: grid; gap: 2px; margin: 0 -6px; }
.dshl-rs .rs-row { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 4px 6px 4px 10px; border-radius: 8px; }
.dshl-rs .rs-row:hover { background: var(--hover); }
.dshl-rs .rs-row input[type=checkbox], .dshl-rs .rs-check input { width: 16px; height: 16px; margin: 0; flex: none; accent-color: #3d6df2; cursor: pointer; }
.dshl-rs .rs-name { display: grid; flex: 1; min-width: 0; font-size: 13.5px; font-weight: 550; }
.dshl-rs .rs-name small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--faint); font-size: 11.5px; font-weight: 400; }
.dshl-rs .rs-tools { display: flex; gap: 2px; opacity: .65; }
.dshl-rs .rs-row:hover .rs-tools { opacity: 1; }
.dshl-rs button.ghost { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px; background: none; color: var(--muted); cursor: pointer; }
.dshl-rs button.ghost:hover { background: var(--l2); color: var(--ink); }
.dshl-rs .rs-dot { width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--faint); }
.dshl-rs .rs-dot.live { background: #2fbf71; box-shadow: 0 0 0 3px rgba(47,191,113,.2); }
.dshl-rs .rs-dot.connecting, .dshl-rs .rs-dot.retrying { background: #f5a524; animation: dshl-pulse 1.4s ease-in-out infinite; }
.dshl-rs .rs-dot.error { background: #ff5a5f; }
.dshl-rs .rs-state { flex: none; color: var(--muted); font-size: 12px; }
.dshl-rs .rs-state.live { color: #5fd897; }
.dshl-rs .rs-state.error { color: #ff7a7e; }
.dshl-rs .rs-opts { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 34px; }
.dshl-rs .rs-check { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
.dshl-rs .seg { display: inline-flex; gap: 2px; padding: 2px; border-radius: 8px; background: var(--l2); }
.dshl-rs .seg button { height: 26px; padding: 0 12px; border: 0; border-radius: 6px; background: none; color: var(--muted); font-size: 12.5px; cursor: pointer; }
.dshl-rs .seg button.on { background: rgba(255,255,255,.92); color: #111; font-weight: 600; }
.dshl-rs .dshl-btn.block { height: 38px; justify-content: center; }
.dshl-rs .dshl-btn.rs-stop { border-color: transparent; background: #e5484d; color: #fff; }
.dshl-rs .rs-hint { margin: 0; color: var(--faint); font-size: 12px; line-height: 1.55; }
.dshl-rs .rs-err { margin: 0; color: #ff8f92; font-size: 12px; line-height: 1.55; }
.dshl-rs .rs-field { display: grid; grid-template-columns: 76px 1fr; align-items: center; gap: 10px; font-size: 13px; color: var(--muted); }
.dshl-rs .rs-overlay { display: grid; gap: 4px; margin-top: 4px; padding-top: 10px; border-top: 1px solid var(--line); }
.dshl-rs .rs-sub { color: var(--muted); font-size: 12.5px; font-weight: 550; }
.dshl-rs .rs-url { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dshl-rs .rs-url code { overflow: hidden; color: var(--ink); font: 12.5px ui-monospace, SFMono-Regular, Menlo, monospace; text-overflow: ellipsis; white-space: nowrap; user-select: all; }
.dshl-rs .rs-field .dshl-select { width: 100%; height: 34px; background: var(--l1); }
.dshl-rs .rs-field input { width: 100%; height: 34px; padding: 0 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--l1); color: var(--ink); font: inherit; font-size: 13px; }
.dshl-rs .rs-field input:focus { outline: none; border-color: var(--accent); }
.dshl-rs .rs-actions { display: flex; justify-content: flex-end; gap: 8px; }
.dshl-menu.sheet .dshl-rs .rs-row { min-height: 50px; }
.dshl-menu.sheet .dshl-rs .rs-field input, .dshl-menu.sheet .dshl-rs .rs-field .dshl-select { height: 42px; font-size: 15px; }
.dshl-menu.sheet .dshl-rs .dshl-btn.block { height: 46px; font-size: 15px; }
.dshl-dl { display: grid; gap: 14px; padding: 0 6px; }
.dshl-dl .grp { display: grid; gap: 8px; }
.dshl-dl .cap { color: var(--muted); font-size: 12px; font-weight: 550; }
.dshl-dl-note { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.6; }
.dshl-dl .cards { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.dshl-card-opt { display: grid; align-content: start; gap: 2px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--l1); color: var(--ink); text-align: left; cursor: pointer; }
.dshl-card-opt b { font-size: 13px; font-weight: 600; }
.dshl-card-opt span { color: var(--muted); font-size: 12px; }
.dshl-card-opt:hover:not(:disabled) { border-color: rgba(255,255,255,.3); }
.dshl-card-opt.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
.dshl-card-opt:disabled { opacity: .45; cursor: default; }
.dshl-dl .dshl-btn.block { height: 38px; }
.dshl-dl .dshl-btn.block:not(.primary) { background: var(--l1); border-color: var(--line); color: var(--ink); }
.dshl-dl .dshl-btn.progress { background: linear-gradient(to right, color-mix(in srgb, var(--accent) 40%, transparent) var(--p, 0%), var(--l1) var(--p, 0%)); cursor: default; }
.dshl-dl .err { margin: 0; color: #ff8a8d; font-size: 12.5px; }
.dshl-dl .dshl-chips .chip { background: transparent; }

/* Menus as a bottom sheet on small players (phones) */
.dshl-sheetwrap { position: fixed; inset: 0; z-index: 2147483002; display: flex; align-items: flex-end; justify-content: center; background: rgba(0,0,0,.4); }
body > .dshl-menu { z-index: 2147483002; }
.dshl-menu.sheet { position: relative; right: auto; bottom: auto; width: 100%; max-width: 560px; max-height: 78vh; padding-bottom: env(safe-area-inset-bottom); border: 0; border-radius: 16px 16px 0 0;
  font-family: system-ui, -apple-system, "PingFang SC", sans-serif; font-size: 15px; }
.dshl-menu.sheet .head { padding: 14px 12px 8px 18px; font-size: 16px; }
.dshl-menu.sheet .body { padding: 4px 14px 16px; }
.dshl-menu.sheet .opt { min-height: 44px; font-size: 15px; }
.dshl-menu.sheet .dshl-seg { height: 40px; }
.dshl-menu.sheet .dshl-seg button, .dshl-menu.sheet .dshl-submenu .seg button { min-width: 52px; height: 34px; font-size: 14px; }
.dshl-menu.sheet .dshl-submenu .seg { width: 210px; }
.dshl-menu.sheet .dshl-submenu .slot { grid-template-columns: 64px 1fr; font-size: 15px; }
.dshl-menu.sheet .dshl-submenu .slot .dshl-select { height: 44px; font-size: 15px; }
.dshl-menu.sheet .dshl-submenu .swap { height: 34px; margin-left: 74px; font-size: 14px; }
.dshl-menu.sheet .dshl-switch { width: 44px; height: 26px; }
.dshl-menu.sheet .dshl-switch i { width: 22px; height: 22px; }
.dshl-menu.sheet .dshl-switch.on i { left: 20px; }

/* ── Status row under the player ── */
.dshl-done { display: flex; align-items: center; gap: 10px; min-width: 0; min-height: 32px; font-size: 13px; }
.dshl-pill { display: inline-flex; align-items: center; gap: 6px; flex: none; height: 24px; padding: 0 10px; border: 0; border-radius: 999px; background: var(--track); color: var(--muted); font-size: 12px; font-weight: 600; line-height: 1; }
.dshl-pill.live { background: color-mix(in srgb, var(--live) 12%, transparent); color: var(--live); }
.dshl-pill .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; animation: dshl-pulse 1.6s ease-in-out infinite; }
.dshl-time { color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
.dshl-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); font-weight: 550; }
.dshl-usage { position: relative; flex: none; }
.dshl-usage > .dshl-pill { font-weight: 500; font-variant-numeric: tabular-nums; cursor: pointer; }

/* ── Side panel ── */
.dshl-side { position: sticky; top: 112px; display: flex; flex-direction: column; min-width: 0; max-height: calc(100vh - 150px); overflow: hidden;
  border: 1px solid var(--line); border-radius: 12px; background: var(--l1); }
@media (max-width: 1000px) { .dshl-side { position: static; max-height: none; } }
.dshl-sidetabs { display: flex; gap: 4px; padding: 0 10px; border-bottom: 1px solid var(--line); }
.dshl-sidetabs > button { flex: 1; height: 42px; margin-bottom: -1px; padding: 0 4px; border: 0; border-bottom: 2px solid transparent; background: none; color: var(--muted); font-size: 13.5px; white-space: nowrap; cursor: pointer; }
.dshl-sidetabs > button:hover { color: var(--ink); }
.dshl-sidetabs > button.on { border-bottom-color: var(--ink); color: var(--ink); font-weight: 600; }
.dshl-panel { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: auto; padding: 12px 14px 14px; }
.dshl-tools { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.dshl-tools .dshl-seg { height: 30px; }

/* Lines (follow playback) */
.dshl-lines { display: flex; flex-direction: column; gap: 2px; flex: 1; min-height: 0; margin: 0 -6px; overflow: auto; }
.dshl:not(.page) .dshl-lines { max-height: calc(100vh - 330px); }
@media (max-width: 1000px) { .dshl:not(.page) .dshl-lines { max-height: 60vh; } }
.dshl-line { display: grid; grid-template-columns: 44px 1fr 14px; gap: 6px; padding: 7px 6px; border: 0; border-radius: 8px; background: none; color: var(--ink); text-align: left; cursor: pointer; }
.dshl-lines > .pad { padding: 16px 6px; }
.dshl-line:hover { background: var(--hover); }
.dshl-line.active { background: color-mix(in srgb, var(--accent) 10%, transparent); }
.dshl-line .ts { padding-top: 2px; color: var(--faint); font-size: 12px; font-variant-numeric: tabular-nums; }
.dshl-line.active .ts { color: var(--accent); font-weight: 600; }
.dshl-line .txt { display: grid; gap: 2px; font-size: 13.5px; }
.dshl-line .main { font-weight: 550; }
.dshl-line .sub { color: var(--muted); font-size: 13px; }
.dshl-line.raw .main, .dshl-line.raw .sub { opacity: .62; }
/* Polished lines: a quiet tick at the end; first-pass lines stay lighter until polished. */
.dshl-line .mark { display: flex; padding-top: 4px; color: var(--faint); opacity: .7; }
.dshl-line.active .mark { color: var(--accent); }
/* Player: a faint tick on the subtitle button while the line on screen is polished (explained on hover). */
.dshl-okmark { display: flex; margin: 0 -2px 0 1px; color: rgba(255,255,255,.45); }
.dshl-okmark svg { width: 9px; height: 9px; }

/* Reading (paragraphs by speaker) */
.dshl-read { display: grid; align-content: start; gap: 16px; flex: 1; min-height: 0; overflow: auto; padding: 2px 2px 12px; }
.dshl:not(.page) .dshl-read { max-height: calc(100vh - 330px); }
.dshl-read > .dshl-muted { margin: 0; }
.dshl-read section { padding: 2px 8px 2px 10px; border-left: 2px solid transparent; }
.dshl-read section.active { border-left-color: var(--accent); }
.dshl-read header { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; font-size: 12.5px; }
.dshl-read header b { color: var(--ink); font-weight: 600; }
.dshl-read header .ts { padding: 0; border: 0; background: none; color: var(--faint); font-size: 12px; font-variant-numeric: tabular-nums; cursor: pointer; }
.dshl-read p { margin: 0 0 4px; font-size: 14px; line-height: 1.75; }
.dshl-read p.src { color: var(--ink); }
.dshl-read p.tr { color: var(--muted); }

/* Glossary (kept by the model) */
.dshl-gl2 { display: grid; align-content: start; gap: 2px; margin: 0 -8px; }
.dshl-gl2 .term { padding: 8px; border-radius: 8px; }
.dshl-gl2 .term:hover { background: var(--hover); }
.dshl-gl2 .line { display: flex; align-items: center; gap: 8px; min-height: 24px; font-size: 13.5px; }
.dshl-gl2 .line b { font-weight: 600; }
.dshl-gl2 .line .tr { color: var(--muted); }
.dshl-gl2 .line .tr::before { content: '→ '; color: var(--faint); }
.dshl-gl2 .line button.ghost { width: 24px; height: 24px; opacity: 0; }
.dshl-gl2 .term:hover .line button.ghost { opacity: 1; }
.dshl-gl2 .tag { padding: 0 6px; border-radius: 999px; background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent); font-size: 11px; }
.dshl-gl2 .meta { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 2px; color: var(--faint); font-size: 12px; }
.dshl-gl2 .term.edit { display: grid; gap: 6px; background: var(--bg); border: 1px solid var(--line); }
.dshl-gl2 .term.edit input { height: 32px; padding: 0 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--ink); font: inherit; font-size: 13px; }
.dshl-gl2 .term.edit .acts { display: flex; align-items: center; justify-content: flex-end; gap: 12px; }

/* Chat with DeepSeek (video page) */
.dshl-chat { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.dshl-chat .msgs { display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 0; overflow: auto; padding: 12px 14px; }
.dshl-chat .msg { max-width: 92%; padding: 8px 11px; border-radius: 12px; font-size: 13.5px; line-height: 1.6; word-break: break-word; }
.dshl-chat .msg.user { align-self: flex-end; white-space: pre-wrap; background: color-mix(in srgb, var(--accent) 12%, var(--bg)); }
.dshl-chat .msg.bot { align-self: flex-start; border: 1px solid var(--line-soft); background: var(--bg); }
.dshl-chat .msg.tool { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px; background: var(--l2); color: var(--muted); font-size: 12px; }
.dshl-chat .msg.tool svg { width: 12px; height: 12px; }
.dshl-chat .msg.tool.on svg { animation: dshl-spin 1.4s linear infinite; }
.dshl-chat .msg.err { align-self: stretch; background: color-mix(in srgb, var(--live) 6%, var(--bg)); color: var(--live); font-size: 12.5px; }
.dshl-chat .quick { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 12px 0; border-top: 1px solid var(--line); }
.dshl-chat .quick button { height: 28px; padding: 0 10px; border: 1px solid var(--line); border-radius: 999px; background: var(--bg); color: var(--ink); font-size: 12.5px; cursor: pointer; }
.dshl-chat .quick button:hover { border-color: var(--accent); color: var(--accent); }
.dshl-chat .composer { display: flex; align-items: flex-end; gap: 8px; padding: 10px 12px 12px; }
.dshl-chat .composer textarea { flex: 1; min-width: 0; max-height: 160px; padding: 8px 10px; resize: none; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); color: var(--ink);
  font: inherit; font-size: 13.5px; line-height: 1.5; }
.dshl-chat .composer textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent); }
.dshl-chat .composer .dshl-btn { height: 36px; }
.dshl-chat .md > * { margin: 0 0 6px; }
.dshl-chat .md > *:last-child { margin-bottom: 0; }
.dshl-chat .md p { white-space: pre-wrap; }
.dshl-chat .md p.h { font-weight: 650; }
.dshl-chat .md ul, .dshl-chat .md ol { padding-left: 18px; }
.dshl-chat .md li { margin: 2px 0; }
.dshl-chat .md code { padding: 1px 5px; border-radius: 5px; background: var(--l2); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; word-break: break-all; }
.dshl-chat .md a { color: var(--accent); text-decoration: none; }
.dshl-chat .md a code { background: color-mix(in srgb, var(--accent) 10%, transparent); color: var(--accent); }
.dshl-chat .md pre { overflow: auto; padding: 8px 10px; border-radius: 8px; background: var(--l2); }
.dshl-chat .md pre code { padding: 0; background: none; }
.dshl-chat .md table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.dshl-chat .md th, .dshl-chat .md td { padding: 4px 6px; border-bottom: 1px solid var(--line-soft); text-align: left; vertical-align: top; }
.dshl-chat .md th { color: var(--muted); font-weight: 550; }
.dshl-chat .md th:first-child, .dshl-chat .md td:first-child { white-space: nowrap; }

/* ── Popovers (settings, usage) ── */
.dshl-pop { position: absolute; top: calc(100% + 6px); left: 0; z-index: 40; min-width: 260px; max-width: min(340px, calc(100vw - 32px)); padding: 8px;
  border: 1px solid var(--line); border-radius: 12px; background: var(--bg); box-shadow: 0 12px 32px rgba(0,0,0,.14); }
.dshl-pop.right { left: auto; right: 0; }
.dshl-pop.up { top: auto; bottom: calc(100% + 6px); }
.dshl .srow { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 46px; font-size: 13.5px; }
.dshl-pop.settings { width: 380px; padding: 6px 12px; }
.dshl .srow .duo { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); gap: 8px; }
.dshl .srow .duo > .dshl-select { width: 100%; }
.dshl-pop.settings .srow + .srow { border-top: 1px solid var(--line-soft); }
.dshl-pop.settings .srow.version .vline { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; color: var(--faint); font-size: 12.5px; }
.dshl-pop.settings .srow.version .new { color: #e5484d; font-weight: 550; }
.dshl-pop.settings .srow.version .dshl-btn.small { height: 28px; padding: 0 12px; border-radius: 7px; font-size: 12.5px; }
.dshl-pop.settings .srow > .dshl-select, .dshl-pop.settings .srow > .dshl-seg { width: 168px; }
.dshl-pop.settings .srow > .dshl-seg button { flex: 1; padding: 0 6px; }
.dshl .srow.col { display: grid; justify-content: stretch; gap: 8px; padding: 10px 0; }
.dshl .srow .keyline { display: flex; align-items: center; gap: 6px; }
.dshl .srow .keyline code { color: var(--muted); font-size: 12.5px; }
.dshl .srow .keyline input { flex: 1; min-width: 0; height: 32px; padding: 0 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--ink);
  font: inherit; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
.dshl .srow .ok { color: var(--ok); font-size: 12.5px; }
.dshl .srow .bad { color: var(--live); font-size: 12.5px; }
.dshl .srow a { color: var(--accent); font-size: 12.5px; text-decoration: none; white-space: nowrap; }
.dshl .srow .keyline .from { color: var(--faint); font-size: 12px; }
.dshl .srow .keyline .dshl-link { margin-left: auto; }
.dshl .srow .keyfoot { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; color: var(--faint); font-size: 12px; line-height: 1.5; }
.dshl .srow .hint { color: var(--muted); font-size: 12.5px; line-height: 1.6; }
.dshl .srow .pair { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.dshl .srow .pair > .dshl-select { width: 168px; }
.dshl-pop.usage { min-width: 320px; padding: 12px 14px; }
.dshl-pop.usage h3 { margin: 0 0 8px; color: var(--muted); font-size: 12.5px; font-weight: 600; }
.dshl-pop.usage table { width: 100%; border-collapse: collapse; font-size: 12.5px; font-variant-numeric: tabular-nums; }
.dshl-pop.usage th { padding: 2px 0 6px 10px; color: var(--faint); font-weight: 500; text-align: right; }
.dshl-pop.usage td { padding: 4px 0 4px 10px; border-top: 1px solid var(--line-soft); text-align: right; }
.dshl-pop.usage th:first-child, .dshl-pop.usage td:first-child { max-width: 140px; padding-left: 0; overflow: hidden; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
.dshl-pop.usage p { margin: 8px 0 0; }
.dshl-pop.usage table + table { margin-top: 12px; }
.dshl-pop.usage table.audio td:first-child { max-width: 180px; }
@media (max-width: 600px) { .dshl-pop.settings.right { position: fixed; top: 58px; left: 12px; right: 12px; width: auto; max-width: none; } }

/* ── Login dialog ── */
.dshl-modal { position: fixed; inset: 0; z-index: 2147483001; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(0,0,0,.36); }
.dshl-modal .box { position: relative; width: min(400px, 100%); padding: 28px 24px 20px; border-radius: 16px; background: var(--bg); color: var(--ink); box-shadow: 0 24px 64px rgba(0,0,0,.28); text-align: center; }
.dshl-modal .x { position: absolute; top: 10px; right: 10px; }
.dshl-modal .ico { display: flex; align-items: center; justify-content: center; width: 48px; height: 48px; margin: 0 auto 12px; border-radius: 50%;
  background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent); }
.dshl-modal h3 { margin: 0 0 6px; font-size: 17px; font-weight: 650; }
.dshl-modal p { margin: 0 0 14px; color: var(--muted); font-size: 13.5px; }
.dshl-modal .srow { padding: 0 2px; border-top: 1px solid var(--line-soft); border-bottom: 1px solid var(--line-soft); text-align: left; }
.dshl-modal .acts { display: flex; justify-content: center; gap: 8px; margin-top: 18px; }
.dshl-modal .acts .dshl-btn { height: 36px; }

/* ── Drop overlay ── */
.dshl-dropzone { position: absolute; inset: 0; z-index: 20; display: flex; align-items: center; justify-content: center; padding: 24px;
  background: color-mix(in srgb, var(--accent) 10%, color-mix(in srgb, var(--bg) 85%, transparent)); }
.dshl-dropzone div { padding: 40px 56px; border: 2px dashed var(--accent); border-radius: 18px; background: var(--bg); color: var(--accent); font-size: 17px; font-weight: 600; }

/* ── Outside the plugin view: sidebar entry and the composer's paste prompt (host tokens directly) ── */
.dshl-sidebtn { position: relative; isolation: isolate; display: flex; align-items: center; gap: 8px; flex: 0 0 auto; overflow: hidden; border: 0; background: none; cursor: pointer;
  color: var(--dsw-alias-label-primary, #1b1b19); font-family: inherit; font-size: 14px; line-height: 22px; box-sizing: border-box; }
.dshl-sidebtn.wide { width: calc(100% + 4px); height: 42px; margin: 4px -2px 0; padding: 0 10px 0 8px; border-radius: 12px; }
.dshl-sidebtn.rail { justify-content: center; width: 36px; height: 36px; margin: 8px 0 0; padding: 0; border-radius: 50%; }
.dshl-sidebtn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05)); }
.dshl-sidebtn svg { flex: none; }
/* The mark is drawn at 18px; the host's sidebar icons are 16px. Same centre, same text start. */
.dshl-sidebtn.wide svg { margin: 0 -1px; }
.dshl-sidebtn .label { position: relative; overflow: hidden; white-space: nowrap; }
.dshl-sidebtn .meta { margin-left: auto; color: var(--dsw-alias-label-secondary, #66655f); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.dshl-sidebtn .bg { position: absolute; inset: 0; z-index: -1; background: var(--thumb) center / cover no-repeat; opacity: .38; filter: saturate(.85);
  -webkit-mask-image: linear-gradient(to right, #000 0%, #000 35%, transparent 100%); mask-image: linear-gradient(to right, #000 0%, #000 35%, transparent 100%); }
.dshl-sidebtn .bg::after { content: ''; position: absolute; inset: 0; background: color-mix(in srgb, var(--dsw-alias-bg-base, #fff) 35%, transparent); }
.dshl-sidebtn.rail .bg { opacity: .45; -webkit-mask-image: none; mask-image: none; }
.dshl-mark .c1, .dshl-mark .c2 { stroke-dasharray: 8; stroke-dashoffset: 0; }
.dshl-mark.busy .c1 { animation: dshl-write 1.8s ease-in-out infinite; }
.dshl-mark.busy .c2 { animation: dshl-write 1.8s ease-in-out .45s infinite; }
.dshl-mark.busy .play { animation: dshl-breathe 1.8s ease-in-out infinite; transform-origin: 12px 10px; }
.dshl-mark .rec { animation: dshl-pulse 1.6s ease-in-out infinite; }
@keyframes dshl-write { 0% { stroke-dashoffset: 8; } 45%, 70% { stroke-dashoffset: 0; } 100% { stroke-dashoffset: -8; } }
@keyframes dshl-breathe { 50% { opacity: .55; } }
@media (prefers-reduced-motion: reduce) { .dshl-mark.busy .c1, .dshl-mark.busy .c2, .dshl-mark.busy .play, .dshl-mark .rec { animation: none; } }

.dshl-pastechip { display: flex; width: 100%; max-width: 812px; margin: 0 auto; padding: 0 16px 8px; box-sizing: border-box; }
.dshl-pastechip button { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; height: 28px; padding: 0 12px; border: 0; border-radius: 999px; cursor: pointer;
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #3b6ef5) 12%, transparent); color: var(--dsw-alias-state-business-primary, #3b6ef5); font: inherit; font-size: 12.5px; }
.dshl-pastechip button svg { flex: none; width: 13px; height: 13px; }
.dshl-pastechip .url { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: .7; }
`

let done = false
export function ensureStyles(): void {
  if (done || typeof document === 'undefined') return
  done = true
  // An update loads this module again without reloading the page: replace the old rules, never stack on them.
  for (const old of document.querySelectorAll('style[data-dsh-live]')) old.remove()
  const el = document.createElement('style')
  el.dataset.dshLive = ''
  el.textContent = CSS
  document.head.append(el)
}
