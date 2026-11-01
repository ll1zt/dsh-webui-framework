# @lllzt/dsh-webui-framework

一个 dsh（deepseek-harness）Web 前端插件：它接管整个页面，提供停靠布局、主题 token 和按格子隔离的错误边界，并发布一份只含类型的契约；其他插件通过这份契约注册块（block）和布局预设（preset）。

## 只装框架时是什么样

单独安装本插件，页面能正常起来，但停靠区是空的：框架本身不带任何具体的块或预设。审批、提问、权限等需要用户交互的流程也没有界面，所以**必须同时安装一个内容包**，由它注册这些块和预设。

## 安装

```sh
dsh plugin --profile <p> add <path or tarball>
```

`<path or tarball>` 是本仓库的目录或 `npm pack` 生成的 tarball。内容包用同样的方式安装。

仅靠 `dsh plugin add` 创建的 profile，`dsh.profile.bundles` 里只有 `@deepseek-ai/dsh-base`，框架不会接管页面。需要把 `bundles` 改成包含 `@deepseek-ai/dsh-web-app`，且排在本框架之前：

```json
"bundles": [
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-web-app",
  "@lllzt/dsh-webui-framework"
]
```

内容包的 bundle 接在本框架之后。

在 `0.2.2-alpha.2` 宿主上，`dsh --profile <p> --dump-config` 会打印 `patch: entry "ui-deepseek-model-label-1017" not found`。这是因为该版本的 web-app 没有这一行，属于预期现象，不影响页面。

示例插件要先构建并打包，再从 tarball 安装：

```sh
cd examples/hello-block
npx tsdown
npm pack
dsh plugin --profile <p> add ./lllzt-dsh-webui-hello-block-0.0.0.tgz
```

示例声明了 `dsh.bundle.patch`（随包发布的 `cordis.patch.yml`），所以会作为 profile 层装入并被加载。

## 契约用法

契约在子路径 `@lllzt/dsh-webui-framework/contract`，产物只有 `.d.ts`：只能 `import type`，值导入在编译期报错。在 `ctx.inject(['webuiLayout'], …)` 里等待服务就绪，再注册块和预设：

```tsx
import type { Context } from '@deepseek-ai/cordis'
import type { BlockInstanceProps } from '@lllzt/dsh-webui-framework/contract'

function Hello({ layout }: BlockInstanceProps) {
  return <button onClick={() => layout.open({ blockId: 'hello.session' })}>Open</button>
}

export function apply(ctx: Context) {
  ctx.inject(['webuiLayout'], (ctx) => {
    const { webuiLayout } = ctx
    const disposers = [
      webuiLayout.registerBlock(
        {
          id: 'hello.root',
          scope: 'root',
          priority: 100,
          title: { zh: '你好', en: 'Hello' },
          closable: true,
          multiInstance: false,
        },
        Hello,
      ),
      webuiLayout.registerPreset({
        id: 'hello.preset',
        priority: 100,
        layout: {
          version: 1,
          root: { kind: 'pane', active: 0, tabs: [{ blockId: 'hello.root', contentId: '' }] },
          activePane: [],
        },
      }),
    ]
    return () => disposers.forEach((dispose) => dispose())
  })
}
```

### 多语言文字

`LocalizedText` 是 `{ en: string, [language]: string }`：`en` 必填，其余键是任意语言标签（`zh`、`zh-TW`、`fr`……）。取某个语言的文字时按顺序回落：与当前语言写法完全相同的键，其次是主语言子标签（第一个 `-` 之前、转小写）对应的键，都没有就用 `en`。例如当前语言是 `zh-TW` 而文字只有 `zh` 和 `en`，用 `zh`；只有 `en` 时用 `en`。

### 每个标签的标题

块实例通过 `props.tab` 给自己的标签起名。`tab.setTitle({ en: 'Note 2', zh: '笔记 2' })` 让标签按钮、关闭按钮和出错卡片都用这个标题而不是块的标题；`tab.setTitle(null)` 恢复块的标题。标签不在布局里时调用无效，标签离开布局后标题随之丢弃；标题不是用户操作，也不会被保存。

### 拦下关闭

`tab.setCloseGuard(guard)` 设置本标签的关闭守卫，`guard` 是 `() => boolean`，返回 `false` 否决；`tab.setCloseGuard(null)` 移除。守卫在同步关闭标签时被问到（`close` 动作或标签的 × 按钮），以及 `resetToPreset` 将要丢掉该标签时。守卫抛错也算否决，并会记一条警告。块被注销、插件卸载或布局修复导致标签消失时不问守卫，也无法否决。

```tsx
useEffect(() => {
  if (!unsaved) return
  tab.setCloseGuard(() => false)
  return () => tab.setCloseGuard(null)
}, [tab, unsaved])
```

### 动作结果

`props.layout` 的七个动作 `open`、`close`、`activate`、`resize`、`resetToPreset`、`undo`、`redo` 都同步返回 `LayoutActionResult`：成功是 `{ ok: true }`（即使布局本来就是那样，比如打开已打开的标签），失败是 `{ ok: false, reason }`。被拒绝时布局不变，也不会通知 `onAction` 监听者。`reason` 是：

| reason          | 含义                                                         |
| --------------- | ------------------------------------------------------------ |
| `unknown-block` | 没有块以目标的 `blockId` 注册                                |
| `not-closable`  | 块以 `closable: false` 注册                                  |
| `no-such-tab`   | 块已注册，但布局里没有目标对应的标签                         |
| `not-in-split`  | 标签在布局的根窗格里，没有可调整的分栏尺寸                   |
| `vetoed`        | 标签的关闭守卫拒绝了关闭，或拒绝了会丢掉它的重置、撤销或重做 |
| `no-history`    | 没有可撤销或可重做的步骤                                     |

