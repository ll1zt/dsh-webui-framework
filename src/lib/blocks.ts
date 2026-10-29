import type zh from '../../locale/zh.json'

/** The closed set of block types; adding one starts in design §15.2. */
export type BlockKind = 'sessions' | 'files' | 'session' | 'viewer'

/** What a block is, independent of where the layout puts it. */
export interface BlockSpec {
  kind: BlockKind
  titleKey: keyof typeof zh
  /** `session` blocks render inside a session and are rebuilt when it changes. */
  scope: 'root' | 'session'
  closable: boolean
  /** One instance per `contentId` (viewer: one per file) instead of one in total. */
  multiInstance: boolean
}

/** The only place block types are declared; layout and rendering read from here. */
export const BLOCK_CATALOG: Readonly<Record<BlockKind, BlockSpec>> = {
  sessions: { kind: 'sessions', titleKey: 'blocks.sessions', scope: 'root', closable: true, multiInstance: false },
  files: { kind: 'files', titleKey: 'blocks.files', scope: 'root', closable: true, multiInstance: false },
  session: { kind: 'session', titleKey: 'blocks.session', scope: 'session', closable: false, multiInstance: false },
  viewer: { kind: 'viewer', titleKey: 'blocks.viewer', scope: 'root', closable: true, multiInstance: true },
}
