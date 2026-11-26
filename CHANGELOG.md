# Changelog

Every change to `contract/index.d.ts` needs a new version here, a matching `version` in `package.json` and a refreshed `contract/lock.json` (`node scripts/contract-lock.ts --write`).

## Unreleased

- The patch now disables the host `desktop-product-telemetry` and `product-analytics` rows, which it used to keep enabled; it disables 51 rows and ships no telemetry or analytics hook of its own.

## 0.4.0

This is an incompatible change: `WebuiSession.send` and `WebuiSession.stop` return `Promise<SessionActionResult>` instead of `Promise<boolean>`, so a plugin written against the old return type fails to compile; the contract adds `SessionActionRejection` and `SessionActionResult`, and a failure maps to `blank-text` (empty text, host not called), `no-session` (the session is gone), `unmounted` (the block has no mount or has unmounted) or `host-refused` (the host returned `{ ok: false }` or threw).

- `SessionActionRejection` is `'host-refused' | 'no-session' | 'unmounted' | 'blank-text'`.
- `SessionActionResult` is `{ ok: true }` or `{ ok: false, reason }`. Neither promise rejects. A host failure is logged once and the warning does not include the text that was sent.
- The hello-block session example shows Sent or Stopped when the action is accepted, and the reason text when it is not.

## 0.3.4

This is an additive, backwards compatible change: `WebuiLayoutService` gains `contractVersion`, the framework's contract version, and the contract lock checks that it matches the package.

- `WEBUI_CONTRACT_VERSION` is that version (the same string as `package.json`). `ctx.webuiLayout.contractVersion` exposes it so a plugin can compare it with the version it compiled against before registering.
- On 0.x the same minor is compatible; from 1.0 the same major is compatible. The hello-block example warns once and skips registering blocks and presets when the contract is incompatible.
- The contract lock reports `contract-version-mismatch` when `WEBUI_CONTRACT_VERSION` differs from `package.json` or from `contract/lock.json`.

## 0.3.3

This is an additive, backwards compatible change: `BlockLayoutActions.open` gains an optional `placement` parameter, and without it opening a tab behaves as before.

- `OpenPlacement` names an already-open tab (`beside`) and a side (`left`, `right`, `top` or `bottom`). Passing it splits that tab's pane and opens the target there; a tab that is already open moves instead of being copied.
- A beside block that is not registered is rejected with `unknown-block`, and a beside tab that is not open with `no-such-tab`. The layout is left unchanged.

## 0.3.1

This is an additive, backwards compatible change that adds `--state-error-fg`, `--state-error-bg`, `--state-warning-fg`, `--state-warning-bg`, `--state-success-fg` and `--state-success-bg` to `WebuiTokenName`. Content packs can use these state colours for error, warning and success hints without picking colours, and the colours follow the host theme.

- The six tokens alias the host `--dsw-alias-state-*` ramps (error, warn and success; primary for foreground, tertiary for background) instead of fixed colours.

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
