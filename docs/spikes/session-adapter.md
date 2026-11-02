# 调研：框架怎样替 session 块读会话状态、对当前主会话发送与停止

本文是 Task_13_1 的交付物，只回答问题、不改产品代码。宿主版本是 `0.2.2-alpha.2`。引用 dsh 源码一律写成 `ref/deepseek-harness` 下的相对路径加行号（固定在 `f3803c9697`）；引用已安装类型写成 `node_modules/...d.ts:行号`。本仓库自己的文件写成相对仓库根的路径。

本文在 `docs/spikes/session-and-overlay.md` 的 `## 会话对象` 之上继续，那一节的类型草案（`WebuiSessionState`、`WebuiSession`、`SessionBlockProps`）基本沿用，下面凡是改动或推翻之处都会点明（见 `## 结论一览` 末尾的“对上一份调研的修正”）。

**证据的强度。** 没有启动真实宿主，全部结论来自读源码和读已安装类型。唯一“跑过”的东西是：把本文的契约草案和适配器草稿放进 `/tmp` 里的临时副本，用已安装的 `0.2.2-alpha.2` 类型跑了 `tsc`，并把契约草案套在本仓库的副本上跑了 `npm run typecheck` 的两份配置。这只证明类型对得上，不证明宿主行为。凡是没在宿主上观察过的结论都写了「未在宿主上验证」。ref 源码与已安装类型在本文用到的每个导出上一致（`ISessions.binding / retain / using`、`ISession.prompt / cancel`、`SessionSnapshot` 的字段、`UiSession.provide`），没有出现两边不一致的地方；若以后不一致，以已安装类型为准。

## 结论一览

1. **读状态**：不直接把宿主的 `useSession` 交给块。框架在 session 条目的 `inject` 里下发一个自己的快照源 `webuiSession`，它把 `SessionSnapshot` 翻成 `WebuiSessionState`，并在六个字段都没变时保持同一个对象。宿主渲染器把这个源绑成选择器 hook，`session.useState` 就是这个 hook 本身，选出的值不变（`Object.is`，或调用方给的 `equal`）时块不重渲染。
2. **发送与停止**：不需要 `ctx.sessions.retain` / `using`。session 条目的 `inject` 会收到 `sessionId`，框架用 `ctx.sessions.binding(sessionId)` 借出此刻已被主会话持有的 `SessionBinding`，调 `binding.session.prompt([{ type: 'text', text }], 'queue')` 与 `binding.session.cancel()`。这与 `PRINCIPLES.local.md` §2.3 和 08 K5 的“框架不 retain 会话”一致，宿主自己的 `ui-conversation` 发送与取消也是这条路。`retain / using` 与 `SessionReferenceSource` 的写法在 `## 发送与停止` 里作为备选写清楚，但不推荐。
3. **生命周期**：框架不持有任何宿主引用，也不持有需要释放的订阅；唯一要在卸载时放掉的是包装组件为在途的 `send` / `stop` 持有的 `AbortController`（遵守 PRINCIPLES §2.3，见 `## 发送与停止`）。主会话切换由宿主按 `binding.ctx` 的代数重挂 session 条目，框架的包装组件在条目里面，所以重挂一次、不多不少。
4. **宿主会话 API 变化**：只改一个模块 `src/client/services/session-adapter.ts`。再加一条 ESLint 限制，让其他模块不能 import 宿主的会话类型，这样“只在一个模块里”可被自动检查。
5. **契约与拆分**：契约草案已在本仓库副本上通过类型检查；`BlockMeta` 改成按 `scope` 可判别的联合，`registerBlock` 用一个泛型签名按 `meta` 选组件类型。余下工作拆成四个 unit，见 `## 契约草案与单元拆分`。

**对上一份调研的修正。**

- 上一份说包装组件“读宿主的 `useSession` / `sessionId`，构造 `session` prop 再渲染块”。读状态这一半可行，但 `send` / `stop` 需要 `SessionFace`，而宿主给 session 条目的标准 props 里没有它（`SessionStandardProps` 只有 `useSession`、`sessionId`、`useProjection`、`useAccess`：`ref/deepseek-harness/packages/client/ui-session/src/client/index.ts:166-175`）。所以不能只靠标准 props，要给条目加 `inject`。
- 上一份说包装组件“按 `useSession` 读”。本文改成不用 `useSession`，原因是 `SessionSnapshot` 的 `pendingSubmissions`、`hasMore`、`loadingOlder` 等字段变化频繁，直接 `useSession(s => ...)` 要靠调用方写对选择器；框架自己派生一个只含六个字段的源，才能保证“六个字段没变就不重渲染”这条框架级承诺。
- `WebuiSession.useState` 加一个可选的第二参数 `equal`。上一份和 Task_13 的 AC1 都只写了 `useState(select)`；加 `equal` 与宿主的选择器 hook 同形（`ref/deepseek-harness/packages/client/ui-renderer/src/client/bind.ts:20-26`），不加则选择器返回新对象的块在每次状态变化都会重渲染。这是对 AC1 文字的一处补充，需要主 agent 认可。
- 上一份没写“主会话到底由谁持有”。本文补上：`ui-session` 把“被 `mainView` 引用持有的会话”当作主会话（`ref/deepseek-harness/packages/client/ui-session/src/client/index.ts:460-474,541-543`），而唯一调用 `retain(…, { source: 'mainView' })` 的是 `ui-workspace`（`ref/deepseek-harness/packages/client/ui-workspace/src/client/navigation.ts:530`），它在 `cordis.patch.yml:16` 被关闭。也就是说框架装进去以后，除非别的插件持有 `mainView`，session 块永远只显示空态。这与 K5 一致，但会影响 AC8 的人工验收，见 `## 引用的生命周期` 末尾。

## 读会话状态

### 标准 props 怎样落到块上

今天 `registerBlock` 对 session 块不包一层：函数组件原样注册进槽位，类组件包一层透传（`src/client/services/block-registry.ts:73-75,161-169`）。session 条目渲染时，宿主把 `{...kit} {...injected} {...slotInjected.props} {...ownerProps}` 展开到组件上，`ownerProps` 在最后（`ref/deepseek-harness/packages/client/ui-renderer/src/client/scoped-slots.tsx:627-640`），所以我们的 `BlockInstanceProps` 不会被同名标准 prop 盖掉。标准 props 来自 `ui-session` 的内置源：`hooks: ['session']`、`keyedHooks: ['projection']`、`props: ['sessionId']`（`ref/deepseek-harness/packages/client/ui-session/src/client/index.ts:266-280`），经 `standardHookPropName` 变成 `useSession`、`sessionId`（`ref/deepseek-harness/packages/client/ui-slots/src/renderer.ts:42-44`）。

