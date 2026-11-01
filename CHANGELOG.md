# Changelog

Every change to `contract/index.d.ts` needs a new version here, a matching `version` in `package.json` and a refreshed `contract/lock.json` (`node scripts/contract-lock.ts --write`).

## 0.1.0

Breaking change relative to 0.0.0: the contract changed in the following ways.

- `LocalizedText` accepts text in any language, not a fixed set of languages.
- `tab.setTitle` lets a block set or clear the title of its tab.
- `LayoutActionResult` is the result of every layout action (`open`, `close`, `activate`, `resize`, `resetToPreset`).
- `tab.setCloseGuard` lets a block install or remove a guard that can veto closing its tab.
- `props.view` gives every block a read-only `LayoutView` of the layout.

## 0.0.0

Initial scaffold.
