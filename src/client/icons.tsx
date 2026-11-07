/** Minimal stroke icons (24×24, currentColor). */
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

export const Icon = {
  play: () => <svg viewBox="0 0 24 24" width="20" height="20"><path d="M7 5v14l11-7z" fill="currentColor" /></svg>,
  pause: () => <svg viewBox="0 0 24 24" width="20" height="20"><path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor" /></svg>,
  volume: () => <svg viewBox="0 0 24 24" width="20" height="20" {...P}><path d="M4 9h4l5-4v14l-5-4H4z" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></svg>,
  mute: () => <svg viewBox="0 0 24 24" width="20" height="20" {...P}><path d="M4 9h4l5-4v14l-5-4H4z" /><path d="M17 9l5 6M22 9l-5 6" /></svg>,
  cc: () => <svg viewBox="0 0 24 24" width="20" height="20" {...P}><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M10.5 10.2a2.4 2.4 0 1 0 0 3.6M17 10.2a2.4 2.4 0 1 0 0 3.6" /></svg>,
  gear: () => <svg viewBox="0 0 24 24" width="20" height="20" {...P}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>,
  full: () => <svg viewBox="0 0 24 24" width="20" height="20" {...P}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>,
  exitFull: () => <svg viewBox="0 0 24 24" width="20" height="20" {...P}><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></svg>,
  theater: () => <svg viewBox="0 0 24 24" width="20" height="20" {...P}><rect x="2" y="6" width="20" height="12" rx="2" /></svg>,
  live: () => <svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="5" fill="currentColor" /></svg>,
  link: () => <svg viewBox="0 0 24 24" width="16" height="16" {...P}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>,
  copy: () => <svg viewBox="0 0 24 24" width="16" height="16" {...P}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></svg>,
  file: () => <svg viewBox="0 0 24 24" width="16" height="16" {...P}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg>,
  search: () => <svg viewBox="0 0 24 24" width="16" height="16" {...P}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>,
  arrow: () => <svg viewBox="0 0 24 24" width="16" height="16" {...P}><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
  download: () => <svg viewBox="0 0 24 24" width="16" height="16" {...P}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>,
  push: () => <svg viewBox="0 0 24 24" width="16" height="16" {...P}><circle cx="12" cy="12" r="2" /><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8" /></svg>,
  folder: () => <svg viewBox="0 0 24 24" width="16" height="16" {...P}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>,
  plus: () => <svg viewBox="0 0 24 24" width="14" height="14" {...P}><path d="M12 5v14M5 12h14" /></svg>,
  pencil: () => <svg viewBox="0 0 24 24" width="16" height="16" {...P}><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></svg>,
  close: () => <svg viewBox="0 0 24 24" width="16" height="16" {...P}><path d="M6 6l12 12M18 6L6 18" /></svg>,
  lock: () => <svg viewBox="0 0 24 24" width="22" height="22" {...P}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>,
  camera: () => <svg viewBox="0 0 24 24" width="20" height="20" {...P}><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>,
  scissors: () => <svg viewBox="0 0 24 24" width="20" height="20" {...P}><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><path d="M8 7.5L20 18M8 16.5L20 6" /></svg>,
  speed: () => <svg viewBox="0 0 24 24" width="20" height="20" {...P}><path d="M4.5 17a8.5 8.5 0 1 1 15 0" /><path d="M12 13l4-4" /></svg>,
  swap: () => <svg viewBox="0 0 24 24" width="14" height="14" {...P}><path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4" /></svg>,
  /**
   * dsh-vidi mark: a screen with play, and two caption lines beneath (video + subtitles).
   * busy: the caption lines write themselves (work going on); live: a pulsing red dot (recording).
   */
  video: ({ size = 18, busy = false, live = false }: { size?: number; busy?: boolean; live?: boolean }) => (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      className={`dshl-mark ${busy ? 'busy' : ''}`}>
      <rect x="2.75" y="3.75" width="18.5" height="12.5" rx="3.25" />
      <path className="play" d="M10.1 7.4v5.2l4.3-2.6z" fill="currentColor" />
      <path className="c1" d="M6.5 20h6.5" />
      <path className="c2" d="M15.5 20h2" />
      {live && <circle className="rec" cx="20.6" cy="4.2" r="2.6" fill="#e5484d" stroke="var(--dsw-alias-bg-base, #fff)" strokeWidth={1.2} />}
    </svg>
  ),
}