没有主会话时，`SessionProvider` 的 `empty` 分支顶替整个子树，块根本不挂载（`ref/deepseek-harness/packages/client/ui-session/src/client/session-provider.tsx:13-18`）。所以块渲染时 `session` 一定有值，不需要 `undefined` 分支。

### 选择器语义与等值比较

宿主的选择器 hook 只有一个构造点：

```ts
// ref/deepseek-harness/packages/client/ui-renderer/src/client/bind.ts:20-26
export function bindSnapshotSelector<T>(w: HostObservable<T>): SnapshotSelectorHook<T> {
  const subscribe = (fn: () => void) => w.subscribe(fn)
  const getSnapshot = () => w.getSnapshot()
  return function useSelector<S>(sel, eq?) {
    return useSyncExternalStoreWithSelector(subscribe, getSnapshot, undefined, sel, eq)
  }
}
```

读源码得知的语义（未在宿主上验证）：

- 每个源对应一个按源缓存、身份稳定的 hook（`ref/deepseek-harness/packages/client/ui-renderer/src/client/bindings.tsx:69-77`）。
- 快照变化时重新跑选择器；选出的值与上一次“相等”就返回上一次的引用，组件不重渲染。相等默认是 `Object.is`，调用方可以传 `eq`（已安装类型：`node_modules/@deepseek-ai/dsh-client-store/lib/types/contract.d.ts` 的 `SnapshotSelectorHook<T>`，即 `<S>(sel: (s: T) => S, eq?: (a: S, b: S) => boolean) => S`）。
- 因此有两个陷阱：选择器每次返回新对象且不给 `eq`，每次快照变化都重渲染；快照本身在不相关字段变化时换了对象，`s => s` 这样的选择器也跟着重渲染。

### 框架怎么做

在 `session-adapter.ts` 里为每个 `SessionBinding` 派生一个只读源，并按 `SessionBinding` 缓存：

```ts
// 在已安装的 0.2.2-alpha.2 类型上通过 tsc；不等于宿主行为
const sources = new WeakMap<SessionBinding, HostObservable<WebuiSessionState>>()

function stateSourceOf(binding: SessionBinding): HostObservable<WebuiSessionState> {
  let source = sources.get(binding)
  if (source === undefined) {
    const session = binding.session
    let lastSnapshot: SessionSnapshot | undefined
    let lastState: WebuiSessionState | undefined
    source = {
      getSnapshot() {
        const snapshot = session.getSnapshot()
        if (snapshot === lastSnapshot && lastState !== undefined) return lastState
        const next = toState(snapshot)
        lastSnapshot = snapshot
        if (lastState === undefined || !sameState(lastState, next)) lastState = next
        return lastState
      },
      subscribe: (listener) => session.subscribe(listener),
    }
    sources.set(binding, source)
  }
  return source
}
```

`toState` 逐字段取值，`sameState` 比六个字段。字段对应关系：

| `WebuiSessionState` | 宿主 `SessionSnapshot` | 位置 |
| --- | --- | --- |
| `sessionId: string` | `sessionId`（品牌类型，降成 `string`） | `ref/deepseek-harness/packages/api/session-controller/src/client/contract/snapshot.ts:70` |
| `running` | `running` | 同文件 `:73` |
| `blank` | `blank` | `:85` |
| `removed` | `removed` | `:79` |
| `openState` | `openState`（`'cold' \| 'loading' \| 'open' \| 'error'`，与契约的联合逐字相同） | `:60,80` |
| `lastAgentError: string \| null` | `lastAgentError` | `:86` |

已安装类型里同样的字段在 `node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/client/contract/snapshot.d.ts:51,57-80`。`toState` 里把 `openState` 直接赋给契约的联合：宿主以后给 `OpenState` 加新值，这一行会编译失败，这正是“宿主变了只改适配器”的触发点；运行时遇到契约不认识的值怎么处理（建议当作 `'error'` 并警告一次）留给 U2 的测试固定。

源是纯函数式的：`getSnapshot` 对同一个宿主快照返回同一个对象，宿主快照换了但六个字段没变时仍返回上一个 `WebuiSessionState`。这满足 uSES 对 `getSnapshot` 的稳定性要求，也让 `session.useState(s => s)` 在 `pendingSubmissions`、`hasMore`、`loadingOlder` 这类字段变化时不重渲染。`subscribe` 直接转给宿主，没有常驻订阅：只有 React 组件挂载并订阅时才订，卸载时由 uSES 退订。

条目的 `inject` 把这个源放进 `hooks` 隔间，渲染器替我们绑 hook（`ref/deepseek-harness/packages/client/ui-renderer/src/client/scoped-slots.tsx:184-205`，`hooks.webuiSession` 变成 `useWebuiSession`，同样走 `observableHook`）。包装组件把它原样挂到 `session.useState`：

```ts
session = { sessionId, useState: useWebuiSession, send: actions.send, stop: actions.stop }
```

所以 `session.useState(select, equal?)` 的等值语义就是宿主的，没有再包一层，也没有每次渲染新建的闭包。

**为什么不是 `useState = (select) => useSession(s => select(toState(s)))`。** 这个写法可行，但 `select(s => s)` 每次都拿到新的 `toState` 结果，必然重渲染；要避免就得在适配器里再维护一份“按宿主快照缓存”的映射，复杂度和上面的派生源相当，却没有“六个字段没变时保持对象不变”的保证。

**宿主重建标准源时。** 宿主里若有别的插件调用 `uiSession.provide(...)` 或释放它，会 `rebuildBindings`，把所有 session 的标准源换成新对象，`inject` 的缓存按 `StandardSourceBinding` 对象取键（`ref/deepseek-harness/packages/client/ui-renderer/src/client/scoped-slots.tsx:261-273`），所以 `inject` 会重跑一次。因为我们的源和动作都按 `SessionBinding` 缓存（上面的 `WeakMap`），重跑得到的还是同一个源、同一个 hook、同一组动作，`session` 对象身份不变，块不会因此重渲染。条目的重挂只看 `binding.ctx`，与此无关（见 `## 引用的生命周期`）。

## 发送与停止

### 标准 props 里没有 prompt / cancel

`SessionStandardProps` 只有 `useSession`、`sessionId`、`useProjection`、`useAccess`（见上）。`prompt` 与 `cancel` 在 `ISession` 上（`ref/deepseek-harness/packages/api/session-controller/src/client/contract/session.ts:98,124`；已安装类型 `.../contract/session.d.ts:93,119`），必须拿到 `SessionFace`。`SessionFace` 经 `SessionBinding.session` 得到（`ref/deepseek-harness/packages/api/session-controller/src/client/sessions/service.ts` 的 `SessionBinding`；已安装类型 `sessions/service.d.ts:83-90`）。

