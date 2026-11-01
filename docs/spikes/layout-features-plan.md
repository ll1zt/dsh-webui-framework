# 调研：参照 dsh 自己的插件做法，规划七项布局与外壳功能

本文是 Task_8_1 的交付物，只回答问题、不改产品代码。宿主版本是 `0.2.2-alpha.2`。引用 dsh 源码一律写成 `ref/deepseek-harness/<路径>:<行号>`，本仓库自己的文件写成相对仓库根的路径。

**证据的强度。** 本文没有在真实宿主上验证任何一条。凡是写“读源码得知”的，都只是读了 dsh 的代码；凡是写“推断”的，是从读到的机制推出来的，没有跑过。Task_6_1 已经在真实宿主上验证过的一件事（框架独占 `root` 时 `shell.overlay` 不渲染）会直接引用，不再重做。

## 范围与读法

### dsh 自己是怎么做这些功能的

七项里，dsh 自己做过的、能直接对照的有四项：

| 功能 | dsh 里的做法 | 形态 |
| --- | --- | --- |
| 拖拽、浮出、撤销重做 | `ui-dockkit` 提供引擎和组件，`ui-sidebar-right` 在它上面按会话各开一个停靠面 | 引擎是库，使用方是普通插件 |
| 窄窗口 | `ui-layout` 的 `AppFrame` 按视口宽度算列、折叠侧栏，`ui-sidebar-right` 在窄窗口改成全屏 | 外壳（root）自己的行为 |
| 设置 | `ui-settings` 只给底座（`configForms`、槽位类型），外壳是 `ui-settings-general`，每个页面是另一个插件往 `settings.section` 里注册 | 一个外壳插件加很多页面插件 |
| 快捷键 | `shortcuts` 是服务，`ui-shortcuts` 是速查与编辑界面，各功能插件自己 `ctx.shortcuts.register` 命令 | 服务加界面加各处注册 |

多会话并排 dsh 没有当成一个功能做，但 `ui-sidebar-right` 的“每个会话一个视图”已经包含了关键机制（见 `## 多会话并排`）。

这套分工的共同点是：**引擎和服务是底座，界面是另一个插件，各功能往槽位里注册内容**。本框架的约束是同一个方向（D47：本仓库只实现框架，具体界面由别的包做），所以判断归属的规则是：

- 改布局树、或必须画在停靠区里面的，是**框架核心**；
- 往框架已有的槽位或宿主服务里注册内容的，是**基于契约的独立插件**；
- 框架核心里放的东西，契约只增加“别人需要读或调用的最小部分”。

### 已定的前提

下面这些不在本文重新设计，只引用：

- Task_5 第 1 轮的契约工作：每标签标题、任意语言文案（这两项已合并，`contract/index.d.ts:42` 起）；动作结果 `LayoutActionResult`、关闭否决 `setCloseGuard`、只读 `LayoutView`（带 `subscribe`）、契约版本锁定 `0.1.0`（尚未合并，本文称“待合并的 `LayoutView`”）。
- Task_6_1 的结论（`docs/spikes/session-and-overlay.md`，在分支 `unit/Task_6_1` 上）：框架独占 `root` 时 `shell.overlay` 不渲染，建议框架在 `root` 的 `children` 里声明它，对话框用 `ui-primitives` 的 `Modal`；会话对象走契约自己的 `SessionBlockProps`。
- 本仓库现有部分：布局树是 `split / pane / tabs`，`version: 1`（`src/lib/layout.ts`、`contract/index.d.ts:65-90`）；`LayoutController` 里所有用户动作经 `#update` 通知 `onAction`（`src/client/services/layout-controller.ts:193-202`），`LayoutPersistence` 只订 `onAction` 写 profile（`src/client/services/layout-persistence.ts:41-44`）；profile 里布局的 schema 是 `Schema.any().volatile()`（`src/index.ts:6`），所以树上新增可选字段不需要改 Node 半。

## 结论一览

| 功能 | 归属 | 参照的 dsh 包 | 契约新增（摘要） | 建议次序 |
| --- | --- | --- | --- | --- |
| 撤销重做 | 框架核心 | `ui-dockkit` 的 `Sequencer`、`ui-sidebar-right` 的 store | `BlockLayoutActions.undo/redo`，只读视图里 `canUndo/canRedo` | 1 |
| 快捷键 | 核心注册布局命令 + 现成 `shortcuts` 服务 + 速查界面用现成 `ui-shortcuts` | `shortcuts`、`ui-shortcuts`、`ui-sidebar-right/shortcuts.ts` | DOM 标记与 `tabAt(element)`，命令 id 清单 | 2 |
| 设置 | 独立插件（单独的包） | `ui-settings`、`ui-settings-general`、`ui-settings-models` | 无（依赖 `shell.overlay`，见 Task_6） | 3 |
| 窄窗口覆盖层 | 框架核心 | `ui-layout` 的 `AppFrame`、`columns.ts`，`ui-sidebar-right` 的全屏规则 | 可选：`presentation` 属性 | 4 |
| 拖拽停靠 | 框架核心 | `ui-dockkit` 的 planner 与交互规则（只借逻辑，不用组件） | 无树变化；可选 `BlockLayoutActions.move` | 5 |
| 浮出面板 | 框架核心 | `ui-dockkit` 的 `FloatLayer`、`geometry.ts` | `WebuiLayout.floats?`（加性字段） | 6 |
| 多会话并排 | 核心提供绑定机制，选哪个会话由独立插件决定 | `ui-sidebar-right` 的 `session-views`、`RightbarRoot` | `BlockMeta` 的会话绑定方式 | 7 |

## 拖拽停靠

### 归属

**框架核心。** 拖放的结果是改布局树（移动标签、在格边缘分栏），渲染在 `DockView` 里面，这两件事都不是插件够得着的：块组件拿不到树，契约也不该让它们拿到（K14）。

