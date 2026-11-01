# 调研：session 块怎样拿到有类型的会话对象，框架怎样提供对话框 / 浮层层

本文是 Task_6_1 的交付物，只回答问题、不改产品代码。引用 dsh 源码一律写成相对 `ref/deepseek-harness` 的路径与行号，宿主版本是 `0.2.2-alpha.2`。

## 会话对象

### 今天是什么状况

`session` 块今天拿会话的路径是宿主 slot 的 owner props，契约对此没有任何声明：

- `shell` 特性在 `root` 座位下声明 `webui.block.session`，作用域是 `session`（`src/client/features/shell.ts:44-47`，`src/client/types.ts:31`）。`App` 用 `SessionProvider` 包住整个停靠区（`src/client/entries/App.tsx:68-70`），每个 session 块经 `renderSlot('webui.block.session', instance, { only })` 挂载（`src/client/entries/App.tsx:51`）。
- 块的组件在 `registerBlock` 里原样注册进槽位，不包一层（`src/client/services/block-registry.ts:73-75,161-168`）。所以宿主往 session 作用域条目里注入的标准 props 会直接落到块组件上：`useSession`、`sessionId`、`useProjection`、`useAccess`（`ref/deepseek-harness/packages/client/ui-session/src/client/index.ts:166-175`，接口基底在 `ref/deepseek-harness/packages/client/ui-slots/src/index.ts:221`）。`ui-conversation` 和 `ui-chat` 还会往同一个接口合并 `useConversation`、`useInput`、`inputActions`、`useChat`，但它们属于被关掉的行，不在我们的页面里。
- 契约的 `BlockInstanceProps` 只有 `blockId`、`contentId`、`active`、`layout`（`contract/index.d.ts:108-113`）；模块注释只说"宿主标准 props 不在这里重新声明，去槽位自己的 props 类型上读"（`contract/index.d.ts:8-10`）。可是能读的那个类型 `PropsRuntime<'webui.block.session'>` 依赖 `src/client/types.ts:29-32` 里的 `SlotMap` 合并，这是框架内部声明，契约使用者拿不到。结果是：session 块要么 `any`，要么自己 `import type` 一堆 `@deepseek-ai/dsh-client-*` 包，并且和 dsh 的会话 API 绑死。

宿主的会话对象本身很大：`SessionSnapshot` 有 `running`、`openState`、`promptError`、`blank`、`lastAgentError` 等十几个字段（`ref/deepseek-harness/packages/api/session-controller/src/client/contract/snapshot.ts:69-90`），`SessionFace` 还带 `prompt`、`cancel`、`updateQueue`、`projections` 等方法（`ref/deepseek-harness/packages/api/session-controller/src/client/contract/session.ts:68-124,166`）。`SessionId` 是品牌类型（`ref/deepseek-harness/packages/client/ui-slots/src/index.ts:243`）。

### 建议

契约声明自己的会话类型，不 import 任何 dsh 类型；框架在注册时包一层适配，把宿主 props 翻译成契约类型。

```ts
/** 块能读到的会话状态；字段取自宿主快照的稳定子集，品牌类型降成 string。 */
export interface WebuiSessionState {
  sessionId: string
  running: boolean
  blank: boolean
  removed: boolean
  openState: 'cold' | 'loading' | 'open' | 'error'
  lastAgentError: string | null
}

export interface WebuiSession {
  readonly sessionId: string
  /** 选择器 hook：只在会话状态里选自己要的部分。 */
  useState<T>(select: (state: WebuiSessionState) => T): T
  /** 发送与中止；返回是否被宿主接受。失败原因怎样暴露由第 2 轮再定。 */
  send(text: string): Promise<boolean>
  stop(): Promise<boolean>
}

export interface SessionBlockProps extends BlockInstanceProps {
  session: WebuiSession
}
```