### 四条路

任务描述里假设走 `ctx.sessions.retain` / `using`。读源码后可选的路有四条：

| 路 | 做法 | 谁拥有 `SessionBinding` 的生命周期 | 与 K5 / PRINCIPLES §2.3 | 宿主先例 |
| --- | --- | --- | --- | --- |
| **R1（推荐）** | 条目 `inject(sessionId)` 里借出 `ctx.sessions.binding(sessionId)`，把动作闭包在它上面 | 持有 `mainView`（或显式 `SessionProvider session={reference}`）的一方；框架只借用 | 一致，框架不 retain | `ui-conversation` 的 `send` / `cancel`：`ref/deepseek-harness/packages/client/ui-conversation/src/client/service.ts:209-214,549-553,561-567`；`ui-trajectory` 的 `inject`：`ref/deepseek-harness/packages/client/ui-trajectory/src/client/index.ts:85-91` |
| R2 | `ctx.uiSession.provide({ hooks, props, resolve(binding) })`，宿主直接把 `binding` 交给 `resolve` | 同上 | 一致 | `ui-conversation`：`ref/deepseek-harness/packages/client/ui-conversation/src/client/apply.ts:317-333`；`ui-chat`：`.../ui-chat/src/client/apply.ts:132-135`；`ui-trajectory`：`.../ui-trajectory/src/client/index.ts:76-79` |
| R3 | 每次 `send` / `stop` 用 `ctx.sessions.using(id, { source }, ref => ref.binding.session.prompt(...))` | 这一次调用；`using` 在回调结束（含失败）后释放 | 要改 PRINCIPLES §2.3 的措辞（它写“框架不 retain 会话”） | `ui-skill`：`ref/deepseek-harness/packages/client/ui-skill/src/client/index.ts:123`；`ui-commands`：`ref/deepseek-harness/packages/client/ui-commands/src/client/service.ts:103`；`ui-goal`：`ref/deepseek-harness/packages/client/ui-goal/src/client/index.ts:117` |
| R4 | 块挂载时 `retain`，卸载时 `release` | 框架，每个块一份引用 | 违反 | `ui-sidebar-right`：`ref/deepseek-harness/packages/client/ui-sidebar-right/src/client/session-view.ts:33` |

**选 R1 的理由。**

- 宿主对 `inject` 的约定就是“业务数据通过 apply 闭包里的 ctx 取，没有 binding 对象参数”（`ref/deepseek-harness/packages/client/ui-slots/src/index.ts:596-632` 的注释和 `InjectParams`，session 作用域只传 `sessionId`）。R1 照这个约定走。
- 条目能渲染，说明 `binding` 此刻存在；`ISessions.binding` 的契约是“借用已被持有的绑定，不延长生命周期，没有就返回 `undefined`”（`ref/deepseek-harness/packages/api/session-controller/src/client/contract/sessions.ts:148-167`；已安装类型 `.../contract/sessions.d.ts:155-159`）。
- 出错面窄：R1 的 `inject` 抛错只让这个块显示错误卡（逐条目错误边界，`docs/research/alpha2-facts.local.md` §8）；R2 的 `resolve` 抛错会让 `provide` 回滚，影响全页所有 session 条目的装配（`ref/deepseek-harness/packages/client/ui-session/src/client/index.ts:386-407,437-453`）。
- R2 还会给宿主里所有 session 条目加一个全局标准 prop，并在框架卸载时触发整页 `rebuildBindings`；R1 只影响我们自己的块。R2 的好处是 `resolve` 直接拿到 `binding`，不用查表；若以后发现 R1 的查表有问题，R2 是现成的退路，适配器内部换路，契约不变。
- R3 / R4 需要在框架里写 `retain` 并声明来源标签，且改变 K5。R4 还多出“漏释放”这一类 bug。

**R1 依赖的前提。** R1 依赖“块在渲染时它的 `binding` 仍被某个引用持有”。这一点由宿主保证：session 条目只在 `binding.key !== undefined` 时渲染（`scoped-slots.tsx:1039-1043`），而 `bindingSource` 只接受仍在控制器里活跃的引用（`ref/deepseek-harness/packages/client/ui-session/src/client/index.ts:353-361`）。未在宿主上验证。

### 动作怎么写

```ts
// 在已安装的 0.2.2-alpha.2 类型上通过 tsc；不等于宿主行为
async function send(sessions: ISessions, id: SessionId, bound: SessionBinding, text: string): Promise<boolean> {
  try {
    if (text.trim() === '' || sessions.binding(id) !== bound) return false
    const result = await bound.session.prompt([{ type: 'text', text }], 'queue')
    return result.ok
  } catch {
    return false
  }
}
```

`stop` 同形，调 `bound.session.cancel()`。几处取舍：