### 参照的 dsh 做法

`ui-dockkit` 把手势和决策分开，这是值得照搬的结构（读源码得知）：

- 组件只上报“已落定的意图”，每次手势一条，拖动过程的预览留在手势自己的状态里。`DockIntents` 里与拖放有关的是 `placeTab`（落在标签条的某个槽位：重排、移动或归还）和 `dropTab`（落在格正文：中间是并入，边缘是分栏）（`ref/deepseek-harness/packages/client/ui-dockkit/src/contract/adapter.ts:78-109`）。
- 意图怎么变成操作，写在无 React 的 planner 里：`planPlaceTab`（`ref/deepseek-harness/packages/client/ui-dockkit/src/engine/planner.ts:237`）、`planDropTab`（`planner.ts:270`）、`planSplitPane`（`planner.ts:139`）。嵌入方可以把它们接到自己的 store（`ref/deepseek-harness/packages/client/ui-dockkit/README.zh.md:40`）。
- 命中判定在 `DockSurface` 的 `hitTest`：先看是不是在标签条里（算插入槽位，位置不变就不给落点），再看正文落区（`ref/deepseek-harness/packages/client/ui-dockkit/src/components/DockSurface.tsx:117-140`）；落区几何是纯函数 `zoneAt`、`zoneInRect`、`insertionIndex`（`ref/deepseek-harness/packages/client/ui-dockkit/src/engine/constraints.ts:52`，`ref/deepseek-harness/packages/client/ui-dockkit/src/engine/geometry.ts:44,55`）。
- 交互规则里值得保留的：手势开始时捕获指针（`ref/deepseek-harness/packages/client/ui-dockkit/src/components/pointer.ts:24-25`）；焦点落在 click 而不是 pointerdown；分栏要给两个半格留足空间（`halvesFit`，`geometry.ts:127`）；总格数有预算（`MAX_DOCK_PANES = 4`，`constraints.ts:10`）。这些在 `ref/deepseek-harness/packages/client/ui-dockkit/README.zh.md:72-78` 一带写成了“值得保留的交互规则”。

**不照搬的部分。** 本仓库在 D40 已经定了：不用 dockkit 的 React 组件，只借它的逻辑和规则，外观和无障碍自己做。理由现在更充分：

- dockkit 自己声明导出“在任何版本都可能变化”，并说明发布它只是因为侧栏静态链接（`ref/deepseek-harness/packages/client/ui-dockkit/README.zh.md:14`）。
- 它的树是按 id 归一化的（`ref/deepseek-harness/packages/client/ui-dockkit/src/contract/types.ts:105-118`），我们的树是嵌套的、按路径寻址的，存进 profile 的是契约格式（`src/lib/layout.ts` 开头的注释）。两者之间要一个适配层，不如把 planner 的规则用我们的树重写成纯函数。
- 它自己承认没有键盘路径去分栏、移动或浮出（`ref/deepseek-harness/packages/client/ui-dockkit/README.zh.md:106`），而 `docs/PRINCIPLES.local.md` 要求键盘路径要自己做。
- `ui-sidebar-right` 的持久化把根分栏限制成“两个孩子、沿 row”（`ref/deepseek-harness/packages/client/ui-sidebar-right/src/client/persistence.ts` 的 `validateReferences`，读源码得知），它的使用场景比我们窄，不能当作我们树形的参照。

### 与框架现有部分的关系

- **布局树**：不变。拖放只产生现有树能表达的结果。需要在 `src/lib/layout-ops.ts` 里新增纯函数：`moveTab(layout, ref, toPath, index)` 和 `splitWith(layout, ref, panePath, zone)`，都复用 `replaceAt`、`resolveLayout`（拖空的格由 `resolveLayout` 的拍平规则合并，`src/lib/layout.ts:160-161`）。
- **LayoutController**：新增 `DockActions.moveTab`、`DockActions.splitDrop`，走现有 `#update`，所以每次落定恰好通知一次 `onAction`。拖动过程的预览不进控制器，和 `beginResize/endResize` 的做法一致（那个是因为拖分隔条要实时改尺寸；拖标签不需要，预览留在组件里即可）。
- **onAction 与 profile 持久化**：落定即通知，`LayoutPersistence` 不用改。
- **一个必须在实现前验证的风险**：现在 `DockView` 的每个标签面板挂在所属格的子树下，标签换格后 React 会卸载再挂载，块的内部状态会丢，session 块还会触发一次重挂。dockkit 为此给每个标签保留稳定的 DOM 容器（`ref/deepseek-harness/packages/client/ui-dockkit/README.zh.md:65`，读源码得知）。我们需要决定：接受换格重挂（并写进契约说明），或把面板挂到稳定容器再定位。这是拖拽停靠 story 的第一个设计点。

### 契约需求

- 树形不变，不需要新字段。
- 可选：`BlockLayoutActions.move(target, destination)`，让块（例如一个“布局整理”块）也能移动标签。第一版可以不做，只给用户手势和键盘命令用。
- 拖动手势的键盘等价路径（把标签移到相邻格）要作为命令注册（见 `## 快捷键`），不放进契约。

## 浮出面板

### 归属

**框架核心。** 浮出的标签要进布局树（否则刷新后位置丢失、撤销也管不到），而且要画在视口坐标里，这是 `DockView` 外面的一层。

### 参照的 dsh 做法