- `registerBlock` 按 `meta.scope` 重载：`scope: 'session'` 的组件类型是 `ComponentType<SessionBlockProps>`，`scope: 'root'` 的仍是 `ComponentType<BlockInstanceProps>`。`BlockMeta` 现在 `scope` 只是联合类型，第 2 轮要把它改成可判别的联合，否则重载选不出来。
- 适配发生在 `registerBlock` 里：对 session 块注册一个由框架持有的包装组件，读宿主的 `useSession` / `sessionId`，构造 `session` prop 再渲染块。包装组件在每次注册时只创建一次，保持函数身份稳定，否则每次渲染都会 remount 块。会话切换时 `key` 的 remount 语义不变：session 作用域条目的 `key` 来自 `binding.ctx` 的代数，主会话一换就整块重挂（见 `docs/research/alpha2-facts.local.md` §7，源码 `ref/deepseek-harness/packages/client/ui-renderer/src/client/scoped-slots.tsx:382-394,1043-1048`）。包装组件在条目内部，所以不改变这件事。
- 宿主会话 API 变化时只改框架：`WebuiSessionState` 的字段映射、`send` / `stop` 到 `prompt` / `cancel` 的转换都在适配这一处，契约和所有内容包不动。宿主新增字段，框架不暴露就不影响任何人；宿主改名或拆分，框架在适配里补映射即可。
- 本调研没有写适配代码，也没有在宿主上验证包装组件的 remount 行为，只读了源码；这部分留给第 2 轮的测试。

## 对话框与浮层层

### 在真实宿主上的验证

**结论：框架独占 `root` 时，`shell.overlay` 不渲染，而且没有任何报错。** 原因是 `shell.overlay` 是官方外壳 `ui-layout` 在自己的 `root` 条目里声明的子槽位（`ref/deepseek-harness/packages/client/ui-layout/src/client/index.ts:105,186`），渲染点是 `AppFrame`（`ref/deepseek-harness/packages/client/ui-layout/src/client/AppFrame.tsx:249,292-294`）。框架关掉 `ui-layout` 占用 `root` 以后，没有人声明这个槽位，也没有人渲染它。

验证环境与步骤：

- 宿主：`dsh 0.2.2-alpha.2`（`/home/agent/dev/dsh-alpha2/dsh/bin/dsh --version` 输出该版本）。`DSH_HOME` 是 `/home/agent/dev/dsh-alpha2/home` 的拷贝，原目录未动。浏览器是 Chromium 156.0.8078.73，无头模式，经 `--remote-debugging-port` 和一个小 Node 脚本（`Page.navigate` 后等 12 秒，再 `Runtime.evaluate`）读取页面状态。登录令牌取自宿主日志，没有写进本文。
- 探针：一个临时插件 `@scratch/overlay-probe`，放在拷贝出来的 profile 的 `node_modules` 里，并写进 `dsh.profile.bundles`。它的 `apply` 做三件事：打日志；直接 `ctx.slots.register({ name: 'shell.overlay', id: 'overlay-probe-direct' }, Probe)`，捕获异常；`ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'overlay-probe' }, Probe))`，回调里打日志。`Probe` 渲染一个 `id="overlay-probe"` 的黄色角标。日志收在 `window.__probe`。
- 实验组：profile `webui-demo`（拷贝），bundles 是 `dsh-base`、`dsh-web-app`、`@lllzt/dsh-webui-framework`、`@lllzt/dsh-webui-hello-block`，再加探针。框架是 profile 里已装的 tarball（由主代理构建，没有核对它是否正好等于 `caf1a8f`），端口 3193。
- 对照组：新建 profile `webui-ctl`，bundles 只有 `dsh-base`、`dsh-web-app` 和探针（官方外壳，`ui-layout` 未关），同一个宿主二进制、同一个端口。

观察结果：

| 项目 | 实验组（框架占 root） | 对照组（官方外壳） |
| --- | --- | --- |
| 页面主体 | `.webui-root` 存在，显示 hello 块 | 官方侧栏与会话页，`.webui-root` 不存在 |
| `[data-shell-overlay]` 层 | 不存在 | 存在 |
| `#overlay-probe` | 不存在 | 存在 |
| 直接 `register` | 抛 `slot "shell.overlay" is not declared (a parent entry's children table must declare it)` | 同样在 `apply` 当下抛（此时槽位尚未声明） |
| `inject('shell.overlay')` 回调 | 始终没有触发 | 触发，日志 `inject('shell.overlay') callback ran: slot is declared` |

实验组的 `window.__probe` 恰好是两行：`apply() ran`、上面那条 `not declared` 错误。第一次尝试用 `chromium --dump-dom` 超时（退出码 124，页面常驻的连接让它不收尾），但控制台日志已经打出同样的两行；之后改用 CDP 才拿到 DOM 状态。

