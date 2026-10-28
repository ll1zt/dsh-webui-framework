/** Root-owned page geometry and panel state: the shell's shared store seat. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** Durable key of the sidebar width preference (design doc 03 §4.2 key prefix). */
const SIDEBAR_WIDTH_KEY = 'dsh-web-ui:sidebar-width'

/** Width the shell opens with before the sidebar is ever dragged. */
const DEFAULT_SIDEBAR_WIDTH = 260

/** Section the settings surface opens on when nothing else selected one. */
const DEFAULT_SETTINGS_SECTION = 'general'

/** Page geometry and panel state shared by the shell regions. */
export interface PageState {
  sidebarWidth: number
  filesHeight: number
  rightPanelOpen: boolean
  settingsOpen: boolean
  settingsSection: string
}

/** Handle registered as the root entry's `store` seat. Its write set is empty until a unit that moves a panel adds one. */
export type PageStoreHandle = EngineStoreHandle<PageState, Record<never, never>>

/**
 * Read the persisted sidebar width. Absent, malformed, and denied storage all
 * fall back to the default: a preference read may never keep the page from
 * rendering.
 * @returns the stored width in px, or the default.
 */
function readSidebarWidth(): number {
  try {
    // Denied storage throws on the property access itself, not only on getItem.
    const raw = globalThis.localStorage.getItem(SIDEBAR_WIDTH_KEY)
    if (raw === null || raw.trim() === '') return DEFAULT_SIDEBAR_WIDTH
    const width = Number(raw)
    return Number.isFinite(width) ? width : DEFAULT_SIDEBAR_WIDTH
  } catch {
    return DEFAULT_SIDEBAR_WIDTH
  }
}

/**
 * Declare the page store handle. `init` runs per instance, so every fresh
 * instance seeds from the preference as it stands.
 * @returns the store handle.
 */
export function createPageStore(): PageStoreHandle {
  return defineStore({
    init: (): PageState => ({
      sidebarWidth: readSidebarWidth(),
      filesHeight: 240,
      rightPanelOpen: false,
      settingsOpen: false,
      settingsSection: DEFAULT_SETTINGS_SECTION,
    }),
    actions: {},
  })
}