- 浮窗在 dockkit 里不是第二个概念：它就是 `host` 为 `'float'` 的格，容量一个标签，不画标签条（`ref/deepseek-harness/packages/client/ui-dockkit/src/contract/types.ts:69,72-81`；`ref/deepseek-harness/packages/client/ui-dockkit/README.zh.md:33`）。
- 浮出就是把拖动松手在停靠区之外，`floatTab(tabId, rect?)` 上报，`unfloatPane` 归还（`adapter.ts:91-94`；`README.zh.md:40`）。操作是 `float`、`unfloat`、`moveFloat`、`resizeFloat`（`types.ts:164-171`）。
- `FloatLayer` 自己处理手势，用视口坐标定位，所以可以挂在任何位置、包括 portal（`ref/deepseek-harness/packages/client/ui-dockkit/src/components/FloatLayer.tsx:351-388`；`README.zh.md:67`）。
- 视口约束是纯函数：`legalFloatRect` 把矩形钳进视口（`ref/deepseek-harness/packages/client/ui-dockkit/src/engine/geometry.ts:235`），`resistedRect` 在越界时给阻力（`geometry.ts:258`，`FLOAT_RESISTANCE = 120`，`geometry.ts:220`）。窗口缩小时浮窗被推入且不记录操作，窗口变大时回移，存储的矩形不变（`README.zh.md:69`）。`prefers-reduced-motion` 时不播弹簧（`FloatLayer.tsx:91`）。
- 最小尺寸和默认尺寸：`FLOAT_MIN_SIZE`、`FLOAT_DEFAULT_SIZE`（`ref/deepseek-harness/packages/client/ui-dockkit/src/engine/constraints.ts:16,19`）。

### 与框架现有部分的关系

- **布局树**：需要放浮窗的地方。建议在 `WebuiLayout` 上加一个**可选**的 `floats?: readonly FloatPane[]`，`FloatPane = { tab: BlockRef; rect: { x; y; width; height } }`，不动 `root` 和 `version: 1`：旧布局没有这个字段就是“没有浮窗”，所以不需要版本迁移；profile 的 schema 是 `any`，不用改（`src/index.ts:6`）。要改的是 `resolveLayout`——它现在重建 `{ version, root, activePane }`，会丢掉未知字段（`src/lib/layout.ts:220`），必须让它修复并保留 `floats`（去掉未注册的块、去重、和 `root` 里的标签互斥）。
- **LayoutController**：`open` 的落点规则不变；新增 `floatTab/unfloat/moveFloat/resizeFloat`。拖动浮窗和拖分隔条一样是手势，沿用 `beginResize/endResize` 的“手势只通知一次”机制（或泛化它）。
- **onAction / 持久化**：同上，落定即写。矩形存的是视口像素；显示时投影进当前视口，不回写。
- **渲染位置**：浮窗层放在 `.webui-root` 内、低于 `shell.overlay` 的层（Task_6 建议的 `shell.overlay` 层 z-index 为 20，参照 `ref/deepseek-harness/packages/client/ui-layout/src/client/AppFrame.module.css:281-291`）。session 块浮出时仍要经 `wrapSession` 包进会话区（`src/ui/shell/DockView.tsx:123`）。
- **与窄窗口的关系**：窄窗口下浮窗仍受视口钳制；是否在窄窗口把浮窗改成覆盖层，留到窄窗口那一项再定。

### 契约需求

- `WebuiLayout.floats?`、`FloatPane`、`FloatRect`（类型，加性）。这会让 `LayoutPreset` 也能带初始浮窗，属于顺带获得的能力，要在 story 里明确是否开放。
- 块不需要新动作。若要让块自己浮出，可以后续加 `BlockLayoutActions.float(target)`，不是首版必须。
- 键盘路径（把当前标签浮出、归还）作为命令注册，不进契约。

## 撤销重做

### 归属

**框架核心。** 历史必须挂在控制器的“用户动作”这一个入口上（`#update`），并且撤销本身要像一次用户动作那样通知 `onAction`、写 profile。插件如果只拿到只读的 `LayoutView`，要实现撤销就得有一个“把整棵树替换掉”的写入口，这会绕开契约里只暴露五个动作的设计（K14），不值得。

### 参照的 dsh 做法

- 引擎是线性历史：每个意图一条记录，一条记录里是它的操作和执行时捕获的逆操作；后退后产生新记录会丢弃前进分支；连续的纯焦点记录合并成一步（`ref/deepseek-harness/packages/client/ui-dockkit/src/engine/sequence.ts:1-15,21-35`）。纯函数形态是 `record`、`stepBack`、`stepForward`（`sequence.ts:98,123,142`），还有可变包装 `Sequencer`（`sequence.ts:156`）；`DockController` 的快照带 `canUndo/canRedo`（`ref/deepseek-harness/packages/client/ui-dockkit/src/engine/controller.ts:31-41`）。
- `ui-sidebar-right` 把历史放在每个会话的 `SurfaceState` 里，`undo/redo` 是 store 的两个 action，各是 `stepped(surface, stepBack|stepForward)`（`ref/deepseek-harness/packages/client/ui-sidebar-right/src/client/stores.ts:253,419-424`）。
- **历史不持久化**：读取时给空历史，写入时只写布局（`ref/deepseek-harness/packages/client/ui-sidebar-right/src/client/persistence.ts:1,59,74,86`）。
- **dsh 自己没有给撤销做界面**：服务上的 `_undo/_redo` 标着 `@internal`，注释写“架构上的事实，暂时没有面向用户的控件”（`ref/deepseek-harness/packages/client/ui-sidebar-right/src/client/service.ts:688-706`）；dockkit 的 README 也说套件不自带撤销/重做控件，由嵌入方决定（`ref/deepseek-harness/packages/client/ui-dockkit/README.zh.md:67`）。

### 与框架现有部分的关系

dockkit 要记逆操作，是因为它的操作是增量的、带 id 的。我们的布局是不可变值，`#update` 每次产出一个新树，所以**历史可以直接存快照**：`past: WebuiLayout[]`、`future: WebuiLayout[]`，不需要逆操作，也不需要 `replay`。树之间共享结构，开销很小。

