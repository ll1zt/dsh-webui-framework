# 未在宿主上验证的结论

`docs/spikes/session-adapter.md` 末节列了七条只读过源码、没在宿主上跑过的结论。宿主版本变化时，`host-diff` 的报告只列出其中没有测试锁住的条目（`需人工复核`）。`session-adapter.test.ts` 已经断言的那一条不进报告，但下面仍写了在 rc.1 上再看一眼的步骤。

验收用的宿主是 rc.1，不要用 PATH 上的 `dsh`（那是 rc.2）：

- 二进制：`/home/agent/dev/dsh-rc1/dsh/bin/dsh`（`0.2.2-rc.1`）
- 数据目录：`DSH_HOME=/home/agent/dev/dsh-rc1/home`

会改会话的步骤先拷贝数据目录，原目录不动：

```sh
cp -a /home/agent/dev/dsh-rc1/home /tmp/dsh-unverified-home
```

拷贝上的启动命令把 `DSH_HOME` 指到 `/tmp/dsh-unverified-home`。每一节里的 `DSH_HOME=/home/agent/dev/dsh-rc1/home` 是这份验收目录本身。预检用 `nix develop . -c node`，只确认已安装的 rc.1 包里那条依据还在；结论本身要在跑起来的宿主上看。

### 1. inject 时 binding 是当前世代

假设：条目 `inject` 运行时 `ctx.sessions.binding(sessionId)` 返回正在渲染的那一代绑定，不是 `undefined`，也不是同一个 id 的上一代。

归类：人工。`session-adapter.test.ts` A8 只传入一个假的 `binding`，宿主的「没有 scope binding 就不渲染条目」不在测试里。

宿主：`DSH_HOME=/home/agent/dev/dsh-rc1/home`，二进制 `/home/agent/dev/dsh-rc1/dsh/bin/dsh`。

预检：已安装渲染器仍在 `binding.key` 为空时跳过条目，并用 `binding.ctx` 做世代键。

```sh
nix develop . -c node --input-type=module -e 'import { readFileSync } from "node:fs"; const src = readFileSync("node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js", "utf8"); if (!src.includes("function sessionGenerationKeyOf(binding)") || !src.includes("binding.key === void 0")) process.exit(1); console.log("renderer still skips a session entry with no binding.key");'
```

宿主上：按文首把 home 拷到 `/tmp/dsh-unverified-home`，然后

```sh
DSH_HOME=/tmp/dsh-unverified-home /home/agent/dev/dsh-rc1/dsh/bin/dsh --profile web --no-open --host 127.0.0.1 --port 3191
```

打开日志里的 `?token=` URL。不选会话时会话区不应挂出条目；打开一个会话后会话页出现；再切到另一个会话。

观察：切过去之后页面上的会话是新的那一个，会话页只换一次，控制台没有 `session "…" is unavailable` 或 `no session binding`。

预期：`inject` 拿到的就是当前这一代，切会话后不会还显示上一个会话。

不成立：没选会话时会话页已经挂出来，或切走之后仍停在上一个会话。

### 2. 派生源 getSnapshot 稳定

假设：适配器派生状态源的 `getSnapshot` 在六个契约字段不变时返回同一个对象，因此 uSES 不会撕裂，也不会无限重渲染。

归类：`session-adapter.test.ts`。A2「returns the same state object until one of the six fields changes」锁的就是这件事：无关快照字段（`pendingSubmissions`、`hasMore`）变了，对象仍是同一个。桥接测试另外看了「无关字段不重渲染」；报告里不把这条再列成人工项。宿主上的再看只防 `bind.ts` 自己换了用法。

宿主：`DSH_HOME=/home/agent/dev/dsh-rc1/home`，二进制 `/home/agent/dev/dsh-rc1/dsh/bin/dsh`。

命令（这一条的检查）：

```sh
nix develop . -c npx vitest run src/client/services/session-adapter.test.ts -t "same state object"
```

宿主上：同样先 `cp -a /home/agent/dev/dsh-rc1/home /tmp/dsh-unverified-home`，再用 rc.1 二进制以 `--profile web --no-open --host 127.0.0.1 --port 3192` 启动。打开一个已经有消息的会话，让它翻历史或出现待发送回显（`hasMore`、`pendingSubmissions` 变化），不要改运行状态。

观察：会话页不闪、不循环重绘；滚动位置不被无关更新打掉。

预期：vitest 退出码 0；宿主上只变无关字段时块不重渲染。

不成立：A2 失败，或宿主上只翻页、只多一条待发送回显时会话页撕裂或停不下来地重绘。

### 3. 主会话切换只重挂一次

假设：切换主会话时，session 作用域的条目按 `binding.ctx` 的世代整块卸载再挂上，恰好一次。