- **过期检查**：`inject` 时捕获 `bound`，调用时再比一次 `sessions.binding(id) === bound`。`SessionBinding` 是“身份稳定的逻辑绑定”（`.../sessions/service.ts` 的注释，已安装类型 `service.d.ts:82`），`ui-session` 自己也用 `sessions.binding(id) !== owner` 判断引用是否仍活跃（`ref/deepseek-harness/packages/client/ui-session/src/client/index.ts:357-359`）。比不上就返回 `false`，不向一个已经结束的世代发请求，也不向同 id 的新世代发。
- **`PromptContentPart`**：只发一个文本块 `{ type: 'text', text }`（类型：`ref/deepseek-harness/packages/api/session-controller/src/types.ts:77-86`）。`prompt` 的参数是可变数组 `PromptContentPart[]`（`session.ts:98` 一带，已安装类型 `session.d.ts:93`），所以每次现造数组字面量，不要传 `readonly` 数组。包是否导出 `PromptContentPart` 不影响：字面量按结构对得上，适配器不必 import 它。
- **`mode` 选 `'queue'`**。宿主文档：`'queue'` 追加一个回合，`'steer'` 打断正在跑的回合（`ref/deepseek-harness/packages/api/session-controller/src/client/contract/session.ts:93`）。`ui-conversation` 的无附件 `send` 也是 `'queue'`（`.../ui-conversation/src/client/service.ts:211`）。块的“发送”不应在用户不知情时打断正在运行的回合。需要 steer 的块以后再加可选参数（加性）。
- **空白文本不发**：宿主要求请求里“至少有一个非空白文本块或附件”（`ref/deepseek-harness/packages/api/session-controller/src/types.ts:326`）。适配器对纯空白文本直接返回 `false`，不调宿主，免得宿主把失败记进 `snapshot.promptError`。宿主对空白文本的实际响应未在宿主上验证。
- **不调 `beginSubmission`**：宿主的本地回显（`pendingSubmissions`）是给 `ui-conversation` 的输入框用的（`session.ts:63-86`）。框架没有会话界面，不需要；代价是自己发的消息要等宿主的 Inbox 行或 `user/message` 事件才出现在任何会话视图里。
- **`AbortSignal`（遵守 `PRINCIPLES.local.md` §2.3“组件卸载时取消在途请求”）**：
  - `prompt` 的第三个参数是可选的 `signal`（已安装类型 `session.d.ts:93`，注释“caller cancellation for the complete admission round-trip”，ref `session.ts:93-98`）。**`cancel()` 没有参数**（已安装类型 `session.d.ts:119`，ref `session.ts:124`），传不了 signal。
  - 每个**挂载的块**一个 `AbortController`，由包装组件（U3）在挂载的 effect 里创建、在卸载的清理里 `abort()`。主会话切换（条目按 `binding.ctx` 代数重挂）与块注销（条目离开账本）对包装组件来说都是卸载，所以一处清理覆盖两种情形。控制器放在 effect 里创建、用 ref 读取，不放进 `useMemo`：React 18 的 StrictMode 在开发模式会重放 effect，放进 `useMemo` 会让第二次挂载拿到已 abort 的控制器（读 React 文档得知，未在宿主上验证）。
  - 适配器的动作按 `SessionBinding` 缓存，同一绑定上的多个块共享，所以 signal **不能存在缓存的动作里，要逐次传入**：适配器内部是 `send(text, signal)` / `stop(signal)`，契约上的 `session.send(text)` / `stop()` 由包装组件绑定本次挂载的 signal。
  - 被 abort 时：`send` 把 signal 传给 `prompt`，并与 abort 事件竞速，保证 Promise 落定，结果是 `false`，不抛；`stop` 的 `cancel()` 不能取消，只与 abort 事件竞速，同样落定为 `false`——此时宿主可能仍会接受这次取消，因为停止是用户明确的意图，不去撤销已发出的请求，块已卸载，没有人会用这个返回值。调用时 signal 已经 aborted，直接返回 `false`，不调宿主。
  - **新的 `send` 不取消在途的旧 `send`**，`stop` 同理。§2.3 前半句（“新请求开始时取消旧请求”）针对后者取代前者的请求（搜索、拉取）；`prompt` 用 `'queue'` 是追加一个回合，两条消息都应送达，取消前一条就会丢掉用户的消息。这是对 §2.3 前半句的有意不适用，PR 描述里要写明。
  - 风险：点发送后立刻切会话，abort 可能发生在宿主接受消息之前或之后，`send` 返回 `false` 时宿主可能其实已收到。宿主是否尊重这个 signal、取消后消息是否已送达，未在宿主上验证。

### `RemoteResult` 与抛错映射成 `false`

`RemoteResult<T>` 是 `{ ok: true, value } | { ok: false, error }`；宿主的 Remote 面把载体层失败也折进 `error` 分支，只有装配错误（参数个数、方法未挂载、缺 Context 适配）才会 reject（`ref/deepseek-harness/packages/typert/protocol/src/types.ts:123-132`）。

| 宿主结果 | 返回 | 说明 |
| --- | --- | --- |
| `{ ok: true, value: { accepted: true } }` | `true` | 宿主接受 |
| `{ ok: false, error }` | `false` | 宿主拒绝；宿主还会把它写进 `snapshot.promptError`（`session.ts:96` 的 `@returns`；`SessionSnapshot.promptError`，`snapshot.ts:84`），契约现在不暴露它 |
| `prompt` / `cancel` reject 或同步抛错 | `false` | `catch` 吞掉，用 `console.warn` 打一次，带 `LOG_PREFIX`，**不打印消息文本** |
| 过期绑定、空白文本、调用时 signal 已 aborted | `false` | 不调宿主 |
| 在途时 signal 被 abort（块卸载、切会话、注销） | `false` | 不抛。`send` 把 signal 传给 `prompt` 并与 abort 竞速，`stop` 只竞速（`cancel()` 无 signal） |

`send` / `stop` 返回的 `Promise<boolean>` 永不 reject，这是 AC5 的字面要求，U2 用表驱动测试覆盖上表各行。

两件事未在宿主上验证，写进 U2 的假绑定里按“宿主接受 / 拒绝 / 抛错 / 永不返回”四种替身测，但真实行为要在 U4 的人工验收里看一次：

- 会话没有在跑时调 `cancel()`，宿主是接受还是返回 `ok: false`（本文按宿主怎么答就怎么映射，不替宿主判断）。
- 主会话在 `prompt` 请求在途时被切走，宿主侧这个 Promise 会 resolve、reject 还是一直挂着，以及宿主是否尊重传入的 signal。框架这一侧已经定下：块卸载时 abort，并与 abort 事件竞速，所以 `send()` 一定落定为 `false`，不会悬挂（U2 A9、U3 A9）；没定的只是宿主那一半——消息最终有没有送达、宿主有没有及时放掉请求。

### 备选：`retain` / `using` 与 `SessionReferenceSource` 的声明

只在选 R3 / R4 时需要，目前不采用。`retain` / `using` 的 `options.source` 必须是 `SessionReferenceSource` 的成员，这个类型是 `SessionReferenceSourceMap` 的键（已安装类型 `node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/client/index.d.ts:17-25`），宿主各插件用声明合并加自己的标签：

```ts
declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** A framework send / stop call holding a session for its duration. */
    webuiSessionAction: unknown
  }
}
```

宿主写法的位置：`ui-skill` `ref/deepseek-harness/packages/client/ui-skill/src/client/index.ts:56-61`（`skillCatalog`）、`ui-commands` `.../ui-commands/src/client/service.ts:38-43`（`commandCatalog`）、`ui-sidebar-right` `.../ui-sidebar-right/src/client/session-view.ts:5-9`（`sidebarView`）、`ui-workspace` `.../ui-workspace/src/client/index.ts:84-89`（`workspaceOperation`）、`ui-goal` `.../ui-goal/src/client/index.ts:44-50`（`goalActivation`）、测试夹具 `ref/deepseek-harness/packages/test-support/client-runtime/src/sessions.ts:24-31`。`ui-session` 自己声明了 `mainView`（`.../ui-session/src/client/index.ts:189-193`；已安装类型 `ui-session/.../index.d.ts:101-105`）。

注意：标签名**绝不能用 `mainView`**，否则这次调用会被 `ui-session` 当成主会话的持有者，`publishMain` 把当前绑定换成它（`.../ui-session/src/client/index.ts:460-474`）。声明合并放在适配器模块里（框架内部，不进契约）。

## 引用的生命周期

按 R1，框架不取得、也不释放任何宿主引用。下表把框架持有的每样东西、何时得到、何时放掉列清楚：