各动作可能的拒绝原因，按检查顺序：

- `open`：`unknown-block`。
- `close`：`unknown-block`，然后 `not-closable`，然后 `no-such-tab`，然后 `vetoed`。
- `activate`：`unknown-block`，然后 `no-such-tab`。
- `resize`：`unknown-block`，然后 `no-such-tab`，然后 `not-in-split`。
- `resetToPreset`：只会是 `vetoed`；当某个已打开、而预设里没有的标签的守卫拒绝时整个重置不生效，预设保留的标签的守卫不会被问。
- `undo` / `redo`：`no-history`，然后 `vetoed`。

### 撤销与重做

`props.layout.undo()` 回退上一步，`props.layout.redo()` 再前进一步，都同步返回 `LayoutActionResult`。

- 只回退用户的操作：五个动作（`open`、`close`、`activate`、`resize`、`resetToPreset`）、拖动分隔条调整分栏尺寸（一次指针拖动算一步），以及撤销和重做本身。标签标题和关闭守卫不在其中。
- 历史只存在当前页面里：刷新页面或读入保存的布局后清空。最多保留 100 步。
- 撤销或重做落到的布局，会按当前已注册的块修复。
- 某一步会去掉一个关闭守卫拒绝的标签时，被拒绝并返回 `vetoed`；没有步骤可走时返回 `no-history`。
- 框架不自带撤销按钮（键盘上的撤销与重做见下一节），需要按钮的块自己提供，用 `view.canUndo()` / `view.canRedo()` 决定按钮是否可点：

```tsx
function UndoButton({ layout, view }: BlockInstanceProps) {
  const canUndo = useSyncExternalStore(view.subscribe, view.canUndo)
  return (
    <button type="button" disabled={!canUndo} onClick={() => layout.undo()}>
      Undo
    </button>
  )
}
```

### 键盘命令

框架在宿主的 `shortcuts` 服务上注册七个命令，默认键位在所有平台上相同（primary 在 macOS 是 ⌘、其它系统是 Ctrl）。下表适用于桌面应用（三种平台）以及 macOS / Windows 上的浏览器；这些平台没有在本仓库的机器上验证过。Linux 上的浏览器见下面的已知限制。

| id                    | 名称         | 默认键位            |
| --------------------- | ------------ | ------------------- |
| `webui.tab.close`     | 关闭当前标签 | primary+Alt+W       |
| `webui.tab.next`      | 下一个标签   | primary+Alt+]       |
| `webui.tab.previous`  | 上一个标签   | primary+Alt+[       |
| `webui.pane.next`     | 下一个格子   | primary+Alt+.       |
| `webui.pane.previous` | 上一个格子   | primary+Alt+,       |
| `webui.layout.undo`   | 撤销布局改动 | primary+Alt+Z       |
| `webui.layout.redo`   | 重做布局改动 | primary+Alt+Shift+Z |

- 当前格子是键盘焦点所在的格子，焦点不在任何格子里时是活动格子。
- 切换标签或格子后，焦点移到新的活动标签。
- 撤销与重做只在页面区域生效，焦点在输入框或可编辑区域里时不拦截；其余五个命令在页面与可编辑区域都生效。
- 终端区域与任何模态里，七个命令都不生效。
- 不可关闭、或被关闭守卫否决的标签，按关闭键不会关。
- 命令注册在宿主的 `shortcuts` 服务上：没有这个服务就没有命令；某个命令与别的插件的默认键位冲突时只告警，不影响其它命令。用户可以在宿主那边改键。
- 本框架不提供速查与改键界面。

已知限制：在 Linux 上的浏览器里，宿主只接受 `primary+/`、`primary+Shift+,` 和 `primary+Shift+.` 三个键位，并且把 `primary+Z` 当作保留键，所以上表的七个默认键位全部被宿主拒绝：这些命令不会出现在宿主的快捷键目录里，每个命令在启动时在控制台告警一次（`[webui-framework] could not register the shortcut …`），页面和其它功能照常工作。要在那里绑定它们，需要宿主自己的改键界面，本框架不提供。

### 只读的布局视图

`props.view` 是只读的布局视图，没有写方法，改布局要走 `props.layout`：

- `view.getSnapshot()`：当前布局，布局不变时是同一个（深冻结）对象，适合 `useSyncExternalStore`；
- `view.subscribe(listener)`：布局对象每次变化后调用一次 `listener`（`canUndo` / `canRedo` 变化后也会），返回停止监听的函数；
- `view.isOpen(target)`：布局里是否有 `target` 对应的标签（单实例块忽略 `contentId`，`contentId` 默认 `''`，未注册的块一律是未打开）；
- `view.isActive(target)`：该标签是否已打开并且是所在窗格的活动标签；
- `view.canUndo()` / `view.canRedo()`：`layout.undo()` / `layout.redo()` 此刻有没有步骤可走。

完整的可构建示例在 [`examples/hello-block`](examples/hello-block)：一个 root 块（带「Undo」「Redo」按钮，按 `view.canUndo()` / `view.canRedo()` 启用）、一个多实例的笔记块（每个标签自己的标题，勾选「Unsaved changes」后否决关闭，还有一个「Note text」文本框，用来在输入框里试键盘命令）、一个 session 块、一个故意抛错的块和一个预设。示例不进发布包。

## 首版不做

- 拖拽停靠、浮动窗口
- 多会话并排
- 窄窗口下的浮层
- 设置页、快捷键的速查与改键界面
- 工具卡片、会话行菜单
- 任何具体的块或预设
