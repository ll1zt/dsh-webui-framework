# @lllzt/dsh-webui-framework

接管 dsh Web 前端的纯框架插件：独占 `root`，提供停靠布局、快捷键、主题 token 与格级错误隔离，并通过 `@lllzt/dsh-webui-framework/contract` 发布纯类型契约。

> 框架本身不带任何业务块或预设，**必须与内容包同装**，否则停靠区为空且审批、提问等交互没有界面。

## 安装

```sh
dsh plugin --profile <p> add <仓库路径或 tarball>
```

profile 的 `dsh.profile.bundles` 需包含 `@deepseek-ai/dsh-web-app` 且排在本框架之前（内容包接在本框架之后）：

```json
"bundles": [
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-web-app",
  "@lllzt/dsh-webui-framework"
]
```

- 在 `0.2.2-rc.5` 上 `--dump-config` 输出 `patch: entry "ui-deepseek-model-label-1017" not found` 属预期现象，不影响运行。
- 构建并安装示例插件：在 `examples/hello-block` 运行 `npx tsdown && npm pack`，再执行 `dsh plugin --profile <p> add ./lllzt-dsh-webui-hello-block-0.0.0.tgz`。

## 契约用法

契约入口 `@lllzt/dsh-webui-framework/contract` 仅输出 `.d.ts`（只能 `import type`，值导入会在编译期报错）。插件在 `ctx.inject(['webuiLayout'], …)` 中注册块与预设；完整类型见 [`contract/index.d.ts`](contract/index.d.ts)，完整可构建示例见 [`examples/hello-block`](examples/hello-block)。

```tsx
import type { Context } from '@deepseek-ai/cordis'
import type { BlockInstanceProps } from '@lllzt/dsh-webui-framework/contract'

function Hello({ layout }: BlockInstanceProps) {
  return <button onClick={() => layout.open({ blockId: 'hello.note', contentId: 'n1' })}>Open</button>
}

export function apply(ctx: Context) {
  ctx.inject(['webuiLayout'], ({ webuiLayout }) => {
    const offBlock = webuiLayout.registerBlock(
      {
        id: 'hello.root',
        scope: 'root',
        priority: 100,
        title: { en: 'Hello', zh: '你好' },
        closable: true,
        multiInstance: false,
      },
      Hello,
    )
    const offPreset = webuiLayout.registerPreset({
      id: 'hello.preset',
      priority: 100,
      layout: {
        version: 1,
        root: { kind: 'pane', active: 0, tabs: [{ blockId: 'hello.root', contentId: '' }] },
        activePane: [],
      },
    })
    return () => {
      offPreset()
      offBlock()
    }
  })
}
```

### 布局与标签

- **多语言文本（`LocalizedText`）**：`{ en: string, [lang]: string }`，`en` 必填，按精确语言标签 → 主语言子标签 → `en` 回落。
- **动态标题与关闭守卫**：`props.tab.setTitle(title | null)` 临时覆写标签标题（仅作用于当前打开标签）；`props.tab.setCloseGuard(() => boolean | null)` 返回 `false` 或抛错可否决关闭、`resetToPreset`、`undo`/`redo` 对该标签的移除。
- **布局动作（`props.layout`）**：`open`、`close`、`activate`、`resize`、`resetToPreset`、`undo`、`redo` 均同步返回 `LayoutActionResult`（`{ ok: true }` 或 `{ ok: false, reason }`，被拒时布局不变）。`reason` 为 `unknown-block`、`not-closable`、`no-such-tab`、`not-in-split`、`vetoed`、`no-history`。
- **分栏放置（`open(target, placement?)`）**：传入 `OpenPlacement`（`{ beside, side }`）时将参照标签所在格对半拆分并把目标放入新格（已打开则移动），`side` 可选 `left`、`right`、`top`、`bottom`。
- **撤销与重做**：`undo()` / `redo()` 仅记录用户布局动作与分隔条拖动（最多 100 步内存历史，刷新清空）；是否可回退可通过 `props.view.canUndo()` / `canRedo()` 查询。

### 快捷键与浮层

框架在宿主 `shortcuts` 服务注册 7 个命令（macOS 下 `primary` 为 ⌘，其余平台为 Ctrl）：