- **LayoutController**：
  - 记录点只有一个：`#update` 在 `next !== layout` 且要通知 `onAction` 的那一刻，把旧树压入 `past`、清空 `future`。这正好等于“用户动作”的定义，所以 `setTabTitle`、`settle`、注册表变化引起的跟随和修复、`replaceLayout`（读 profile）都不入历史。
  - 手势合并：`resizeSplit` 在 `beginResize` 之后是“不通知”的（`layout-controller.ts:193-202`），把“压栈”放在通知的同一处，一次分隔条拖动自然只产生一步，不用另写规则。
  - `undo()/redo()` 从栈上取出快照，经 `resolveLayout` 修复（取出之后块可能已注销）后发布，并通知 `onAction`，于是 `LayoutPersistence` 把撤销后的树写进 profile，不需要改持久化。
  - `replaceLayout`（读 profile 完成）视为新基线，清空历史；上限设一个常数（建议 100 步）。
  - 现有 `#following`（未动过布局时跟随预设）在第一次用户动作后即为 false；撤销回到起点不恢复跟随。这是有意选择，要写进 story。
- **onAction / 持久化**：撤销重做是用户动作，会被写盘；历史本身不写盘（照 dsh）。
- **与拖拽、浮出的关系**：它们都经 `#update`，所以做在它们前面时它们自动可撤销；反过来则需要回头改。这是把撤销排第一的主要理由。

### 契约需求

- `BlockLayoutActions` 增加 `undo(): void`、`redo(): void`——给将来的工具栏块用；dsh 自己没有 UI，所以这是我们的扩展，不是照搬。
- 能否撤销是读的信息：放进待合并的 `LayoutView` 快照（`canUndo`、`canRedo`），块用 `subscribe` 订阅，不另开通道。若 `LayoutView` 还没合并，则这个 story 同时承担把这两个字段加进去的责任（见 `## 第一项的 story 草案` 的依赖说明）。
- 动作结果：待合并的 `LayoutActionResult` 里要有“没有可撤销的”这一种结果，`undo` 不抛错。

## 多会话并排

### 归属

**机制在框架核心，选择在独立插件。** 并排显示多个会话需要同一页面里每个 session 块绑到不同的会话，绑定发生在 `App` 里的 `SessionProvider`，这是框架的位置（`src/client/entries/App.tsx:67-71`）。但“哪个格显示哪个会话”是会话列表、路由那一类内容包的事，K5 已经定了框架不拥有路由。

### 参照的 dsh 做法

`ui-sidebar-right` 就是“每个会话一个独立视图”（读源码得知）：

- 根座位 `RightbarRoot` 对每个视图渲染一个 `SessionProvider session={view.reference}`，其中 `reference` 是显式的会话目标，不是“当前主会话”（`ref/deepseek-harness/packages/client/ui-sidebar-right/src/client/shell/RightbarRoot.tsx:17-27`）。`SessionProvider` 的 `session` 属性允许显式传目标，省略则继承外面的绑定（`ref/deepseek-harness/packages/client/ui-slots/src/index.ts:348-358`）。
- 视图的会话引用由 `ctx.sessions.retain(sessionId, { source })` 取得，`reference.ready` 等初次打开，`release()` 释放（`ref/deepseek-harness/packages/client/ui-sidebar-right/src/client/session-view.ts:33-34,89`；类型在 `ref/deepseek-harness/packages/api/session-controller/src/client/contract/sessions.ts:25-37,58`）。
- 保留策略：前台会话和仍有已初始化标签的后台会话都保留视图，其余退役；退役要等已提交的挂载全部卸载后才释放引用（`ref/deepseek-harness/packages/client/ui-sidebar-right/src/client/session-views.ts:31-43,67-73`；`session-view.ts:46-52,77-90`）。这个“引用计数 + 延迟释放”是必须照搬的，否则卸载与释放的次序会出错。
- 根里按会话 id 排序渲染、用 `hidden` 隐藏非前台的（`RightbarRoot.tsx:34-37`）。
- 注入列表里有 `sessions` 服务（`ref/deepseek-harness/packages/client/ui-sidebar-right/src/client/index.ts:85`）。

### 与框架现有部分的关系

- **布局树**：不变。标签本来就是 `(blockId, contentId)`，对“按会话绑定”的块，`contentId` 就是会话 id，块要 `multiInstance: true`。
- **K4 要修订**：现在“所有 session 作用域块绑当前主会话，共用同一个绑定”（`docs/08-shell-core.local.md` K4）。改成：块的元数据说明它是绑主会话，还是绑 `contentId` 指的会话。默认仍是主会话，已有块不受影响。
- **App / DockView**：`wrapSession` 现在对所有 session 块一视同仁（`src/ui/shell/DockView.tsx:123`）；改成按块决定：绑主会话的照旧；绑 `contentId` 的，由框架持有一张“会话 id → 引用”的表（引用计数，照 `SidebarSessionViews`），用 `<SessionProvider session={reference}>` 包住。
- **与 Task_6 的关系**：Task_6 第 2 轮的 `SessionBlockProps` 是在 `registerBlock` 里包一层适配，从宿主 props 读会话再构造 `session` 对象（`docs/spikes/session-and-overlay.md` 的“会话对象”一节）。适配读的是“最近的 `SessionProvider` 绑定”，所以显式绑定的块也能用同一个适配，块的写法不变。这一项必须在 Task_6 第 2 轮之后做，否则要做两遍适配。
- **LayoutController / onAction / 持久化**：打开一个会话并排就是 `layout.open({ blockId, contentId: sessionId })`，现有动作够用；保存下来的 `contentId` 就是会话 id，刷新后恢复。会话已不存在时 `reference.ready` 会 reject（`session-view.ts:34` 只记日志），框架要给这个格一个“会话不可用”的空态，而不是整格报错。

### 契约需求