| 东西 | 何时取得 | 何时释放 | 泄漏风险 |
| --- | --- | --- | --- |
| 宿主的 `mainView` 引用 | 不取得，由路由插件持有（K5） | 路由插件切换时 | 不属于框架 |
| `SessionBinding`（借用） | 条目 `inject` 运行时，每个“条目 × 标准源对象”一次（缓存：`scoped-slots.tsx:261-273`） | 无显式释放；闭包随条目子树和 `WeakMap` 键一起被回收 | 没有：不阻止宿主拆掉世代 |
| 派生状态源、动作对象 | 按 `SessionBinding` 缓存在 `WeakMap` | 绑定被回收时 | 没有 |
| 对宿主的订阅 | 块组件挂载、uSES 订阅时 | 卸载时 uSES 调 `session.subscribe` 返回的退订 | 没有常驻订阅 |
| 每次挂载的 `AbortController`（包装组件持有） | 包装组件挂载的 effect 里 | 卸载的清理里 `abort()`，覆盖主会话切换与块注销 | 没有：清理必走；StrictMode 重放 effect 时重新创建 |
| 在途 `send` / `stop` 的 Promise | 调用时 | 落定时；卸载时 abort 使其落定为 `false`；新的 `send` 不取消旧的（§2.3 前半句有意不适用，理由见上一节） | 没有悬挂；宿主侧请求是否被放掉未在宿主上验证 |

### 主会话切换

时间线（读源码得知，未在宿主上验证）：

1. 路由插件先 `retain(新, { source: 'mainView' })`，再释放旧引用（宿主自己的顺序：`ref/deepseek-harness/packages/client/ui-workspace/src/client/navigation.ts:524-540`）。
2. `ui-session` 在列表变化时 `publishMain`，把 `adapter.current` 换成新绑定并通知订阅者（`ref/deepseek-harness/packages/client/ui-session/src/client/index.ts:460-474`）。
3. `SessionProvider` 订阅这份 current（`scoped-slots.tsx:512-526`），session 条目的错误边界以 `sessionGenerationKeyOf(binding)`，即 `binding.ctx` 的代数，作 React `key`（`scoped-slots.tsx:382-394,1047`；`docs/research/alpha2-facts.local.md` §7）。`ctx` 换了，`key` 换了，旧子树整块卸载、新子树整块挂载。
4. 我们的包装组件在条目里面，随条目一起卸载、挂载一次；新条目的 `inject` 以新 `binding` 跑一次，得到新的源和动作。块因此“照旧重挂一次，不多不少”（AC4）。旧包装组件卸载时清理 abort 它的 `AbortController`，旧块在途的 `send` / `stop` 随之落定为 `false`。

`rebuildBindings` 只换 `StandardSourceBinding`，不换 `ctx`，所以不会重挂（见 `## 读会话状态` 末段）。

### 块注销

块的 `owner.effect` 在贡献者插件卸载或块注销时取消槽位注册（`src/client/services/block-registry.ts:198-221`），条目离开账本，渲染器卸载它的子树。唯一要放掉的是包装组件的 `AbortController`，它在包装组件卸载的清理里 abort，注销路径上不需要另加任何东西。

### 包装组件的身份

三层身份各自怎么稳：

1. **组件类型**：在 `registerBlock` 里为 session 块创建一次包装组件，与今天的 `asFunctionComponent`（`block-registry.ts:73-75,161`）同位置同寿命，`retry` 时的 `remount()` 用同一个组件重新注册（`block-registry.ts:175-178`）。**绝不能在 `App.renderBlock`、`DockView` 或包装组件自己的渲染里新建包装组件**，否则外层每次重渲染都会让 React 当作新类型而重挂块。AC4 的“同一次注册里块不会因为外层重渲染而被重挂”测的就是这一层。
2. **`session` 对象**：包装组件用 `useMemo`，依赖是 `[sessionId, useWebuiSession, actions]`，三者都是按条目、按绑定稳定的，所以块每次渲染拿到同一个 `session`。
3. **`inject` 的产出**：渲染器按“条目 × 标准源对象”缓存；我们再按 `SessionBinding` 缓存，覆盖 `rebuildBindings` 之后重跑的情形。

注册 session 块时的形状（示意）：

```ts
owner.slots.register(
  { name: slotKey, id: meta.id, priority: meta.priority, label: meta.title.en, inject: sessionInjectFor(meta.id) },
  bridge, // 在这里创建一次
)
```

`inject` 的类型要求组件 props 带上注入面（`ComposedProps`，`node_modules/@deepseek-ai/dsh-client-ui-slots/lib/types/index.d.ts:806-808`），`block-registry` 里需要一处类型收口（现有代码对 `BlockComponent` 也有同类处理）。这是 U3 的一个编译风险，不是语义问题。

### 没有主会话时的验收

K5 决定了框架不持有 `mainView`；`ui-workspace` 被关后，仓库里没有任何插件会持有它。所以 AC8 的“在真实宿主上切换主会话后显示跟着变”，需要验收者在 profile 里装一个临时探针插件，它调用 `ctx.sessions.retain(id, { source: 'mainView' })`、先取新再放旧。这是 `session-and-overlay.md` 里探针做法的同一类，探针不进仓库。这一点作为 finding 汇报，U4 的人工验收说明里写明。

## 宿主 API 变化时改哪里

**只改 `src/client/services/session-adapter.ts`。** 这个模块是框架里唯一知道宿主会话形状的地方，包含：

1. 对宿主类型的 `import type`（`@deepseek-ai/dsh-api-session-controller/client` 的 `ISessions`、`SessionBinding`、`SessionSnapshot`，`@deepseek-ai/dsh-client-ui-slots` 的 `HostObservable`）。这两个包都不是本仓库的直接 devDependency，经 `dsh-client-ui-session` / `dsh-web-app` 传递安装，与 `src/client/features/layout.ts` 里对 `dsh-client-ui-settings/client` 的做法一致；不新增依赖。
2. `toState` / `sameState`：快照字段到 `WebuiSessionState` 的映射。
3. `send` / `stop`：到 `prompt` / `cancel` 的转换，`RemoteResult` 与抛错到 `boolean`。
4. 拿到 `SessionBinding` 的方式（现在是 `ctx.sessions.binding`）。
5. `inject` 的产出形状（`hooks.webuiSession` 与动作）和包装组件，即 `bridgeSessionBlock(component)`。

`block-registry.ts` 只调用适配器导出的两样东西：`bridgeSessionBlock` 和 `sessionInjectFor`（具体名字由 U2/U3 定，不影响结论）。