异常文本的出处是 `ref/deepseek-harness/packages/client/ui-slots/src/index.ts:1210`；`slots.inject` 的回调只在槽位被声明后才运行（`ref/deepseek-harness/packages/client/ui-renderer/src/client/registry.ts:242`），所以走 `inject` 的宿主插件在我们的页面里是静默失效的。

### 受影响的现有条目

`ui-file-drag` 不在 47 个被关闭的行里，因此会照常加载，但它的 `file-drag.feedback` 条目（`ref/deepseek-harness/packages/client/ui-file-drag/src/client/index.ts:46-49`）同一机制下进不了页面。我只用探针验证了机制，没有单独拖文件去观察 `ui-file-drag`；这一条是由探针结果推出来的，不是直接观测。

### 框架怎样提供这一层

三个选项：

1. **框架在 `root` 的 `children` 里自己声明 `shell.overlay`**，由 `App` 在 `.webui-root` 内渲染成一个绝对定位、点击穿透的层（宿主的做法见 `ref/deepseek-harness/packages/client/ui-layout/src/client/AppFrame.module.css:281-291`）。好处是已有的、按这个名字注册的宿主插件（`ui-file-drag`，以及第三方插件）无需改动就能出现。风险：类型层需要 `SlotMap` 里有 `shell.overlay`，而它由 `dsh-client-ui-layout` 的类型合并提供（`ref/deepseek-harness/packages/client/ui-layout/src/client/index.ts:105`），框架今天的 devDependencies 里没有这个包；自己再声明一遍则要保证类型一致。运行时与重新启用 `ui-layout` 的 profile 会冲突，这点需要写进 README。**这个选项我没有在真实宿主上试过**，只是从槽位机制推断它应该工作。
2. **框架另起名字**，例如 `webui.overlay`，只给内容包用。干净，但宿主已有的 `shell.overlay` 使用者仍然失效。
3. **不做槽位，只用 `ui-primitives` 的 Modal / Toast / Menu**。这些组件自己 `createPortal` 到 `document.body`（`ref/deepseek-harness/packages/client/ui-primitives/src/Modal.tsx:57,90`，`Toast.tsx:75,99`，`Menu.tsx:572`），不依赖任何外壳槽位；样式变量带回退值（`Modal.module.css:14` 写 `var(--dsh-frame-overlay-top, 24px)`）。`@deepseek-ai/dsh-client-ui-primitives` 是宿主提供的 seed 模块（`scripts/plugin-constants.ts` 的 `SEED_MODULES`），框架可以直接 `require`。这一条也只是读源码得出的，没有在宿主上渲染过 Modal。

建议：**选项 1 加选项 3**。框架声明 `shell.overlay` 以保住宿主现有插件的兼容，承载 toast / 状态角标这类常驻内容；对话框本身由内容包通过 `ui-primitives` 的 Modal 绘制，不需要框架再发明一套对话框 API。是否要在契约里再给"打开一个对话框"的函数，留到第 2 轮根据内容包的实际写法再定，先不扩契约。

## 需要这个层的宿主功能

先把 `cordis.patch.yml` 里 47 个被关闭的 id 分成两类。点名的三个：

| id | 包 | 要什么 | 源码位置 |
| --- | --- | --- | --- |
| `ui-approval` | `ui-approval` | 不是浮层。它监听 `approval/request` 瀑布（`index.ts:107-109`），把请求发布为会话的待处理交互（`registerPendingInteraction`，`index.ts:90-92`），再以 `conversation.composer` 链条目替换输入框（`index.ts:97-106`），卡片用 `conversation.approval.card` 工厂（`index.ts:93-96`）。所需：session 作用域里有"待处理交互"，且渲染位置是会话内的输入区。 | `ref/deepseek-harness/packages/client/ui-approval/src/client/index.ts:27,90-109` |
| `ui-user-questions` | `ui-user-questions` | 同上：`user-questions/request` 瀑布（`index.ts:401-403`）、待处理交互（`index.ts:371-373`）、`conversation.composer` 链条目（`index.ts:382-395`），另有 `conversation.chat.node` 条目（`index.ts:396-400`）画回答记录。还依赖 `uiConversation`（`index.ts:56`）。 | `ref/deepseek-harness/packages/client/ui-user-questions/src/client/index.ts:56,371-403` |
| `ui-permission` | `ui-permission-presets` | 不是浮层：它在 `conversation.input.permission` 里放一个选择菜单（`index.ts:177-186`），在 `settings.general.item` 里放设置行（`index.ts:169-176`），并给 `/permission` 命令装饰一个 `popupSelect`（`index.ts:195-203` 一带）。菜单来自 `ui-primitives` 的 `Menu`（`PermissionSelect.tsx:166`），`Menu` 可以走 `document.body` 门户（`Menu.tsx:572`）。`popupSelect` 的外壳画在 `conversation.input.overlay` 锚点，不是 `shell.overlay`（`ref/deepseek-harness/packages/client/ui-commands/src/client/PopupSelectView.tsx:3`）。所需：输入区的弹出层，和一个设置页位置。 | `ref/deepseek-harness/packages/client/ui-permission-presets/src/client/index.ts:59-62,169-203` |