- `BlockMeta` 增加会话绑定方式，例如 `session?: 'main' | 'content'`（默认 `'main'`），只对 `scope: 'session'` 有意义。若 Task_6 按建议把 `scope` 改成可判别联合，这个字段只出现在 `session` 那一支上。
- 不需要让块拿到 `ctx.sessions`：会话对象走 Task_6 的 `SessionBlockProps`。
- 本项未验证：显式 `session` 的 `SessionProvider` 嵌在我们自己占据的 `root` 里是否与 `ui-sidebar-right` 同样工作。它是在 `rightbar.session` 槽位里用的，而我们是在 `root` 的子槽位里，推断两者机制相同，需要在真实宿主上验证。

## 窄窗口覆盖层

### 归属

**框架核心。** 这是停靠区自己的呈现规则：同一棵布局树，在窄视口下换一种画法。它不改树、不进 profile、不通知 `onAction`。

### 参照的 dsh 做法

- 视口宽度的来源是外壳自己的盒子，不是 `window`：`AppFrame` 用一个 `ResizeObserver`，经 `requestAnimationFrame` 节流，读 `getBoundingClientRect().width`（`ref/deepseek-harness/packages/client/ui-layout/src/client/AppFrame.tsx:131-153`）。
- 断点是常量：`SIDEBAR_AUTO_COLLAPSE = 1024`，窄于它时侧栏自动收成窄条，手动展开是一个“覆盖”标志 `narrowExpanded`，**跨过断点就清掉这个标志**，宽的状态是偏好、窄的默认是收起（`ref/deepseek-harness/packages/client/ui-layout/src/client/columns.ts:23`；`ref/deepseek-harness/packages/client/ui-layout/src/client/stores.ts:110,116-121`）。
- 列的优先级：右列先缩、再丢掉轨道，才允许中间列低于最小值（`CENTER_MIN = 400`，`computeColumns`，`columns.ts:55-58`）。
- 右栏在更窄时（`< 768`）自动全屏，并且把自己的“展开”状态收起（`ref/deepseek-harness/packages/client/ui-sidebar-right/src/client/shell/SidebarRight.tsx:375-376`；`ref/deepseek-harness/packages/client/ui-sidebar-right/src/client/service.ts:637-639`）。
- 覆盖层本身：绝对定位铺满、`z-index: 20`、点击穿透，子项恢复指针事件（`AppFrame.module.css:281-291`）——这是 `shell.overlay` 的层，**不是**窄窗口覆盖的那层，别混用。

### 与框架现有部分的关系

D43（`docs/archive/readme-decisions.local.md`，已定）：视口窄于 960px 时，布局树最右侧的非必需格以带背板的覆盖层显示。照 dsh 的做法落到本仓库：

- **“非必需”**：不含 `closable: false` 的块的格（K7：必需块由块自己声明）。没有这样的格就不折叠，不另增契约。
- **LayoutController / 布局树**：不变。折叠是 `DockView` 的呈现：宽度由 `.webui-root` 自己的 `ResizeObserver` 提供；“覆盖层是否展开”是控制器里**不入历史、不通知 `onAction`、不写盘**的一个小状态，跨过断点即清除（照 `narrowExpanded`）。
- **激活**：`activate/open` 指向被折叠格里的标签时应当展开覆盖层，否则 `layout.open` 在窄窗口里“没反应”。这一点要有测试。
- **渲染**：覆盖层是停靠区内部的层，用 `role="dialog"` 但**不要** `aria-modal="true"`：宿主的快捷键服务把 `[role="dialog"][aria-modal="true"]` 和 `[role="menu"]` 都当模态，会挡掉应用命令（`ref/deepseek-harness/packages/client/ui-primitives/src/useModalLayer.ts:8`；`ref/deepseek-harness/packages/client/shortcuts/src/client/dom.ts:41-47,74-76`，读源码得知）。覆盖层需要 Esc 关闭和焦点回到触发处，这些在 `ui-primitives` 的 `useModalLayer` 里有现成实现，但它假设自己是模态；是复用还是自写，是这一项的设计点。
- **与拖拽、浮出的关系**：折叠格不接受拖放的落点；浮窗仍钳进视口（见浮出一节）。

### 契约需求

- 首版可以没有。可选：`BlockInstanceProps.presentation: 'docked' | 'overlay'`，让块知道自己被放在覆盖层里（例如隐藏自己的标题栏）。这是个只读属性，加性，不必在第一轮做。
- 断点 960 是框架的常量，不进契约。

## 设置

### 归属

**独立插件（单独的包）。** 理由是 dsh 的整个设置体系就是这样分的：`ui-settings` 只提供底座，外壳和每个页面各是一个插件。D47 也要求具体界面不放进本仓库。

### 参照的 dsh 做法

- **底座** `ui-settings`：提供 `configForms`（读写 profile 的表单）和 schema 服务，**自己不渲染任何界面**（`ref/deepseek-harness/packages/client/ui-settings/README.zh.md:12`）；声明全部设置槽位的类型（`ref/deepseek-harness/packages/client/ui-settings/src/client/contract/slots.ts:14-93`）：`settings.section`（一页一个条目，`id/order/label` 决定导航）、`settings.general.item`（通用页里的一行）、`settings.header`、`settings.action`、`settings.close`、`settings.onboarding` 等。本仓库已经在用它：`cordis.patch.yml` 关了各分页但注明“`ui-settings` 本身保留：它提供 configForms”，布局持久化走的就是 `configForms`。
- **外壳** `ui-settings-general`：用 `slots.inject('sidebar.settings', …)` 在槽位被声明后注册自己，条目的 `children` 里**声明**上面那一批槽位（`ref/deepseek-harness/packages/client/ui-settings-general/src/client/index.ts:192-231`）；同时 `ctx.shortcuts.register` 一个 `settings.open` 命令（`index.ts:196-213`，`modals: ['settings']`）。界面是 `createPortal` 到 `body` 的模态：`role="dialog" aria-modal="true" data-shortcut-modal="settings"`，焦点和 Esc 用 `useModalLayer`（`ref/deepseek-harness/packages/client/ui-settings-general/src/client/SettingsRoot.tsx:64-73`）。
- **页面**：每个页面插件往 `settings.section` 注册一条（`id`、`order`、`label`、自己的 `inject`），如模型页（`ref/deepseek-harness/packages/client/ui-settings-models/src/client/index.ts:136-145`）。
- **行**：通用页的一行由拥有这个偏好的插件贡献，**不是**设置外壳：语言行（`ref/deepseek-harness/packages/client/locale/src/client/index.ts:622-629`）、外观与字号行（`ref/deepseek-harness/packages/client/ui-theme/src/client/index.ts:621-638`）、快捷键入口行（`ref/deepseek-harness/packages/client/ui-shortcuts/src/client/index.ts:42-45`）。