| 命令 id                                 | 默认键位                    | 生效范围               |
| --------------------------------------- | --------------------------- | ---------------------- |
| `webui.tab.close` / `next` / `previous` | `primary+Alt+W` / `]` / `[` | 页面与可编辑区         |
| `webui.pane.next` / `previous`          | `primary+Alt+.` / `,`       | 页面与可编辑区         |
| `webui.layout.undo` / `redo`            | `primary+Alt+Z` / `Shift+Z` | 仅页面（不含可编辑区） |

> 终端与模态框内均不生效。Linux 浏览器上宿主仅放行少数按键且保留 `primary+Z`，上述默认键位会被拒绝并在控制台告警，需由宿主改键。

- **`shell.overlay`**：在 `.webui-root` 内声明同宿主一致的 `list`/`root` 浮层槽位（点击穿透，单条目出错隔离）。
- **对话框**：请直接使用 `@deepseek-ai/dsh-client-ui-primitives` 的 `Modal`（打包时需作为宿主模块 external）。本框架与宿主 `ui-layout` 均占用 `root`，不能同时启用。

### session 块

`scope: 'session'` 的块接收 `SessionBlockProps`（在 `BlockInstanceProps` 上增加 `session`）。主会话由外部路由插件决定（无主会话时显示空态，切换时整块重挂）。

- **状态读取**：`session.sessionId` 与 `session.useState(select, equal?)` 读取 `WebuiSessionState`（`sessionId`、`running`、`blank`、`removed`、`openState`、`lastAgentError`）。
- **动作调用**：`session.send(text)`（以 `'queue'` 模式追加）与 `session.stop()` 均返回 `Promise<SessionActionResult>`（`{ ok: true }` 或 `{ ok: false, reason }`，永不 reject）；块卸载时在途请求以 `unmounted` 落定。
  - `reason` 枚举：`host-refused`（宿主拒绝或调用异常）、`no-session`（绑定会话已更换）、`unmounted`（未挂载/已卸载或触发取消信号）、`blank-text`（仅 `send`，空白文本不会发往宿主）。

### 主题 token

框架注入 `tokens.css`，将 `WebuiTokenName` 的 21 个 CSS 变量映射到宿主主题变量，插件块内使用 `var(--...)` 即可（不要硬编码颜色）：

- **背景与边框**：`--bg`、`--bg-panel`、`--bg-subtle`、`--bg-hover`、`--bg-selected`、`--border`
- **文字与强调**：`--text`、`--text-muted`、`--text-dim`、`--accent`、`--accent-hover`、`--accent-contrast`
- **字体与字号**：`--font-ui`、`--font-mono`、`--content-font-size`
- **状态色**（宿主侧警告变量叫 `warn` 而非 `warning`）：

| token                | 宿主变量                             |
| -------------------- | ------------------------------------ |
| `--state-error-fg`   | `--dsw-alias-state-error-primary`    |
| `--state-error-bg`   | `--dsw-alias-state-error-tertiary`   |
| `--state-warning-fg` | `--dsw-alias-state-warn-primary`     |
| `--state-warning-bg` | `--dsw-alias-state-warn-tertiary`    |
| `--state-success-fg` | `--dsw-alias-state-success-primary`  |
| `--state-success-bg` | `--dsw-alias-state-success-tertiary` |

### 只读的布局视图

`props.view` 提供只读布局访问，适合配合 `useSyncExternalStore`：

- `getSnapshot()` / `subscribe(listener)`：返回深冻结布局快照并在变化时通知（含 `canUndo`/`canRedo`）
- `isOpen(target)` / `isActive(target)` / `canUndo()` / `canRedo()`：查询当前打开、激活与历史状态

### 版本与兼容

`ctx.webuiLayout.contractVersion` 与包版本、`WEBUI_CONTRACT_VERSION` 一致（规则见 `src/lib/contract-version.ts` 中的 `isCompatibleContract`）：`0.x` 要求次版本（minor）相同，`1.0` 起要求主版本（major）相同，无法解析的版本视为不兼容。插件可在注册前核对版本并在不兼容时跳过注册（参考 [`examples/hello-block/src/client.tsx`](examples/hello-block/src/client.tsx)）。

## 暂不支持

拖拽停靠、浮动窗口、多会话并排、窄窗口完整浮层、快捷键速查与改键页、设置页、具体业务块或布局预设。