这三个的结论要诚实地说：**没有一个直接写进 `shell.overlay`**。审批和提问需要的是"会话的待处理交互"这条数据通路和输入区位置，对话框层只是一种可选的呈现方式；README 里"必须同时安装一个内容包"那句说的就是这件事。我没有在宿主上观察过没人应答 `approval/request` 时会发生什么，只看到控制器会把它记作会话的待输入状态（`ref/deepseek-harness/packages/api/session-controller/src/state/controller.ts:164-171`）。

直接注册进 `shell.overlay` 的被关闭行（用 `grep` 在 `packages/client` 下找到的，每条都读了注册点）：

| id | 条目 | 位置 |
| --- | --- | --- |
| `ui-workspace` | 改名对话框、停止并归档确认、行内 toast | `ref/deepseek-harness/packages/client/ui-workspace/src/client/index.ts:330-338` |
| `ui-open-in-app` | 打开结果 toast | `ref/deepseek-harness/packages/client/ui-open-in-app/src/client/index.ts:61-62` |
| `ui-schedule` | 删除结果 toast | `ref/deepseek-harness/packages/client/ui-schedule/src/client/index.ts:130-131` |
| `ui-chat` | 额度提示宿主 | `ref/deepseek-harness/packages/client/ui-chat/src/client/apply.ts:319-320` |
| `ui-plugin-manager` | 刷新 toast | `ref/deepseek-harness/packages/client/ui-plugin-manager/src/client/index.ts:122-123` |
| `ui-settings-account` | 桌面引导、平台页 | `ref/deepseek-harness/packages/client/ui-settings-account/src/client/index.ts:297-298,325-326` |
| `ui-settings-general` | 宿主版本变化提示 | `ref/deepseek-harness/packages/client/ui-settings-general/src/client/index.ts:262-263` |
| `ui-sidebar-terminal` | 终端清理失败提示；注册代码已被注释掉，组件还在 | `ref/deepseek-harness/packages/client/ui-sidebar-terminal/src/client/index.ts:123-124`，`TerminalCleanup.tsx:22` |

另有一批功能自己用 `createPortal` 画菜单或弹层，不依赖外壳槽位：`ui-settings-account`（`OnboardingSurface.tsx`、`AccountNotice.tsx`、`PlatformOverlay.tsx`）、`ui-settings-general`（`SettingsRoot.tsx`）、`ui-schedule`（`TaskMenu.tsx`、`PickerPopover.tsx`、`ScheduleCatalogAction.tsx`）、`ui-chat`（`TurnUsagePanel.tsx`、`StatsPills.tsx`）、`ui-plugin-manager`（`PluginManagerPage.tsx`）、`ui-subagent`（`SubagentHeaderLineage.tsx`）。路径都在 `ref/deepseek-harness/packages/client/<包>/src/client/` 下。

没有逐个读剩下的行（侧栏系、设置分页、`ui-tool`、`ui-attachment` 等）。上面是"注册进 `shell.overlay`"和"自己 `createPortal`"两个关键词的穷举结果，没命中的行我没有判断它们是否另有浮层需求。

## 契约第 2 轮验收标准草案

会话对象：

