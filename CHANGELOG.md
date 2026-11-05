# Changelog

Every change to `contract/index.d.ts` needs a new version here, a matching `version` in `package.json` and a refreshed `contract/lock.json` (`node scripts/contract-lock.ts --write`).

## 0.3.0

This is an incompatible change. `BlockMeta` is now a union discriminated by `scope`, and `registerBlock`'s component type follows that scope, so a registration that compiled against 0.2.0 can fail to compile. The contract changed in the following ways.

- `BlockMeta` is now the union `RootBlockMeta | SessionBlockMeta`, discriminated by `scope`.
- `registerBlock`'s component type follows `meta.scope`: `'session'` takes `ComponentType<SessionBlockProps>` and `'root'` takes `ComponentType<BlockInstanceProps>`. Registering a root block with `ComponentType<SessionBlockProps>`, or registering a session component against a `meta` whose type is the `BlockMeta` union, now fails to compile.
- A session block no longer receives the host's standard props. From 0.3.0 it receives only `SessionBlockProps` and reads the session through `props.session`.
- Adds `WebuiSessionState`, `WebuiSession`, `SessionBlockProps`, `RootBlockMeta`, `SessionBlockMeta` and `BlockComponentOf`.

## 0.2.0

Adds undo and redo of the user's layout changes to 0.1.0. It is not fully backwards compatible: `LayoutActionRejection` gains `no-history`, so a contributor that switches exhaustively over every rejection reason (for example with a `never` check) no longer compiles until it handles `no-history`. The contract changed in the following ways.

- `LayoutActionRejection` gains `no-history`, the reason `undo` and `redo` give when there is no step to take.
- `props.layout.undo()` and `props.layout.redo()` step back and forth over the user's layout actions and return a `LayoutActionResult`; a step that would drop a tab whose close guard refuses is rejected with `vetoed`.
- `LayoutView` gains `canUndo()` and `canRedo()`.
- `LayoutView.subscribe` also calls its listener once after a change of `canUndo` or `canRedo` (once when the layout changes together with them).

## 0.1.0

Breaking change relative to 0.0.0: the contract changed in the following ways.

- `LocalizedText` accepts text in any language, not a fixed set of languages.
- `tab.setTitle` lets a block set or clear the title of its tab.
- `LayoutActionResult` is the result of every layout action (`open`, `close`, `activate`, `resize`, `resetToPreset`).
- `tab.setCloseGuard` lets a block install or remove a guard that can veto closing its tab.
- `props.view` gives every block a read-only `LayoutView` of the layout.

## 0.0.0

Initial scaffold.
