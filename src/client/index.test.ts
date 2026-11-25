// @vitest-environment happy-dom
import { readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { ShortcutCommand, ShortcutContext } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { ThemeDefinition, ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { BlockMeta } from '@lllzt/dsh-webui-framework/contract'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFakeContext, type FakeContext, type FakeSlots } from '../test/fake-ctx.ts'
import { App, type AppInject } from './entries/App.tsx'
import { apply } from './index.ts'
import * as dockState from './services/dock-state.ts'
import { sessionInjectFor, stateSourceOf } from './services/session-adapter.ts'
import { WEBUI_SLOT_KEYS } from './types.ts'

const LIGHT: ThemeDefinition = { id: 'light', colorScheme: 'light', tokens: { '--bg': '#ffffff', '--text': '#111111' } }
const DARK: ThemeDefinition = { id: 'dark', colorScheme: 'dark', tokens: { '--bg': '#000000', '--text': '#eeeeee' } }

/** A resolved snapshot with the light theme active unless overridden. */
function snapshot(overrides: Partial<ThemeSnapshot> = {}): ThemeSnapshot {
  return {
    preference: 'light',
    fontSizes: { text: 14, code: 11, terminal: 12 },
    fontFamilies: { text: '', code: '', terminal: '' },
    active: LIGHT,
    themes: [LIGHT, DARK],
    revision: 1,
    ...overrides,
  }
}

describe('client apply', () => {
  it('A1 registers exactly one root entry for App and clears it on dispose', () => {
    const ctx = createFakeContext({ theme: { getTheme: () => snapshot() } })
    apply(ctx)

    const entries = ctx.slots.entries('root')
    expect(entries).toHaveLength(1)
    const entry = entries[0]
    if (entry === undefined) throw new Error('the root slot has no registration')
    expect(entry.component).toBe(App)
    expect(entry.locale).toBe('webui')
    expect(entry.options.priority).toBeUndefined()

    ctx.disposeAll()
    expect(ctx.slots.entries('root')).toHaveLength(0)
  })

  it('A5 the root registration declares the root and session block lists as children', () => {
    const ctx = createFakeContext({ theme: { getTheme: () => snapshot() } })
    apply(ctx)

    const entry = ctx.slots.entries('root')[0]
    if (entry === undefined) throw new Error('the root slot has no registration')
    expect(entry.children).toMatchObject({
      'webui.block.root': { kind: 'list', scope: 'root' },
      'webui.block.session': { kind: 'list', scope: 'session' },
    })
    ctx.disposeAll()
  })

  it('A1 the root registration also declares shell.overlay as a root list, open to registration and injection', () => {
    const ctx = createFakeContext({ theme: { getTheme: () => snapshot() } })
    apply(ctx)

    const entry = ctx.slots.entries('root')[0]
    if (entry === undefined) throw new Error('the root slot has no registration')
    const children = entry.children as Record<string, unknown>
    expect(Object.keys(children).sort()).toEqual(['shell.overlay', 'webui.block.root', 'webui.block.session'])
    expect(children['shell.overlay']).toEqual({ kind: 'list', scope: 'root' })
    // the fake only records slots.inject callbacks; the declaration is what lets a host run them
    expect(ctx.slots.spec('shell.overlay')).toEqual({ kind: 'list', scope: 'root' })
    ctx.slots.refuseUndeclared = true
    expect(() => ctx.slots.register({ name: 'shell.overlay' }, () => null)).not.toThrow()
    expect(() => ctx.slots.inject('shell.overlay', () => undefined)).not.toThrow()
    ctx.disposeAll()
  })

  it('A4 the root registration carries no store', () => {
    const ctx = createFakeContext({ theme: { getTheme: () => snapshot() } })
    apply(ctx)

    const entry = ctx.slots.entries('root')[0]
    if (entry === undefined) throw new Error('the root slot has no registration')
    expect(entry.store).toBeUndefined()
    ctx.disposeAll()
  })

  it('A2 registers the webui namespace with matching zh and en dictionaries', () => {
    const ctx = createFakeContext({ theme: { getTheme: () => snapshot() } })
    apply(ctx)

    const registration = ctx.locale.registrations.find((entry) => entry.namespace === 'webui')
    expect(registration).toBeDefined()
    if (registration === undefined) throw new Error('the webui namespace is not registered')
    expect(Object.keys(registration.dictionaries).sort()).toEqual(['en', 'zh'])
    const zh = registration.dictionaries.zh
    const en = registration.dictionaries.en
    if (zh === undefined || en === undefined) throw new Error('the webui namespace misses a dictionary')

    const zhKeys = Object.keys(zh).sort()
    expect(zhKeys.length).toBeGreaterThan(3)
    expect(zhKeys).toEqual(Object.keys(en).sort())
    for (const dictionary of [zh, en]) {
      for (const value of Object.values(dictionary)) {
        expect(typeof value).toBe('string')
        expect(value.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('client apply theme effect', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style')
    document.body.removeAttribute('style')
    document.body.removeAttribute('data-ds-dark-theme')
    for (const meta of document.head.querySelectorAll('meta')) meta.remove()
  })

  it('A6 apply applies ctx.theme.getTheme() immediately, before any event', () => {
    const ctx = createFakeContext({ theme: { getTheme: () => snapshot({ preference: 'dark', active: DARK }) } })
    apply(ctx)
    expect(document.body.style.getPropertyValue('--bg')).toBe('#000000')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    ctx.disposeAll()
  })

  it('A6 a theme/change event re-applies the emitted snapshot', () => {
    const ctx = createFakeContext({ theme: { getTheme: () => snapshot() } })
    apply(ctx)
    ctx.emit('theme/change', snapshot({ preference: 'dark', active: DARK }))
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(true)
    expect(document.body.style.getPropertyValue('--bg')).toBe('#000000')
    ctx.disposeAll()
  })

  it('A6 disposing the context leaves no presenter writes behind', () => {
    const ctx = createFakeContext({ theme: { getTheme: () => snapshot({ preference: 'dark', active: DARK }) } })
    apply(ctx)
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(true)
    expect(document.head.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1)
    ctx.disposeAll()
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(false)
    expect(document.head.querySelectorAll('meta[name="theme-color"]')).toHaveLength(0)
  })
})

type HostBinding = Parameters<typeof stateSourceOf>[0]
type HostSessions = Parameters<typeof sessionInjectFor>[0]

function bindingFor(sessionId: string): HostBinding {
  const snapshotData = {
    pendingSubmissions: [],
    hasMore: false,
    sessionId,
    running: false,
    blank: false,
    removed: false,
    openState: 'open',
    lastAgentError: null,
  }
  return {
    session: {
      getSnapshot: () => snapshotData,
      subscribe: () => () => {},
      prompt: () => Promise.resolve({ ok: true }),
      cancel: () => Promise.resolve({ ok: true }),
    },
  } as unknown as HostBinding
}

function sessionsFor(binding: HostBinding, sessionId: string): HostSessions {
  return {
    binding: (id: string) => (id === sessionId ? binding : undefined),
  } as unknown as HostSessions
}

function fakeShortcuts() {
  const commands: ShortcutCommand[] = []
  const register = (command: ShortcutCommand) => {
    commands.push(command)
    return () => {
      const index = commands.indexOf(command)
      if (index >= 0) commands.splice(index, 1)
    }
  }
  return { register, commands }
}

function createClientFake(overrides: Record<string, unknown> = {}): FakeContext {
  const ctx = createFakeContext({
    fiber: { name: 'alpha' },
    reflect: {
      provide: (name: string, value: unknown) => {
        Object.assign(ctx, { [name]: value })
        return () => {
          delete (ctx as unknown as Record<string, unknown>)[name]
        }
      },
    },
    ...overrides,
  })
  return ctx
}

function rootInjectFaceOf(ctx: FakeContext): AppInject {
  const slots: FakeSlots = ctx.slots
  const inject = slots.entries('root')[0]?.options.inject
  if (typeof inject !== 'function') throw new Error('the root registration has no inject factory')
  return (inject as () => AppInject)()
}

describe('client apply dock sharing and root isolation', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('style')
    document.body.removeAttribute('style')
    document.body.removeAttribute('data-ds-dark-theme')
    for (const meta of document.head.querySelectorAll('meta')) meta.remove()
  })

  it('A1 createFakeContext has no root property and client apply shares one dock across shell, layout, shortcuts and session', () => {
    expect('root' in createFakeContext()).toBe(false)

    const shortcutsService = fakeShortcuts()
    const binding = bindingFor('s1')
    const ctx = createClientFake({ shortcuts: shortcutsService, sessions: sessionsFor(binding, 's1') })
    expect('root' in ctx).toBe(false)

    expect(() => apply(ctx)).not.toThrow()
    expect(ctx.activePlugins).toEqual(['shell', 'layout', 'shortcuts', 'session'])

    const rootMeta: BlockMeta = {
      id: 'shared-root-block',
      scope: 'root',
      priority: 0,
      title: { zh: 'r', en: 'r' },
      closable: true,
      multiInstance: false,
    }
    ctx.webuiLayout.registerBlock(rootMeta, () => null)

    const face = rootInjectFaceOf(ctx)
    expect(face.hooks.dock.getSnapshot().blocks.map((block) => block.meta.id)).toEqual(['shared-root-block'])

    face.dockActions.open({ blockId: 'shared-root-block' })
    expect(face.hooks.dock.getSnapshot().layout.root).not.toBeNull()

    const closeCommand = shortcutsService.commands.find((command) => command.id === 'webui.tab.close')
    if (closeCommand === undefined) throw new Error('webui.tab.close was not registered')
    const resolution = closeCommand.resolve({ region: 'page', modal: null, target: null } satisfies ShortcutContext)
    expect(resolution.status).toBe('handled')
    if (resolution.status === 'handled') resolution.run()
    expect(face.hooks.dock.getSnapshot().layout.root).toBeNull()

    const sessionMeta: BlockMeta = {
      id: 'shared-session-block',
      scope: 'session',
      priority: 1,
      title: { zh: 's', en: 's' },
      closable: true,
      multiInstance: false,
    }
    ctx.webuiLayout.registerBlock(sessionMeta, () => null)
    const slots: FakeSlots = ctx.slots
    const sessionInject = slots.entries(WEBUI_SLOT_KEYS.session)[0]?.options.inject
    if (typeof sessionInject !== 'function') throw new Error('the session block has no inject factory')
    const sessionFace = (sessionInject as (sessionId: string) => { hooks: { webuiSession: unknown } })('s1')
    expect(sessionFace.hooks.webuiSession).toBe(stateSourceOf(binding))

    const error = new Error('boom')
    ctx.slots.reportEntryError(WEBUI_SLOT_KEYS.root, { options: { id: 'shared-root-block' } }, error, {
      abdicated: true,
    })
    expect(face.hooks.errors.getSnapshot().get('shared-root-block')).toEqual({ blockId: 'shared-root-block', error })
    face.retryBlock('shared-root-block')
    expect(face.hooks.errors.getSnapshot().has('shared-root-block')).toBe(false)

    ctx.disposeAll()
  })

  it('A2 createDock returns distinct instances and separate client apply calls isolate their docks', () => {
    const first: dockState.Dock = dockState.createDock()
    const second: dockState.Dock = dockState.createDock()
    expect(first).not.toBe(second)
    expect(first.registry).not.toBe(second.registry)
    expect(first.controller).not.toBe(second.controller)
    expect(first.errors).not.toBe(second.errors)

    const firstCtx = createClientFake()
    const secondCtx = createClientFake()
    apply(firstCtx)
    apply(secondCtx)

    firstCtx.webuiLayout.registerBlock(
      {
        id: 'first-only',
        scope: 'root',
        priority: 0,
        title: { zh: '1', en: '1' },
        closable: true,
        multiInstance: false,
      },
      () => null,
    )

    const firstFace = rootInjectFaceOf(firstCtx)
    const secondFace = rootInjectFaceOf(secondCtx)
    expect(firstFace.hooks.dock.getSnapshot().blocks.map((block) => block.meta.id)).toEqual(['first-only'])
    expect(secondFace.hooks.dock.getSnapshot().blocks).toEqual([])
    expect(firstFace.hooks.dock).not.toBe(secondFace.hooks.dock)
    expect(firstFace.hooks.errors).not.toBe(secondFace.hooks.errors)

    firstCtx.disposeAll()
    secondCtx.disposeAll()
  })

  it('A3 dock-state exports no dockOf and client apply never reads root or Context.root on ctx', () => {
    expect('dockOf' in dockState).toBe(false)

    const binding = bindingFor('s1')
    const form = {
      getSnapshot: () => ({ status: 'ready' as const, value: {} }),
      subscribe: () => () => {},
      set: () => Promise.resolve(true),
    }
    const ctx = createClientFake({
      theme: { getTheme: () => snapshot() },
      shortcuts: fakeShortcuts(),
      sessions: sessionsFor(binding, 's1'),
      configForms: { get: () => form },
      loader: { await: () => Promise.resolve() },
    })

    const failOnAccess = (label: string): PropertyDescriptor => ({
      configurable: true,
      enumerable: false,
      get() {
        throw new Error(`unexpected access to Context ${label}`)
      },
    })
    Object.defineProperty(ctx, 'root', failOnAccess('root'))
    const cordisRootSymbol = (Context as { root?: symbol }).root ?? Symbol.for('cordis.root')
    Object.defineProperty(ctx, cordisRootSymbol, failOnAccess('Context.root'))
    if (cordisRootSymbol !== Symbol.for('cordis.root')) {
      Object.defineProperty(ctx, Symbol.for('cordis.root'), failOnAccess('Symbol.for(cordis.root)'))
    }

    expect(() => apply(ctx)).not.toThrow()
    expect(ctx.activePlugins).toEqual(['shell', 'theme', 'layout', 'shortcuts', 'session'])
    ctx.disposeAll()
  })

  it('A3 non-test source files under src/ never mention dockOf or read root on Context', () => {
    const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
    const srcDir = join(rootDir, 'src')
    const collectSources = (dir: string): string[] => {
      const out: string[] = []
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) out.push(...collectSources(full))
        else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) out.push(full)
      }
      return out
    }
    const diskSources = collectSources(srcDir).filter((file) => !file.startsWith(join(srcDir, 'test') + '/'))
    expect(diskSources.length).toBeGreaterThan(0)

    const read = ts.readConfigFile(join(rootDir, 'tsconfig.json'), ts.sys.readFile)
    expect(read.error).toBeUndefined()
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, rootDir)
    expect(parsed.errors).toEqual([])

    const program = ts.createProgram(parsed.fileNames, parsed.options)
    const checker = program.getTypeChecker()
    const programFiles = new Map(program.getSourceFiles().map((sf) => [resolve(sf.fileName), sf]))

    for (const file of diskSources) {
      expect(programFiles.has(resolve(file)), `${relative(rootDir, file)} missing from tsconfig.json`).toBe(true)
    }

    const isCordisContextSymbol = (symbol: ts.Symbol | undefined): boolean =>
      symbol?.name === 'Context' &&
      (symbol.declarations?.some((decl) => decl.getSourceFile().fileName.includes('@deepseek-ai/cordis')) ?? false)

    const containsContextType = (type: ts.Type, seen = new Set<ts.Type>()): boolean => {
      if (seen.has(type)) return false
      seen.add(type)
      if (type.isUnionOrIntersection()) return type.types.some((member) => containsContextType(member, seen))
      if ((type.flags & ts.TypeFlags.TypeParameter) !== 0) {
        const constraint = checker.getBaseConstraintOfType(type)
        return constraint !== undefined && containsContextType(constraint, seen)
      }
      if (isCordisContextSymbol(type.getSymbol()) || isCordisContextSymbol(type.aliasSymbol)) return true
      const apparent = checker.getApparentType(type)
      return apparent !== type && containsContextType(apparent, seen)
    }

    const unwrapExpression = (expr: ts.Expression): ts.Expression => {
      let current = expr
      while (
        ts.isParenthesizedExpression(current) ||
        ts.isAsExpression(current) ||
        ts.isTypeAssertionExpression(current) ||
        ts.isNonNullExpression(current)
      ) {
        current = current.expression
      }
      return current
    }

    const isContextExpr = (expr: ts.Expression): boolean =>
      containsContextType(checker.getTypeAtLocation(expr)) ||
      containsContextType(checker.getTypeAtLocation(unwrapExpression(expr)))

    const isCordisRootSymbolFor = (expr: ts.Node): boolean =>
      ts.isCallExpression(expr) &&
      ts.isPropertyAccessExpression(expr.expression) &&
      ts.isIdentifier(expr.expression.expression) &&
      expr.expression.expression.text === 'Symbol' &&
      expr.expression.name.text === 'for' &&
      expr.arguments[0] !== undefined &&
      ts.isStringLiteralLike(expr.arguments[0]) &&
      expr.arguments[0].text === 'cordis.root'

    const isRootKeyExpression = (expr: ts.Expression): boolean => {
      if (ts.isStringLiteralLike(expr) && expr.text === 'root') return true
      const argType = checker.getTypeAtLocation(expr)
      if (argType.isStringLiteral() && argType.value === 'root') return true
      if (argType.getSymbol()?.name === 'root') return true
      return isCordisRootSymbolFor(expr)
    }

    const violations: string[] = []
    for (const file of diskSources) {
      const sf = programFiles.get(resolve(file))
      if (sf === undefined) continue
      const rel = relative(rootDir, file)
      const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && node.text === 'dockOf') {
          violations.push(`${rel}: identifier dockOf`)
        } else if (isCordisRootSymbolFor(node)) {
          violations.push(`${rel}: ${node.getText(sf)}`)
        } else if (ts.isPropertyAccessExpression(node) && node.name.text === 'root') {
          if (isContextExpr(node.expression)) {
            violations.push(`${rel}: property access ${node.getText(sf)}`)
          }
        } else if (ts.isElementAccessExpression(node)) {
          if (isContextExpr(node.expression) && isRootKeyExpression(node.argumentExpression)) {
            violations.push(`${rel}: element access ${node.getText(sf)}`)
          }
        } else if (ts.isBindingElement(node)) {
          const isRootBinding =
            (node.propertyName === undefined && ts.isIdentifier(node.name) && node.name.text === 'root') ||
            (node.propertyName !== undefined &&
              ((ts.isIdentifier(node.propertyName) && node.propertyName.text === 'root') ||
                (ts.isStringLiteralLike(node.propertyName) && node.propertyName.text === 'root') ||
                (ts.isComputedPropertyName(node.propertyName) && isRootKeyExpression(node.propertyName.expression))))
          if (isRootBinding && containsContextType(checker.getTypeAtLocation(node.parent))) {
            violations.push(`${rel}: destructuring ${node.getText(sf)}`)
          }
        } else if (
          ts.isBinaryExpression(node) &&
          node.operatorToken.kind === ts.SyntaxKind.InKeyword &&
          isRootKeyExpression(node.left) &&
          isContextExpr(node.right)
        ) {
          violations.push(`${rel}: 'in' check ${node.getText(sf)}`)
        }
        ts.forEachChild(node, visit)
      }
      visit(sf)
    }

    expect(violations).toEqual([])
  }, 30_000)
})
