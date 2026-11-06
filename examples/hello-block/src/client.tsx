import type { Context } from '@deepseek-ai/cordis'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { useEffect, useState, useSyncExternalStore } from 'react'
import type {
  BlockInstanceProps,
  LayoutPreset,
  SessionActionResult,
  SessionBlockProps,
} from '@lllzt/dsh-webui-framework/contract'

/** English `session.result.*` copy, the same strings as locale/en.json. This example has no translate handle. */
const SESSION_RESULT_EN = {
  sent: 'Sent',
  stopped: 'Stopped',
  'blank-text': 'The message was empty (blank-text)',
  'host-refused': 'The host refused (host-refused)',
  'no-session': 'The session is gone (no-session)',
  unmounted: 'The block is unmounted (unmounted)',
} as const

function sessionVerdict(result: SessionActionResult, whenOk: 'sent' | 'stopped'): string {
  return result.ok ? SESSION_RESULT_EN[whenOk] : SESSION_RESULT_EN[result.reason]
}

export const name = 'hello-block'

let notes = 0

function HelloRoot({ layout, view }: BlockInstanceProps) {
  const canUndo = useSyncExternalStore(view.subscribe, view.canUndo)
  const canRedo = useSyncExternalStore(view.subscribe, view.canRedo)
  const [open, setOpen] = useState(false)
  return (
    <div style={{ padding: 16, color: 'var(--text)' }}>
      <p>Hello from a root block.</p>
      <button type="button" onClick={() => layout.open({ blockId: 'hello.session' })}>
        Open the session block
      </button>
      <button type="button" onClick={() => layout.open({ blockId: 'hello.note', contentId: `n${++notes}` })}>
        New note
      </button>
      <button type="button" disabled={!canUndo} onClick={() => layout.undo()}>
        Undo
      </button>
      <button type="button" disabled={!canRedo} onClick={() => layout.redo()}>
        Redo
      </button>
      <button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Hello dialog" closeLabel="Close">
        <p>This dialog is the host's Modal, opened from a root block.</p>
      </Modal>
    </div>
  )
}

function HelloNote({ contentId, tab }: BlockInstanceProps) {
  const k = contentId.replace(/^n/, '')
  const [unsaved, setUnsaved] = useState(false)
  const [refused, setRefused] = useState(false)
  const [text, setText] = useState('')

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
      <textarea aria-label="Note text" value={text} onChange={(event) => setText(event.target.value)} />
      {refused && <p>Close refused: unsaved changes</p>}
    </div>
  )
}

let mounts = 0

function HelloSession({ session }: SessionBlockProps) {
  const [mount] = useState(() => ++mounts)
  const running = session.useState((state) => state.running)
  const [verdict, setVerdict] = useState<string | null>(null)
  return (
    <div style={{ padding: 16, color: 'var(--text)' }}>
      <p>Hello from a session block, mount #{mount}</p>
      <p>Session {session.sessionId}</p>
      <p>{running ? 'running' : 'idle'}</p>
      <button
        type="button"
        onClick={() => {
          void session.send('Hello from the example session block').then((result) => {
            setVerdict(sessionVerdict(result, 'sent'))
          })
        }}
      >
        Send hello
      </button>
      <button
        type="button"
        onClick={() => {
          void session.stop().then((result) => {
            setVerdict(sessionVerdict(result, 'stopped'))
          })
        }}
      >
        Stop
      </button>
      <p role="status">{verdict ?? ''}</p>
    </div>
  )
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

/** Contract version this example was compiled against. */
export const COMPILED_AGAINST = '0.4.0'

export function apply(ctx: Context) {
  // Canonical rule: isCompatibleContract in src/lib/contract-version.ts (0.x same minor, from 1.0 same major).
  // A host double that predates contractVersion has no string to compare, and registers as it did before.
  const hostVersion = ctx.webuiLayout.contractVersion
  const parts = (version: string): string[] => (/^\d+(?:\.\d+){2,}$/.test(version) ? version.split('.') : [])
  const host = typeof hostVersion === 'string' ? parts(hostVersion) : []
  const plugin = parts(COMPILED_AGAINST)
  const compatible = host[0] !== undefined && host[0] === plugin[0] && (host[0] !== '0' || host[1] === plugin[1])
  if (typeof hostVersion === 'string' && !compatible) {
    console.warn(
      `hello-block was compiled against contract ${COMPILED_AGAINST} but this framework is ${hostVersion}; not registering blocks or presets`,
    )
    return
  }
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