| 宿主变了什么 | 改哪里 | 契约、示例、其他模块 |
| --- | --- | --- |
| 快照字段改名 / 拆分 / 新增 | `toState`、`sameState` | 不动；新增字段不暴露就不影响任何人 |
| `OpenState` 增加取值 | `toState`（编译失败提醒） | 不动，除非决定暴露新值（那是契约升版） |
| `prompt` 参数、`PromptContentPart` 形状、`mode` 取值变化 | `send` | 不动 |
| `cancel` 换名或换签名 | `stop` | 不动 |
| `RemoteResult` 形状变化 | `send` / `stop` 的结果映射 | 不动 |
| 借 `binding` 的方式变化（例如 `ctx.sessions.binding` 被替换） | 第 4 项；必要时切到 R2（`uiSession.provide`） | 不动 |
| 标准源、`inject` 的机制变化 | 第 5 项 | 不动 |

**让“只在一个模块里”可被自动检查（AC6 的 guard 部分）。** U2 加一条 ESLint 限制：`src/**` 中除 `session-adapter.ts` 及其测试外，禁止 import `@deepseek-ai/dsh-api-session-controller*`。`eslint.config.js` 里 `no-restricted-imports` 已在两个块里各写一份（`:83`、`:97`），同一规则在 flat config 里按块整体替换，所以新的限制要加进每个适用的块；核心规则是否拦 `import type` 未核实，不拦时改用 `@typescript-eslint/no-restricted-imports`。再在 `scripts/` 下加一个小测试，扫描 `src/` 与 `contract/`，断言宿主会话类型只出现在适配器里。现有的 `scripts/source-guards.test.ts` 只管值导入（A1），不管类型导入，所以需要新增，不能指望它顺带覆盖。测试里用替身换一种会话形状（比如 `prompt` 改名、快照字段改名）验证：只改适配器及其测试夹具，契约、示例和契约类型测试全部不变。

## 契约草案与单元拆分

### 契约草案

在 `contract/index.d.ts` 里。下面是相对 0.2.0 的改动（不 import 任何 `@deepseek-ai/*`）：

```ts
interface BlockMetaBase {
  id: string
  /** Blocks are ordered by `priority` ascending, ties by `id` in code-point order: lower comes first. */
  priority: number
  title: LocalizedText
  closable: boolean
  multiInstance: boolean
  defaultSize?: LayoutSize
}

/** A block shown once for the whole page; its component takes `BlockInstanceProps`. */
export interface RootBlockMeta extends BlockMetaBase {
  scope: 'root'
}

/** A block shown for the current main session; its component takes `SessionBlockProps`. */
export interface SessionBlockMeta extends BlockMetaBase {
  scope: 'session'
}

/** Static description of a block, given once at registration; `scope` decides the component type. */
export type BlockMeta = RootBlockMeta | SessionBlockMeta

/** The part of the host's session state a block may read. */
export interface WebuiSessionState {
  sessionId: string
  running: boolean
  blank: boolean
  removed: boolean
  openState: 'cold' | 'loading' | 'open' | 'error'
  lastAgentError: string | null
}

/** The current main session as a block sees it; the same object for the same session across renders. */
export interface WebuiSession {
  readonly sessionId: string
  /**
   * A hook: call it while rendering, in the same order every render. The block re-renders only when the selected
   * value changes, by `Object.is` or by `equal` when given.
   */
  useState<T>(select: (state: WebuiSessionState) => T, equal?: (a: T, b: T) => boolean): T
  /** Sends `text` to the session; `true` when the host accepted it, `false` when it refused, threw or the session is gone. Never rejects. */
  send(text: string): Promise<boolean>
  /** Stops the running turn; `true` when the host accepted it, `false` otherwise. Never rejects. */
  stop(): Promise<boolean>
}

/** Props a `session`-scope block receives. */
export interface SessionBlockProps extends BlockInstanceProps {
  session: WebuiSession
}

export type BlockComponent = ComponentType<BlockInstanceProps>

/** The component type a block of `M`'s scope takes. */
export type BlockComponentOf<M extends BlockMeta> = ComponentType<
  M extends SessionBlockMeta ? SessionBlockProps : BlockInstanceProps
>

export interface WebuiLayoutService {
  registerBlock<M extends BlockMeta>(meta: M, component: BlockComponentOf<M>): Disposer
  registerPreset(preset: LayoutPreset): Disposer
}
```

文件头注释里“宿主标准 props 不在这里重新声明”那段要改：session 块读会话请用 `props.session`，不要再去读宿主 props。

**已在副本上验证的类型行为**（临时副本在 `/tmp/wl-Task_13_1-impl/`，用本仓库的 `typescript`、`@types/react`，用完已删除）：

- 通过：`scope: 'root'` 配 `ComponentType<BlockInstanceProps>`；`scope: 'session'` 配 `ComponentType<SessionBlockProps>`；`scope: 'session'` 配只要 `BlockInstanceProps` 的组件（props 逆变，更少的要求仍然可以）；类型为联合 `BlockMeta` 的变量配只要 `BlockInstanceProps` 的组件。
- 编译失败（`@ts-expect-error` 全部命中）：`scope: 'root'` 配 `ComponentType<SessionBlockProps>`；`scope: 'oops'`；联合类型的 `meta` 变量配 `ComponentType<SessionBlockProps>`。
- 同一份草案套在本仓库副本上：`npm run typecheck` 的两份配置（`tsconfig.json`、`tsconfig.node.json`，后者含全部现有测试）都通过，唯一需要改的产品代码是 `WebuiLayout.registerBlock`（`src/client/services/block-registry.ts:326`）的签名，要改成与服务接口同形的泛型，并在内部转交给注册表时做一次类型转换。现有测试里的 `Partial<BlockMeta>`、`BlockMeta['scope']` 都不受影响。

**为什么用一个泛型签名，不用两个重载。** 两个重载（`RootBlockMeta` 配根组件，`SessionBlockMeta` 配会话组件）在副本里同样通过了上面的字面量用例，但当 `meta` 是联合类型的变量时两个重载都不匹配，连根组件也不能注册；泛型签名在这种情况下要求组件同时接受两种 props，即只要 `BlockInstanceProps` 的组件，行为更合理。

**AC1 的措辞需要澄清。** 现有契约末尾有 `declare module '@deepseek-ai/cordis' { interface Context { webuiLayout: WebuiLayoutService } }`（`contract/index.d.ts` 最后一段）。这是模块扩充，不是 `import`；它让 `ctx.webuiLayout` 有类型，不能去掉。因此 AC1 的自动检查应写成“契约里没有 `import … from '@deepseek-ai/…'` 语句”（用 TS 语法树找 `ImportDeclaration` / `ImportType`），不能写成“文件里没有字符串 `@deepseek-ai`”。

**0.3.0 的不兼容之处（CHANGELOG 要写）。**

