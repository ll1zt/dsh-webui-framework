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

完整的可构建示例在 [`examples/hello-block`](examples/hello-block)：一个 root 块、一个 session 块、一个故意抛错的块和一个预设。示例不进发布包。

## 首版不做

- 拖拽停靠、浮动窗口
- 撤销 / 重做
- 多会话并排
- 窄窗口下的浮层
- 设置页、快捷键
- 工具卡片、会话行菜单
- 任何具体的块或预设
