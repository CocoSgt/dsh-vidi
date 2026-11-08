import type { ReactNode } from 'react'

/** What an extension sees of the open video. */
export interface VidiView {
  /** The video job (status, title, folder, subtitle state…), as the page has it. */
  job: Record<string, any>
  /** Subtitle lines so far. */
  cues: { id: number; start: number; end: number; src: string; tr?: Record<string, string>; final: boolean; speaker?: string }[]
  /** The conversation the page belongs to. */
  sessionId: string
  /** Current playback time (seconds on the job's timeline). */
  now: number
  /** Jump the player to a time. */
  seek(t: number): void
  /** The subtitle style on screen (for clips that look the same). */
  style: unknown
  /** The subtitle lines shown, in order ('src' = original). */
  lines: string[]
  /** The page's language. */
  ui: 'zh' | 'en'
  /** The workbench on screen (video page only), or null. */
  bench: string | null
  /** Video page: show a workbench in place of the chat (the video moves to the left column), or close it. */
  openBench(id: string | null): void
}

/** A tab beside Subtitles / Glossary under the player. */
export interface VidiPanel { id: string; order?: number; label(ui: 'zh' | 'en'): string; render(view: VidiView): ReactNode }
/** A menu in the player's control bar. */
export interface VidiPlayerMenu { id: string; order?: number; icon: ReactNode; title(ui: 'zh' | 'en'): string; render(view: VidiView, close: () => void): ReactNode }

/**
 * A workbench: a large working area on the video page. While open it takes
 * the chat's place and most of the width; the video keeps playing at the top
 * left with the subtitles under it.
 */
export interface VidiBench { id: string; order?: number; render(view: VidiView): ReactNode }

type Listener = () => void

function registry<T extends { id: string; order?: number }>() {
  let items: T[] = []
  const listeners = new Set<Listener>()
  const emit = () => { for (const l of listeners) l() }
  return {
    get: () => items,
    subscribe(l: Listener) { listeners.add(l); return () => { listeners.delete(l) } },
    /** Add one; returns the function that removes it. */
    add(item: T) {
      items = [...items.filter(x => x.id !== item.id), item].sort((a, b) => (a.order ?? 50) - (b.order ?? 50))
      emit()
      return () => { items = items.filter(x => x !== item); emit() }
    },
  }
}

/**
 * Extension points of the video page, for companion plugins (inject
 * 'vidiUi'): extra tabs under the player and extra player menus. The page
 * itself stays in this package; companions only add.
 */
export const vidiUi = {
  version: 2 as const,
  panels: registry<VidiPanel>(),
  playerMenus: registry<VidiPlayerMenu>(),
  benches: registry<VidiBench>(),
}
export type VidiUi = typeof vidiUi
