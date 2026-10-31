import type { Context } from '@deepseek-ai/cordis'
import type { BlockInstanceProps, LayoutPreset } from '@lllzt/dsh-webui-framework/contract'

export const name = 'hello-block'

function HelloRoot({ layout }: BlockInstanceProps) {
  return (
    <div style={{ padding: 16, color: 'var(--text)' }}>
      <p>Hello from a root block.</p>
      <button type="button" onClick={() => layout.open({ blockId: 'hello.session' })}>
        Open the session block
      </button>
    </div>
  )
}

function HelloSession() {
  return <div style={{ padding: 16, color: 'var(--text)' }}>Hello from a session block</div>
}

function HelloBoom(): never {
  throw new Error('hello.boom always fails to render')
}

const PRESET: LayoutPreset = {
  id: 'hello.preset',
  priority: 100,
  layout: {
    version: 1,
    root: {
      kind: 'split',
      axis: 'row',
      sizes: [{ px: 280, min: 200, max: 480 }, { fr: 1 }],
      children: [
        { kind: 'pane', active: 0, tabs: [{ blockId: 'hello.root', contentId: '' }] },
        {
          kind: 'pane',
          active: 0,
          tabs: [
            { blockId: 'hello.session', contentId: '' },
            { blockId: 'hello.boom', contentId: '' },
          ],
        },
      ],
    },
    activePane: [1],
  },
}

export function apply(ctx: Context) {
  ctx.inject(['webuiLayout'], (ctx) => {
    const layout = ctx.webuiLayout
    const disposers = [
      layout.registerBlock(
        {
          id: 'hello.root',
          scope: 'root',
          priority: 100,
          title: { zh: '你好', en: 'Hello' },
          closable: true,
          multiInstance: false,
          defaultSize: { px: 280, min: 200, max: 480 },
        },
        HelloRoot,
      ),
      layout.registerBlock(
        {
          id: 'hello.session',
          scope: 'session',
          priority: 100,
          title: { zh: '会话块', en: 'Session block' },
          closable: true,
          multiInstance: false,
        },
        HelloSession,
      ),
      layout.registerBlock(
        {
          id: 'hello.boom',
          scope: 'session',
          priority: 200,
          title: { zh: '出错的块', en: 'Failing block' },
          closable: true,
          multiInstance: false,
        },
        HelloBoom,
      ),
      layout.registerPreset(PRESET),
    ]
    return () => disposers.forEach((dispose) => dispose())
  })
}