1. 契约导出 `WebuiSessionState`、`WebuiSession`、`SessionBlockProps`，文件里不出现任何 `@deepseek-ai/*` 的 import；`BlockMeta` 的 `scope` 与组件类型联动，`registerBlock` 对 `scope: 'session'` 要求 `ComponentType<SessionBlockProps>`，对 `scope: 'root'` 要求 `ComponentType<BlockInstanceProps>`；一个类型测试确认传错会编译失败。
2. session 块组件收到的 `session.sessionId` 是当前主会话的 id；`session.useState` 的选择器只在被选部分变化时触发重渲染；`running` 等字段随宿主快照更新。
3. 切换主会话时 session 块按现有语义重挂（不比今天多一次也不少一次 remount），包装组件的函数身份在同一次注册内保持稳定。有测试覆盖。
4. 把宿主会话类型换成另一个形状（测试里用替身），只改适配文件，契约、内容包示例和契约类型测试全部不变。
5. `send` / `stop` 在宿主拒绝或抛错时的返回值与可观测状态有定义，并有测试。
6. `examples/hello-block` 的 session 块改用 `SessionBlockProps`，不再依赖宿主标准 props 的隐式存在。

对话框与浮层层：

7. 框架声明 `shell.overlay`（或确定的替代名）并在 `.webui-root` 内渲染，层本身点击穿透、条目可恢复指针事件。在真实宿主上用本文的探针复测：`inject('shell.overlay')` 回调触发，`#overlay-probe` 出现在 DOM 里。
8. `ui-file-drag` 的 `file-drag.feedback` 在框架页面里能显示（真实宿主上拖入失败文件触发，或用 `fileDrag` 服务的 `reportFailure` 触发）。
9. 层里条目的错误边界和现有 `data-slot-error` 行为一致：一个条目崩溃不影响其他条目和停靠区。
10. 内容包在块里用 `ui-primitives` 的 `Modal` 弹出对话框，在框架页面上位置、焦点归还、Escape 关闭都正常（真实宿主上验证一次）；`verify-bundle` 的 seed 模块检查继续通过。
11. README 写明与 `ui-layout` 同时启用时的冲突，以及 `shell.overlay` 的兼容范围。

待处理交互：

12. 先决定审批 / 提问由谁画：契约是否提供"会话的待处理交互"数据通路（对应 `uiSession.registerPendingInteraction` 与 `SessionStatus.pendingInteraction`，`ref/deepseek-harness/packages/client/ui-session/src/client/index.ts:60-70,416`）。若提供，则按第 1–4 条的方式在契约里声明自己的类型，并且有一个示例内容包应答 `approval/request`；若不提供，README 明说审批 / 提问由内容包直接依赖宿主 API 实现。这一条是决策项，不是实现项。

## 结论

1. **会话对象**：今天 session 块能拿到宿主会话，但是靠隐式的 slot owner props，契约没有类型，内容包只能自己 `import type` dsh 包。建议契约声明框架自己的 `WebuiSessionState` / `WebuiSession` / `SessionBlockProps`，框架在 `registerBlock` 里包一层适配；宿主会话 API 变化时只改这层适配。适配的代码与 remount 行为本次没有实现也没有验证。
2. **`shell.overlay` 在框架独占 `root` 时不渲染**，已在 `dsh 0.2.2-alpha.2`、profile `webui-demo`（拷贝）上验证，对照组（官方外壳）渲染正常。直接 `register` 抛 `not declared`，走 `inject` 的插件回调根本不触发，没有任何可见报错。依赖这个槽位的宿主插件（含未被关闭的 `ui-file-drag`）在我们的页面里静默失效。
3. **提供方式**：建议框架自己在 `root` 的 `children` 里声明 `shell.overlay` 并渲染（保住宿主插件兼容），对话框由内容包用 `ui-primitives` 的 Modal 画。这个建议本身没有在宿主上试过，只验证了"不声明就不渲染"这一半；第 2 轮验收第 7、8、10 条是补上另一半。
4. **47 个功能**：`ui-approval`、`ui-user-questions`、`ui-permission` 都不直接依赖 `shell.overlay`。前两个依赖会话的待处理交互和 `conversation.composer` 链，第三个依赖输入区的弹出菜单。真正注册进 `shell.overlay` 的被关闭行是 `ui-workspace`、`ui-open-in-app`、`ui-schedule`、`ui-chat`、`ui-plugin-manager`、`ui-settings-account`、`ui-settings-general`，以及注册已被注释的 `ui-sidebar-terminal`。
5. **没做的事**：没有写适配或槽位代码；没有在宿主上渲染 `ui-primitives` 的 Modal；没有验证没人应答 `approval/request` 时宿主的行为；没有逐行审阅其余被关闭的功能。
