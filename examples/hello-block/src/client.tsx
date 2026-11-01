import type { Context } from '@deepseek-ai/cordis'
import { useEffect, useState } from 'react'
import type { BlockInstanceProps, LayoutPreset } from '@lllzt/dsh-webui-framework/contract'

export const name = 'hello-block'

let notes = 0

function HelloRoot({ layout }: BlockInstanceProps) {
  return (
    <div style={{ padding: 16, color: 'var(--text)' }}>
      <p>Hello from a root block.</p>
      <button type="button" onClick={() => layout.open({ blockId: 'hello.session' })}>
        Open the session block
      </button>
      <button type="button" onClick={() => layout.open({ blockId: 'hello.note', contentId: `n${++notes}` })}>
        New note
      </button>
    </div>
  )
}

function HelloNote({ contentId, tab }: BlockInstanceProps) {
  const k = contentId.replace(/^n/, '')
  const [unsaved, setUnsaved] = useState(false)
  const [refused, setRefused] = useState(false)

  useEffect(() => {
    tab.setTitle({ en: `Note ${k}`, zh: `笔记 ${k}` })
  }, [tab, k])

  useEffect(() => {
    if (!unsaved) return
    tab.setCloseGuard(() => {
      setRefused(true)
      return false
    })
    return () => tab.setCloseGuard(null)
  }, [tab, unsaved])

  return (
    <div style={{ padding: 16, color: 'var(--text)' }}>
      <p>Note {k}</p>
      <label>
        <input
          type="checkbox"
          checked={unsaved}
          onChange={(event) => {
            setUnsaved(event.target.checked)
            setRefused(false)
          }}
        />
        Unsaved changes
      </label>
      {refused && <p>Close refused: unsaved changes</p>}
    </div>
  )
}

let mounts = 0

function HelloSession() {
  const [mount] = useState(() => ++mounts)
  return <div style={{ padding: 16, color: 'var(--text)' }}>Hello from a session block, mount #{mount}</div>
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
          id: 'hello.note',
          scope: 'root',
          priority: 200,
          title: { zh: '笔记', en: 'Note' },
          closable: true,
          multiInstance: true,
        },
        HelloNote,
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