归类：人工。适配器测试不渲染宿主槽位。桥接测试只断言「外层换了一个 props 对象不会重挂」，那是另半句，不是主会话切换。

宿主：`DSH_HOME=/home/agent/dev/dsh-rc1/home`，二进制 `/home/agent/dev/dsh-rc1/dsh/bin/dsh`。

预检：渲染器仍用 `sessionGenerationKeyOf(binding)` 做 session 条目的 React key。

```sh
nix develop . -c node --input-type=module -e 'import { readFileSync } from "node:fs"; const src = readFileSync("node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js", "utf8"); if (!src.includes("sessionGenerationKeyOf(binding)")) process.exit(1); console.log("session entries are still keyed by binding.ctx generation");'
```

宿主上：拷贝 home 之后

```sh
DSH_HOME=/tmp/dsh-unverified-home /home/agent/dev/dsh-rc1/dsh/bin/dsh --profile web --no-open --host 127.0.0.1 --port 3193
```

打开 `?token=` URL。在两个都有内容的会话之间切一次。看会话页（官方会话页即可；装了本框架时看会话块）：输入框里打的字、滚动位置应清一次，而不是闪两下，也不是原样留着。

观察：浏览器性能面板或 React 开发工具里，这一次切换对应会话子树一次卸载、一次挂载。

预期：同一次主会话切换，session 条目重挂恰好一次，会话内容换成新的那一个。

不成立：切换后内容不变（零次），或同一次切换里挂载了两次（滚动或输入被打断两回）。

### 4. queue 追加与空闲 cancel

假设：会话正在跑时用 `'queue'` 再发一条，是追加一个回合，不打断当前回合；空闲时 `cancel()` 会返回一个结果，而不是抛错或挂住。

归类：人工。A4 只断言适配器把 `'queue'` 传给 `prompt`。A5 只断言 `cancel()` 不带参数，返回值来自假绑定。宿主在跑的时候怎么排队、空闲时答 `ok: true` 还是 `ok: false`，测试都不知道。

宿主：`DSH_HOME=/home/agent/dev/dsh-rc1/home`，二进制 `/home/agent/dev/dsh-rc1/dsh/bin/dsh`。

预检：已安装客户端仍把 `queue` 写成「追加」、把 `steer` 写成「打断」。

```sh
nix develop . -c node --input-type=module -e 'import { readFileSync } from "node:fs"; const src = readFileSync("node_modules/@deepseek-ai/dsh-api-session-controller/lib/client.js", "utf8"); if (!src.includes("queue appends after the current turn; steer interrupts it")) process.exit(1); console.log("queue still appends; steer still interrupts");'
```

宿主上：拷贝 home 之后用 rc.1 二进制启动 `--profile web --no-open --host 127.0.0.1 --port 3194`，打开 `?token=` URL。先发一条要跑一会儿的消息，跑起来之后再发第二条；等两条都结束后，在空闲的会话上点停止。

观察：第二条是否排在第一条后面；空闲停止是否在几秒内结束，页面有没有未捕获异常。把停止的结果（接受还是拒绝）记下来——类型只保证有 `RemoteResult`，不保证空闲时一定 `ok: true`。

预期：正在跑时第二条追加，不打断第一条；空闲停止返回一个结果，不抛错、不挂住。

不成立：第二条把正在跑的回合打断了（那是 `steer`），或空闲停止抛错、一直转圈。

### 5. 在途 prompt 被拆世代

假设：`prompt` 还在途上时这一代绑定被拆掉（切走主会话或条目卸载），宿主那一侧的 Promise 会落定，而不是永远挂着。

归类：人工。A6 断言的是适配器自己的 Promise：信号 abort 后即便假宿主永不返回，`send` 也落成 `unmounted`。没测的是宿主那一半——请求放没放掉、消息最终到没到。

宿主：`DSH_HOME=/home/agent/dev/dsh-rc1/home`，二进制 `/home/agent/dev/dsh-rc1/dsh/bin/dsh`。

预检：客户端的 `prompt` 仍把 `signal` 传给宿主的 admission。

```sh
nix develop . -c node --input-type=module -e 'import { readFileSync } from "node:fs"; const src = readFileSync("node_modules/@deepseek-ai/dsh-api-session-controller/lib/client.js", "utf8"); if (!src.includes("result = await this.remote.session.prompt(")) process.exit(1); console.log("prompt still forwards the caller signal");'
```

宿主上：拷贝 home 之后

```sh
DSH_HOME=/tmp/dsh-unverified-home /home/agent/dev/dsh-rc1/dsh/bin/dsh --profile web --no-open --host 127.0.0.1 --port 3195
```

打开 `?token=` URL，发一条消息，在它还在转的时候立刻切到另一个会话。几秒后切回去。

