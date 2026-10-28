/**
 * The only place localStorage keys are named (PRINCIPLES §1.4). Every key carries
 * the prefix so this app's entries never collide with other apps on the same origin.
 * A unit that needs a new key adds it here; existing values must never change,
 * because users already have data stored under them.
 */
export const STORAGE_PREFIX = 'dsh-web-ui:'

export const STORAGE_KEYS = {
  sidebarWidth: 'dsh-web-ui:sidebar-width',
} as const

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS]
