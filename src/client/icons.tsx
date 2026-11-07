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
}