### 与框架现有部分的关系

关键的一点：**外壳的挂载点 `sidebar.settings` 是 `ui-sidebar` 声明并渲染的**（`ref/deepseek-harness/packages/client/ui-sidebar/src/client/index.ts:91`，`ref/deepseek-harness/packages/client/ui-sidebar/src/client/SidebarRoot.tsx:410`），而 `ui-sidebar` 和 `ui-settings-general` 都在我们的 47 行关闭清单里。所以今天 `settings.section`、`settings.general.item` 没有人声明，语言、外观、字号这些现成的行和所有设置页都**静默失效**（`slots.inject` 回调不会触发，原理同 Task_6 对 `shell.overlay` 的验证）——这正是 `docs/08-shell-core.local.md` 里“D22 落空”的后果。

设置插件要做的是顶替 `ui-settings-general` 的外壳角色，但挂在别处：

1. 依赖框架声明 `shell.overlay`（Task_6 第 2 轮）；
2. 设置插件用 `slots.inject('shell.overlay', …)` 注册一个条目，`children` 声明 `settings.section`（和需要的 `settings.general.item`），自己画 `Modal`（`ui-primitives`，`shortcutModal="settings"`）和导航——这就是 `ui-shortcuts` 的做法（`ref/deepseek-harness/packages/client/ui-shortcuts/src/client/index.ts:46-71`）；
3. 注册 `settings.open` 命令，沿用 `ui-settings-general` 的键位约定（桌面 `primary+Comma`，Web 用 `primary+alt+Comma`，`index.ts:197-203`）；
4. 一旦声明了这些槽位，**语言、外观、字号的行立刻出现**，不需要任何额外代码（读源码得知）；`cordis.patch.yml` 里被关的各页面插件（`ui-settings-models` 等）如果需要，可以逐个从清单里拿掉重新启用。是否能无改动启用，要看它们的注入列表，本文没有逐个核对。

**与框架核心的关系**：框架核心基本不碰设置。唯一的接口是“怎么打开设置”：设置插件自己的命令和自己的服务，不进本契约。框架自己没有用户偏好需要设置（布局的“恢复默认”已经是 `resetToPreset`）。

### 契约需求

- 无。前置条件是 `shell.overlay` 被框架声明，那是 Task_6 的契约工作，不属于本项。
- 提醒：`settings.section` 等槽位名是宿主的，不是 `webui.*`（K2 说框架自己的槽位都用 `webui.` 前缀）。设置插件**复用宿主名字**是故意的，目的是让语言、外观等现成行直接可用；这个例外要写进设置插件的说明里。

## 快捷键

### 归属

分三层，归属不同：

| 层 | 归属 | 说明 |
| --- | --- | --- |
| 服务 `shortcuts` | 宿主，不动 | 不在 47 行清单里，保持启用；框架和内容包都直接用 `ctx.shortcuts` |
| 布局命令（关闭标签、切换标签、撤销、重做、分栏……） | 框架核心 | 命令要调用控制器动作、要知道焦点在哪个格，只有核心知道 |
| 速查与改键界面 | 现成插件 `ui-shortcuts`（建议重新启用）或独立插件 | 见下 |

### 参照的 dsh 做法

