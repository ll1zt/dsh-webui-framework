# 调研汇总：session 适配、浮层与对话框

> 基于 `0.2.2-alpha.2` 的历史调研整合（相关契约与实现已于 `0.3.0`–`0.4.0` 合入 `main`）；末尾保留受 `host-diff` 与 `scripts/unverified.test.ts` 引用的 7 条待验证结论。

## 核心结论

1. **session 契约隔离**：契约定义 `WebuiSessionState`、`WebuiSession` 与 `SessionBlockProps`，不暴露宿主隐式标准 props，避免插件直接依赖 `@deepseek-ai/dsh-*` 会话包。
2. **借用绑定（R1）与稳定源**：在 `inject(sessionId)` 用 `ctx.sessions.binding(sessionId)` 借用当前活跃 `SessionBinding`（不 `retain`）；按 `SessionBinding` 缓存 6 字段派生状态源与动作（六字段不变则返回同一引用，退路为 `uiSession.provide` 方案 R2）。
3. **生命周期与唯一边界**：挂载期间经独立 `AbortController` 清理在途 `send`（`'queue'` 追加）/ `stop`；仅 `src/client/services/session-adapter.ts` 允许导入宿主会话类型（由 ESLint 与单测守卫）。
4. **浮层（`shell.overlay`）与对话框**：独占 `root` 且关闭 `ui-layout` 时，框架须自声明并渲染点击穿透的 `shell.overlay`（与 `ui-layout` 互斥），否则 `ui-file-drag` 等宿主插件静默失效；对话框由内容包使用宿主 seed `@deepseek-ai/dsh-client-ui-primitives` 的 `Modal`。
5. **被关闭宿主功能区分**：`ui-approval` / `ui-user-questions` / `ui-permission` 依赖会话待处理交互或输入区而非 `shell.overlay`；直接注册 `shell.overlay` 的主要为 `ui-workspace`、`ui-open-in-app`、`ui-schedule`、`ui-chat`、`ui-plugin-manager`、`ui-settings-account`、`ui-settings-general` 等的 toast / 弹层。

### 未在宿主上验证的结论

1. `ctx.sessions.binding(sessionId)` 在条目 `inject` 运行时一定返回当前世代的绑定（读源码得知，依据是条目只在有 scope binding 时渲染）。
2. 派生状态源的 `getSnapshot` 稳定性满足 uSES，块不会出现撕裂或无限重渲染（读 `bind.ts` 得知）。
3. 主会话切换时 session 条目恰好重挂一次（`docs/research/alpha2-facts.local.md` §7 同源；本文没有重测）。
4. `'queue'` 模式在会话运行中追加的行为，与 `cancel()` 在空闲时的答复。
5. `prompt` 在途时世代被拆掉，Promise 怎样落定。
6. 空白文本被宿主拒绝并写进 `promptError`（本文只依据类型注释）。
7. 框架代贡献者的组件做 `inject`（`hooks` 隔间加一个动作对象）在 `webui.block.session` 这个 `list` 槽位上可用。宿主里“session 作用域的 `list` 槽位 + 条目 `inject` 返回 `hooks`”有先例：`conversation.view` 在 `ref/deepseek-harness/packages/client/ui-conversation/src/client/apply.ts:396` 声明为 `{ kind: 'list', scope: 'session' }`，`ui-trajectory` 往里注册的条目 `inject(sessionId)` 返回 `hooks: { duration }`（`ref/deepseek-harness/packages/client/ui-trajectory/src/client/index.ts:85-97`）。差别是那里的 `inject` 由组件所属插件写，我们是框架替贡献者的组件写。U3 先写一个最小用例确认；如果不成立，退路是 R2，适配器内部换路，契约不变。
