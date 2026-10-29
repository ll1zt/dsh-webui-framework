/** The closed set of block types. */
export type BlockKind = 'sessions' | 'files' | 'session' | 'viewer'

/** What a block is, independent of where the layout puts it. */
export interface BlockSpec {
  kind: BlockKind
  /** `session` blocks render inside a session and are rebuilt when it changes. */
  scope: 'root' | 'session'
  closable: boolean
  /** One instance per `contentId` (viewer: one per file) instead of one in total. */
  multiInstance: boolean
}

/** The only place block types are declared; layout and rendering read from here. */
export const BLOCK_CATALOG: Readonly<Record<BlockKind, BlockSpec>> = {
  sessions: { kind: 'sessions', scope: 'root', closable: true, multiInstance: false },
  files: { kind: 'files', scope: 'root', closable: true, multiInstance: false },
  session: { kind: 'session', scope: 'session', closable: false, multiInstance: false },
  viewer: { kind: 'viewer', scope: 'root', closable: true, multiInstance: true },
}