- **服务**：`ctx.shortcuts.register(command)` 注册可编辑命令，`registerFixed` 登记只读的固定操作，`catalog` 是可观察的有效键位目录，`edit` 保存覆盖（`ref/deepseek-harness/packages/client/shortcuts/src/client/types.ts:83-138`）。命令是 `{ id, label, aliases, defaults, regions, modals, resolve }`，`resolve(context)` 同步解析目标并返回 `handled / blocked / pass`（`types.ts:5-32`）。默认键位按 `desktop|web` × `macos|windows|linux` 逐一声明，省略即不绑定，重复 id 和重叠默认键位会**抛错**（`types.ts:133-137`；`ref/deepseek-harness/packages/client/shortcuts/README.zh.md` 的“使用此包”一节）。服务由 `ShortcutsService` 提供，监听器随插件生命周期安装（`ref/deepseek-harness/packages/client/shortcuts/src/client/index.ts:27-100`）。
- **用户改键只存覆盖**，Web 存 `dsh.keybindings.v1`（`ref/deepseek-harness/packages/client/shortcuts/src/client/storage.ts:6`），不进 profile，也不进我们的布局。
- **各功能自己注册命令**：`ui-layout` 注册 `sidebar.left.toggle`（`ref/deepseek-harness/packages/client/ui-layout/src/client/index.ts:191-202`）；`ui-sidebar-right` 一次注册侧栏开关、分栏、全屏、关闭页、刷新页（`ref/deepseek-harness/packages/client/ui-sidebar-right/src/client/shortcuts.ts:17-90`，在 `index.ts:165` 调用）。
- **`resolve` 靠 DOM 找目标**：命令拿到触发输入的元素，用 `closest('[data-dockkit-pane], [data-dockkit-float]')` 一类选择器找到所在的格和标签（`ref/deepseek-harness/packages/client/ui-sidebar-right/src/client/focus.ts:24`，`sidebarTargetFromElement`）。这就是命令知道“关哪个标签”的办法。
- **区域**：`regions` 声明命令在哪种输入区域生效（`page / editable / terminal`）；`ui-sidebar-right` 的命令三个都列，`ui-layout` 的侧栏开关只列 `page / editable`（`shortcuts.ts:36,51,72`；`ref/deepseek-harness/packages/client/ui-layout/src/client/index.ts:200`）。
- **模态**：命令用 `modals` 列出允许在哪些模态上执行；带 `data-shortcut-modal` 的模态才有名字，没名字的当 `other`（`ref/deepseek-harness/packages/client/ui-primitives/src/Modal.tsx:41-42,63`）。
- **Web 键位避让浏览器**：Web 默认用 `primary+alt` 之类，把 `Mod+W`、`Mod+R` 之类留给浏览器（`ref/deepseek-harness/packages/client/shortcuts/README.zh.md` 的“已知限制”一节；`shortcuts.ts:66-68` 的 `web = { ...desktop, modifiers: ['primary','alt'] }`）。
- **速查界面** `ui-shortcuts`：注入只列 `shortcuts / locale / slots`（`ref/deepseek-harness/packages/client/ui-shortcuts/src/client/index.ts:22`）；往 `settings.general.item` 注册设置入口行，往 `shell.overlay` 注册弹窗和 `shortcuts.open` 命令（`index.ts:42-71`）；`Reference.tsx:156` 的 `Modal` 带 `shortcutModal="shortcuts"`。

### 与框架现有部分的关系

- **布局命令（核心）**：框架新增一个特性，用 `ctx.inject(['shortcuts'], …)` 等服务（不能写进 loader 行的 `inject`，原因同 K13），在回调里注册命令，调用 `LayoutController.actions`。注册必须容错：重复 id 或重叠默认键位会抛，不能因此让整页启动失败（照 `ui-sidebar-right` 的 `ctx.effect` 包法，抛了就记诊断）。
- **命令的 `resolve` 需要认格**：`DockView` 要在每个格和标签上写稳定的 DOM 标记（建议 `data-webui-pane`、`data-webui-block`、`data-webui-content`），核心提供“从元素找标签”的函数。这个标记是外部可见的，所以要写进契约说明。
- **命令清单（首批）**：关闭当前标签（要遵守 `closable`）、下一个 / 上一个标签、激活相邻格、撤销、重做。分栏、移动、浮出等随各自功能一起加。撤销重做的命令 `regions` 只列 `page`，不要进 `editable`，免得抢文本框自己的撤销。
- **键盘路径**：这些命令同时是拖拽停靠、浮出的键盘等价路径（dockkit 没有，`ref/deepseek-harness/packages/client/ui-dockkit/README.zh.md:106`）。
- **速查界面**：`ui-shortcuts` 在 47 行清单里（`cordis.patch.yml`，注明“自绘快捷键”）。读源码得知它只需要 `shortcuts / locale / slots`，所以它**可能**在 `shell.overlay` 被声明（Task_6）之后就能直接工作：弹窗和命令走 `shell.overlay`，设置入口行等设置外壳声明了 `settings.general.item` 之后出现。也就是说，最省事的做法是把 `ui-shortcuts` 从关闭清单里拿掉，而不是自己重写一份。这需要改 `cordis.patch.yml` 和 `scripts/patch.test.ts` 里“恰好 47 行”的断言，这一步没有在真实宿主上验证过，是否有未列出的依赖也没有查，列入该项的第一步验证。
- **与持久化的关系**：用户改的键位不进布局，也不由框架保存；框架只提供命令，保存是宿主服务的事。

### 契约需求

- DOM 标记的名字和含义（类型无关，写进契约头注释）。
- `WebuiLayoutService` 增加 `tabAt(element: Element): BlockTarget | undefined`，让内容包的插件在自己的命令里 `resolve` 出“当前焦点标签”，不必依赖 DOM 细节。
- 框架布局命令的 id 清单（字符串字面量联合，例如 `'webui.tab.close'`），让内容包可以引用它们、设置界面可以分组。
- 不需要契约来转发 `ctx.shortcuts`：内容包是普通插件，自己 `ctx.inject(['shortcuts'])` 即可。

## 实施顺序

### 依赖关系

```text
Task_5 第 1 轮（LayoutView、LayoutActionResult、版本锁定）
        │
        ├──► 撤销重做 ──► 快捷键（布局命令）──┐
        │                                      ├──► 拖拽停靠 ──► 浮出面板
Task_6 第 2 轮（shell.overlay、SessionBlockProps）
        │
        ├──► 设置 ──► 快捷键（速查界面）
        └──► 多会话并排
窄窗口覆盖层：只依赖现有 DockView，可与上面任意并行
```

### 建议次序