观察：原会话是否还停在「发送中」；切回去之后这条消息是已经在会话里，还是明确失败。

预期：切走后几秒内原请求结束（接受或拒绝都算落定），会话不再一直停在发送中。

不成立：切走后原请求一直挂着；或者界面显示失败，但消息其实已经进了会话且没有错误。

### 6. 空白文本写入 promptError

假设：只含空白的文本被宿主拒绝，并写进快照的 `promptError`（`op: 'send'`）。适配器自己会挡掉空白、不调用宿主；这条要看的是宿主。

归类：人工。A4 断言空白文本不调用 `prompt`。类型注释是唯一依据，测试没有看到 `promptError`。

宿主：`DSH_HOME=/home/agent/dev/dsh-rc1/home`，二进制 `/home/agent/dev/dsh-rc1/dsh/bin/dsh`。用官方 `web` 配置的输入框，不要用本框架的发送：框架在调用宿主之前就返回了。

预检：网关仍拒绝没有非空白文本的 prompt，失败结果仍写到 `promptError`。

```sh
nix develop . -c node --input-type=module -e 'import { readFileSync } from "node:fs"; const src = readFileSync("node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js", "utf8"); const client = readFileSync("node_modules/@deepseek-ai/dsh-api-session-controller/lib/client.js", "utf8"); if (!src.includes("prompt content must include non-whitespace text or an attachment")) process.exit(1); if (!client.includes("op: \"send\"")) process.exit(1); console.log("blank prompt is still a gateway bad-request mirrored onto promptError");'
```

宿主上：拷贝 home 之后用 rc.1 二进制启动 `--profile web --no-open --host 127.0.0.1 --port 3196`，打开 `?token=` URL。在官方输入框里只输入空格并发送。

观察：输入框附近的错误条，以及会话里有没有出现这条空白消息。错误文本里应能看到缺少非空白内容（`prompt content must include non-whitespace text or an attachment`）。

预期：宿主拒绝这次发送，消息不进会话，失败记在 `promptError`（`op` 为 `send`）上。

不成立：空白消息被接受并出现在会话里，或拒绝了但没有错误反馈（`promptError` 仍是 `null`）。

### 7. 框架代写的 session inject

假设：框架替贡献者的组件写 `inject`（在 `hooks` 里加一个动作对象）可以挂上 `webui.block.session` 这个 `list` 槽位。宿主先例是组件自己的插件在写 `inject`，不是框架代写。

归类：人工。A8 只检查适配器返回的 `hooks.webuiSession` 和动作对象的形状。块注册测试对着假的槽位表。宿主接不接受，没有测试跑到。

宿主：`DSH_HOME=/home/agent/dev/dsh-rc1/home`，二进制 `/home/agent/dev/dsh-rc1/dsh/bin/dsh`。

预检：已安装的 `conversation.view` 仍是 session 作用域的 `list`，`ui-trajectory` 的 `inject` 仍调用 `ctx.sessions.binding(sessionId)` 并返回 `hooks: { duration }`。

```sh
nix develop . -c node --input-type=module -e 'import { readFileSync } from "node:fs"; const view = readFileSync("node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js", "utf8"); const trajectory = readFileSync("node_modules/@deepseek-ai/dsh-client-ui-trajectory/lib/client.js", "utf8"); if (!view.includes("kind: \"list\"") || !view.includes("scope: \"session\"")) process.exit(1); if (!trajectory.includes("ctx.sessions.binding(sessionId)") || !trajectory.includes("hooks: { duration }")) process.exit(1); console.log("session list inject precedent is still in the rc.1 packages");'
```

宿主上：拷贝 home 之后，在拷贝里把本仓库装进一个从 `web` 复制出来的 profile（不要改 rc.1 原目录里的 `web`），再用 rc.1 二进制启动：

```sh
DSH_HOME=/tmp/dsh-unverified-home /home/agent/dev/dsh-rc1/dsh/bin/dsh plugin --profile webui-recheck add .
DSH_HOME=/tmp/dsh-unverified-home /home/agent/dev/dsh-rc1/dsh/bin/dsh --profile webui-recheck --no-open --host 127.0.0.1 --port 3197
```

`webui-recheck` 不存在时，先 `dsh --profile webui-recheck --from-default-profile web` 再装插件。打开 `?token=` URL，打开一个会话。

观察：本框架注册在 `webui.block.session` 上的条目是否出现；控制台有没有 inject 抛错（错误卡，或 `no session binding`）。块若依赖注入的动作对象，发送或停止应能点，而不是按钮缺失。

预期：条目渲染出来，`inject` 不抛错，`hooks` 里的动作对象还在。

不成立：条目不出现、错误卡，或页面在但会话动作丢失。那就是这条不成立，退路是调研里的 R2（适配器改走 `uiSession.provide`，契约不变）。