- `BlockMeta` 变成按 `scope` 区分的联合（`RootBlockMeta | SessionBlockMeta`）。
- `registerBlock` 的组件类型随 `meta.scope` 而定：`'session'` 要求 `ComponentType<SessionBlockProps>`，`'root'` 要求 `ComponentType<BlockInstanceProps>`。因此把 `ComponentType<SessionBlockProps>` 注册为根块，或把联合类型的 `meta` 变量配会话组件注册，以前不被检查，现在编译失败。
- 新增 `WebuiSessionState`、`WebuiSession`、`SessionBlockProps`、`RootBlockMeta`、`SessionBlockMeta`、`BlockComponentOf`。
- session 块不再需要读宿主的标准 props 取得会话。

### 单元拆分

Task_13_1 之后还剩四个 unit。依赖：U1 → U2 → U3 → U4（U2 只依赖 U1 的类型，U3 依赖 U1、U2）。每条验收标准标了 `auto`（脚本或测试判真假）、`guard`（lint 或源码扫描）、`human`。

**U1：契约 0.3.0。**

- 目标：契约导出会话类型，`BlockMeta` 按 `scope` 可判别，`registerBlock` 的组件类型随 `scope`，版本、CHANGELOG、契约锁同步。
- 范围：modify `contract/index.d.ts`、`contract/lock.json`、`CHANGELOG.md`、`package.json`、`package-lock.json`（仅 `version` 两处，同 Task_9_2 的做法）、`src/client/services/block-registry.ts`（仅 `WebuiLayout.registerBlock` 的签名）；create 无；forbid `examples/`、`src/ui/`、`src/client/entries/`、`cordis.patch.yml`。
- 验收：
  - A1 (auto) 契约导出 `WebuiSessionState`（六个字段，`openState` 为 `'cold' | 'loading' | 'open' | 'error'`）、`WebuiSession`（`sessionId`、`useState`、`send`、`stop`）、`SessionBlockProps`；用 TS 语法树断言契约里没有 `@deepseek-ai/*` 的 `import` 语句（模块扩充 `declare module '@deepseek-ai/cordis'` 除外）。
  - A2 (auto) 类型测试（在 `scripts/contract.test.ts` 的编译夹具上扩展）：`scope: 'session'` 配 `ComponentType<SessionBlockProps>` 与 `scope: 'root'` 配 `ComponentType<BlockInstanceProps>` 编译通过；`scope: 'root'` 配 `ComponentType<SessionBlockProps>` 编译失败；`scope: 'oops'` 编译失败。
  - A3 (auto) `scripts/contract-lock.ts` 校验通过：`package.json` 版本、`CHANGELOG.md` 里 `## 0.3.0` 标题、`contract/lock.json` 的哈希三者一致。
  - A4 (human) CHANGELOG 的 0.3.0 一节写明“`scope` 与组件类型联动、`BlockMeta` 变联合”这一不兼容之处，并列出新增的类型。
  - A5 (auto) `npm run gate` 全绿（含 `tsc` 两份配置）。

**U2：会话适配器。**

- 目标：一个适配模块，把宿主 `SessionBinding` 翻成契约类型：派生状态源（六字段、对象稳定）、`send` / `stop`（`RemoteResult` 与抛错映射成 `boolean`）、`inject` 产出。不接入注册表。
- 范围：create `src/client/services/session-adapter.ts`、`src/client/services/session-adapter.test.ts`；modify `eslint.config.js`（限制宿主会话类型只能在适配器里 import）、`scripts/`下新增一个源码扫描测试；forbid `contract/`、`examples/`、`src/ui/`、`src/client/entries/`、`src/client/services/block-registry.ts`。
- 验收（测试用假 `SessionBinding`：带 `getSnapshot` / `subscribe` / `prompt` / `cancel` 的普通对象）：
  - A1 (auto) 状态映射：每个字段取自快照对应字段；宿主快照里不相关字段（如 `pendingSubmissions`、`hasMore`）变化后，状态源返回**同一个对象**，六个字段之一变化后返回新对象；同一份快照连续读返回同一个对象。
  - A2 (auto) 同一个 `SessionBinding` 两次取源、取动作得到同一个对象；不同 `SessionBinding` 得到不同对象。
  - A3 (auto) `send`：宿主 `{ ok: true }` → `true`；`{ ok: false }` → `false`；`prompt` 同步抛错、reject → `false` 且不抛；纯空白文本 → `false` 且宿主未被调用；绑定已过期（`sessions.binding(id)` 返回另一个对象或 `undefined`）→ `false` 且宿主未被调用；调用 `prompt` 时参数是 `[{ type: 'text', text }]` 和 `'queue'`。
  - A4 (auto) `stop`：同 A3 的结果映射，调的是 `cancel`。
  - A5 (auto) 状态映射遇到契约不认识的 `openState` 时的行为固定（建议 `'error'` 并警告一次）。
  - A6 (guard) 宿主会话类型（`@deepseek-ai/dsh-api-session-controller*`）只在适配器及其测试里被 import；扫描测试在 `src/` 与 `contract/` 上通过，并有一个用例证明在别处加这个 import 会被报告。
  - A7 (human) 换形状评审：用另一种宿主形状的替身（例如 `prompt` 改名、快照字段改名）只修改适配器的映射函数与测试夹具，契约类型测试与示例测试不变；PR 描述里用 `git diff --stat` 写明改动只在适配器及其测试夹具里（自动部分是 A6）。
  - A9 (auto) 取消：适配器的 `send(text, signal)` / `stop(signal)` 逐次接收 signal。`send` 把同一个 signal 作为第三个参数传给 `prompt`；signal 已 aborted 时返回 `false` 且宿主未被调用；`prompt` 永不落定的替身上，abort 后 `send` 落定为 `false`，不抛。`stop`：`cancel` 被调用时没有参数；`cancel` 永不落定的替身上，abort 后 `stop` 落定为 `false`，不抛。
  - A10 (auto) 不互相取消：连续两次 `send`（各带自己的 signal）都调用 `prompt`，第二次不 abort 第一次的 signal，两次各自按宿主结果落定；`stop` 同理。
  - A11 (auto) `npm run gate` 全绿。

**U3：把适配器接入注册表。**