1. **撤销重做。** 最小的核心改动（只动 `LayoutController`，加两个动作），没有 UI 依赖，不依赖 `shell.overlay`。排最前的主要理由是：历史记录点就是 `#update` 的“用户动作”这一处，拖拽和浮出之后加进来就自动可撤销；晚做就要回头改它们。它还是后面所有手势类功能的后悔药。dsh 自己也是把它当作“架构上的事实”先做出来，界面后补。
2. **快捷键。** 布局命令只依赖现有控制器和宿主的 `shortcuts` 服务，不依赖 `shell.overlay`，做完撤销重做马上就能给它配上按键，也给后面的手势功能提供键盘路径。速查界面那半（重新启用 `ui-shortcuts`）等 `shell.overlay` 到位再做，放在同一项的后半。
3. **设置。** 等 Task_6 第 2 轮的 `shell.overlay`。这是个独立包，不碰核心；收益是语言、外观、字号的入口一次性回来（D22 落空的后果）。
4. **窄窗口覆盖层。** 只改 `DockView` 的呈现，不碰树，不碰契约；放在拖拽之前，是因为拖拽和浮出都要定义“在窄视口里怎么办”，先有这一层，后两项才有地方落脚。
5. **拖拽停靠。** 最大的一项：纯函数（移动、拖放分栏）、手势、命中测试、键盘路径，并且要先回答“标签换格是否重挂”。
6. **浮出面板。** 依赖拖拽（松手在停靠区之外就是浮出）和树的加性字段 `floats`。
7. **多会话并排。** 依赖 Task_6 第 2 轮的会话适配，并且要修订 K4；它还有“引用计数加延迟释放”的生命周期，风险最高，也没有别的功能依赖它，放最后。

次序里 2 的后半、3 和 4 互不依赖，可以按人手调换；1 排最前、5 在 6 之前、7 在 Task_6 之后这三条是硬的。

### 本文没有验证的

- 所有 dsh 行为都只读了源码，没有在真实宿主上跑。
- 重新启用 `ui-shortcuts` 和各设置页插件是否真的无需改动，没有逐个核对注入列表。
- “标签换格是否重挂”只读了 `DockView` 的结构，是推断。
- 显式 `session` 的 `SessionProvider` 在我们的 `root` 里能否工作，是推断。

## 第一项的 story 草案

排第一的是**撤销重做**。

### 标题

用户对布局做的改动可以撤销和重做

### 目标

用户在页面上关闭了一个标签、拖了分隔条、点了“恢复默认”之后，可以退回上一步，也可以再前进；块组件可以通过 `props.layout` 请求撤销和重做，也能读到当下能不能撤销。历史只存在于当前页面里，刷新后不保留。

### 依赖

- Task_5 第 1 轮的只读 `LayoutView`（带 `subscribe`）和 `LayoutActionResult`。如果它们在这个 story 开始时还没合并，`canUndo/canRedo` 作为 `LayoutView` 的字段随这个 story 一起加（AC2 的读取部分改为直接加在一个最小的 `LayoutView` 上），并通知主 agent 调整 Task_5 的范围。

### 不做

- 不做任何撤销界面（按钮、菜单）；键盘命令在下一项（快捷键）里做。
- 不持久化历史。
- 不记录标签自己改的标题（`setTitle`，它不是用户动作，不保存）。
- 不做“撤销到某一步”的列表。

### 验收标准

| AC | 内容 | 怎么判 |
| --- | --- | --- |
| AC1 | `open`、`close`、`activate`、`resize`、`resetToPreset` 和一次分隔条拖动，各自之后调用 `undo()`，布局与该动作之前深度相等；再调用 `redo()`，与该动作之后深度相等 | `LayoutController` 测试，每个动作各一条 |
| AC2 | 契约的 `BlockLayoutActions` 有 `undo()` 和 `redo()`；`LayoutView` 快照有 `canUndo` 和 `canRedo`，起始为 `false`，动作之后 `canUndo` 变 `true`，撤销之后 `canRedo` 变 `true`，订阅者在每次变化时被通知 | 契约类型测试加控制器测试 |
| AC3 | 一次分隔条拖动（`beginResize`、若干次 `resizeSplit`、`endResize`）只产生一步历史，一次 `undo()` 回到拖动之前的尺寸 | 控制器测试 |
| AC4 | 撤销之后做了新动作，`canRedo` 变 `false`，旧的前进分支不可再达 | 控制器测试 |
| AC5 | 没有改变布局的动作（例如打开已经打开的块、关闭 `closable: false` 的块、对空历史调用 `undo()`）不产生历史、不通知 `onAction`；空历史的 `undo()/redo()` 是无操作且不抛错 | 控制器测试，通知次数断言为 0 |
| AC6 | 非用户动作不进历史：注册或注销块引起的跟随与修复、`settle()`、`setTabTitle`、读 profile 的 `replaceLayout`。`replaceLayout` 之后历史清空 | 控制器测试，每种各一条 |
| AC7 | 撤销和重做各算一次用户动作：`onAction` 监听者各收到一次、参数是撤销后的树；`LayoutPersistence` 因此把它写进 profile（假表单的 `set('layout', …)` 被调用，值是撤销后的树） | 控制器测试，加 `layout-persistence` 测试 |
| AC8 | 撤销到的快照里引用了此后已注销的块时，结果经 `resolveLayout` 修复：该块消失、`closable: false` 的块仍在、`activePane` 合法，页面不崩；历史其余部分不受损 | 控制器测试 |
| AC9 | 历史有上限（常量 100 步）：超过后最老的一步被丢弃，`undo()` 最多回退 100 步；新建控制器的历史为空 | 控制器测试 |
| AC10 | 块组件在 `DockView` 里调用 `props.layout.undo()` 能撤销（例如块关闭了自己，再调用就回来）；块拿到的 `props.layout` 仍然只有契约里列出的动作，没有 `resizeSplit` 等内部方法 | `DockView` 测试 |
| AC11 | 第一次用户动作后布局不再跟随预设；撤销回到起点布局不恢复跟随（有意的行为，测试固定下来） | 控制器测试 |
| AC12 | `npm run gate` 全绿；`examples/hello-block` 仍能构建；契约头注释说明 `undo/redo` 的语义（只回退用户动作，不含标题，刷新后清空） | 门禁，人工看契约 |

### 验证方式

纯逻辑和控制器行为全部自动化测试，不需要真实宿主。人工验收只有一条：在真实宿主上装示例插件，关闭一个标签后用一个临时按钮调用 `props.layout.undo()`，刷新页面后确认历史清空而布局保持。