- 目标：session 块在注册时由框架包一层，收到 `session` prop；根块原样注册；包装组件身份稳定；框架新增一个依赖 `sessions` 服务的 feature 提供适配器。
- 范围：modify `src/client/services/block-registry.ts`、`src/client/services/dock-state.ts`（如需存放适配器）、`src/client/features/index.ts`；create `src/client/features/session.ts`（`inject: ['sessions']`）及其测试，`src/client/services/block-registry.test.ts` 追加用例；forbid `contract/`、`examples/`、`src/ui/`、`src/client/entries/`。
- 验收：
  - A1 (auto) 注册 `scope: 'session'` 的块后，`slots.register` 收到的组件是包装组件且带 `inject`；渲染它（测试里手工注入 `useWebuiSession` 与动作）时，块收到的 `props.session.sessionId` 等于 `inject` 参数里的会话 id，`blockId` / `contentId` / `active` / `layout` / `tab` / `view` 原样透传。
  - A2 (auto) 块读 `props.session.useState(s => s.running)`，宿主快照里 `running` 变化时块的值随之变化，不相关字段变化时块的渲染次数不变。
  - A3 (auto) 同一次注册里，外层重渲染（给包装组件传新对象 props）不会重挂块（块内 mount 计数不变）；`registry.remount(blockId)` 仍按原样重新注册并重挂一次。
  - A4 (auto) `scope: 'root'` 的块原样注册（组件函数身份不变、没有 `inject`），与改动前行为一致。
  - A5 (auto) 类组件的 session 块也能收到 `session`。
  - A6 (auto) 没有适配器可用（`sessions` 服务缺失，feature 没激活）时，session 块不让页面崩溃：显示逐条目错误卡，其余块照常。
  - A7 (auto) 贡献者插件卸载后，session 块的槽位条目和 `blocks()` 里的登记都被撤销，没有残留订阅（对假 `session` 的 `subscribe` 计数断言）。
  - A9 (auto) 取消的归属在这里，不在 U2：`AbortController` 由包装组件的挂载 effect 创建、卸载清理里 abort，只有包装组件知道何时卸载，适配器不知道。测试：渲染包装组件、块调用 `props.session.send(text)` 使宿主替身的 `prompt` 永不落定，`unmount` 后该 Promise 落定为 `false`，且 `prompt` 收到的 signal 为 aborted；块在卸载前拿到的 `props.session` 在多次渲染间是同一个对象，`send` 每次用当前挂载的 signal。
  - A10 (auto) StrictMode 下挂载（effect 重放一次）后，块调用 `props.session.send(text)` 仍会调用宿主的 `prompt`，传入的 signal 未被 abort；经 `registry.remount(blockId)` 重挂后同样。
  - A8 (auto) `npm run gate` 全绿。
  - 切换主会话“重挂一次、不多不少”本身由宿主的渲染器保证（`binding.ctx` 的代数作 `key`），单元测试覆盖不到，由 U4 的人工验收覆盖。

**U4：示例、文档与真实宿主验收。**

- 目标：示例的 session 块改用 `SessionBlockProps`，显示会话 id 与是否在运行，并给出发送与停止；README 写明 session 块怎么读会话；在真实宿主上验证。
- 范围：modify `examples/hello-block/src/client.tsx`、`scripts/example-session.test.ts`、`README.md`；forbid `contract/`、`src/`。
- 验收：
  - A1 (auto) 示例的 session 块组件类型是 `ComponentType<SessionBlockProps>`，只 `import type` 契约；渲染时显示 `session.sessionId`，`session.useState(s => s.running)` 为真时显示“running”；点发送/停止按钮分别调用 `session.send` / `session.stop`，结果为 `false` 时显示一条提示。
  - A2 (auto) 示例的 session 块在 `scripts/example-session.test.ts` 里按“mount #n”的现有方式验证：外层重渲染（给块传新 props）不重挂，计数不变；会话 id 与运行状态取自 `props.session`。
  - A3 (guard) 示例目录里没有对 `@deepseek-ai/dsh-client-ui-session`、`dsh-api-session-controller` 的 import（`import type` 也不允许）；示例的构建（`npm run build` 里已有的 `verify-bundle`）通过。
  - A4 (auto) `npm run gate` 全绿。
  - A5 (human) 在真实宿主（`/home/agent/dev/dsh-alpha2/dsh/bin/dsh`，`DSH_HOME` 用拷贝）上，装一个临时探针来持有 `mainView`（先取新再放旧），切换主会话后示例块显示的会话 id 与运行状态跟着变，块重挂一次；发送一条消息返回成功，运行中点停止返回成功；同时记下两个未验证项的实际行为：空闲时 `cancel()` 的答复、`prompt` 在途时切会话，宿主是否放掉请求、消息是否已送达。
  - A6 (human) PR 描述写明上面要看什么，并附 `README.md` 里 session 块一节的链接。

**Task_13 验收项覆盖。**

| Task_13 AC | 覆盖的 unit |
| --- | --- |
| AC1 契约导出与无 import | U1 A1 |
| AC2 `registerBlock` 随 scope | U1 A2 |
| AC3 `sessionId`、字段更新、不变不重渲染 | U2 A1–A2，U3 A1–A2 |
| AC4 切换重挂一次、外层重渲染不重挂 | U3 A3（外层重渲染），U4 A5（切换，人工） |
| AC5 `send` / `stop` 返回 `true` / `false`，不抛（含被取消时） | U2 A3–A4、A9–A10，U3 A9–A10 |
| AC6 翻译只在一个适配模块 | U2 A6–A7，U3（`block-registry` 只调适配器） |
| AC7 契约 0.3.0、CHANGELOG、锁 | U1 A3–A4 |
| AC8 示例改用 `SessionBlockProps` | U4 A1–A5 |

### 未在宿主上验证的结论

1. `ctx.sessions.binding(sessionId)` 在条目 `inject` 运行时一定返回当前世代的绑定（读源码得知，依据是条目只在有 scope binding 时渲染）。
2. 派生状态源的 `getSnapshot` 稳定性满足 uSES，块不会出现撕裂或无限重渲染（读 `bind.ts` 得知）。
3. 主会话切换时 session 条目恰好重挂一次（`docs/research/alpha2-facts.local.md` §7 同源；本文没有重测）。
4. `'queue'` 模式在会话运行中追加的行为，与 `cancel()` 在空闲时的答复。
5. `prompt` 在途时世代被拆掉，Promise 怎样落定。
6. 空白文本被宿主拒绝并写进 `promptError`（本文只依据类型注释）。
7. 框架代贡献者的组件做 `inject`（`hooks` 隔间加一个动作对象）在 `webui.block.session` 这个 `list` 槽位上可用。宿主里“session 作用域的 `list` 槽位 + 条目 `inject` 返回 `hooks`”有先例：`conversation.view` 在 `ref/deepseek-harness/packages/client/ui-conversation/src/client/apply.ts:396` 声明为 `{ kind: 'list', scope: 'session' }`，`ui-trajectory` 往里注册的条目 `inject(sessionId)` 返回 `hooks: { duration }`（`ref/deepseek-harness/packages/client/ui-trajectory/src/client/index.ts:85-97`）。差别是那里的 `inject` 由组件所属插件写，我们是框架替贡献者的组件写。U3 先写一个最小用例确认；如果不成立，退路是 R2，适配器内部换路，契约不变。
