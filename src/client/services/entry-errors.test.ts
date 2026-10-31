import { describe, expect, it, vi } from 'vitest'
import { EntryErrorTracker } from './entry-errors.ts'

const ROOT_KEY = 'webui.block.root'
const SESSION_KEY = 'webui.block.session'
const ABDICATED = { abdicated: true }

describe('EntryErrorTracker', () => {
  it('A1 retain drops the failures outside the set and notifies exactly once', () => {
    const tracker = new EntryErrorTracker()
    tracker.record(ROOT_KEY, { options: { id: 'X' } }, new Error('x'), ABDICATED)
    tracker.record(ROOT_KEY, { options: { id: 'Y' } }, new Error('y'), ABDICATED)
    const listener = vi.fn()
    tracker.subscribe(listener)
    const before = tracker.getSnapshot()

    tracker.retain(new Set(['X']))

    expect(tracker.failed('X')).toBeDefined()
    expect(tracker.failed('Y')).toBeUndefined()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(tracker.getSnapshot()).not.toBe(before)
    expect(tracker.getSnapshot().size).toBe(1)
  })

  it('A1 retain with a set covering every failure, or on an empty tracker, does not notify and keeps the snapshot', () => {
    const tracker = new EntryErrorTracker()
    const listener = vi.fn()
    tracker.subscribe(listener)
    const empty = tracker.getSnapshot()
    tracker.retain(new Set())
    expect(listener).not.toHaveBeenCalled()
    expect(tracker.getSnapshot()).toBe(empty)

    tracker.record(ROOT_KEY, { options: { id: 'X' } }, new Error('x'), ABDICATED)
    listener.mockClear()
    const before = tracker.getSnapshot()

    tracker.retain(new Set(['X', 'extra']))

    expect(listener).not.toHaveBeenCalled()
    expect(tracker.getSnapshot()).toBe(before)
    expect(tracker.failed('X')).toBeDefined()
  })

  it('A1 records an abdicated block entry under its registration id and notifies subscribers', () => {
    const tracker = new EntryErrorTracker()
    const listener = vi.fn()
    tracker.subscribe(listener)
    const before = tracker.getSnapshot()
    const error = new Error('boom')

    tracker.record(ROOT_KEY, { options: { id: 'X' } }, error, ABDICATED)

    expect(tracker.failed('X')).toEqual({ blockId: 'X', error })
    expect(tracker.failed('Y')).toBeUndefined()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(tracker.getSnapshot()).not.toBe(before)
    expect(tracker.getSnapshot().get('X')?.error).toBe(error)
    expect(tracker.getSnapshot()).toBe(tracker.getSnapshot())
  })

  it('A1 a session-scope entry counts too, and a thrown string becomes an Error', () => {
    const tracker = new EntryErrorTracker()

    tracker.record(SESSION_KEY, { options: { id: 'S' } }, 'plain text', ABDICATED)

    const error = tracker.failed('S')?.error
    expect(error).toBeInstanceOf(Error)
    expect(error?.message).toBe('plain text')
  })

  it('A1 an unsubscribed listener is no longer notified', () => {
    const tracker = new EntryErrorTracker()
    const listener = vi.fn()
    tracker.subscribe(listener)()

    tracker.record(ROOT_KEY, { options: { id: 'X' } }, new Error('boom'), ABDICATED)

    expect(listener).not.toHaveBeenCalled()
  })

  it('A4 a key outside the block slots records nothing and does not notify', () => {
    const tracker = new EntryErrorTracker()
    const listener = vi.fn()
    tracker.subscribe(listener)
    const before = tracker.getSnapshot()

    tracker.record('root', { options: { id: 'X' } }, new Error('boom'), ABDICATED)
    tracker.record('webui.block.other', { options: { id: 'X' } }, new Error('boom'), ABDICATED)

    expect(tracker.failed('X')).toBeUndefined()
    expect(tracker.getSnapshot().size).toBe(0)
    expect(tracker.getSnapshot()).toBe(before)
    expect(listener).not.toHaveBeenCalled()
  })

  it('A4 an entry that did not abdicate, or has no usable id, records nothing', () => {
    const tracker = new EntryErrorTracker()
    const listener = vi.fn()
    tracker.subscribe(listener)

    tracker.record(ROOT_KEY, { options: { id: 'X' } }, new Error('boom'), { abdicated: false })
    tracker.record(ROOT_KEY, { options: {} }, new Error('boom'), ABDICATED)
    tracker.record(ROOT_KEY, { options: { id: '' } }, new Error('boom'), ABDICATED)

    expect(tracker.getSnapshot().size).toBe(0)
    expect(listener).not.toHaveBeenCalled()
  })

  it('A3 clear removes the failure and notifies, and does nothing when none was recorded', () => {
    const tracker = new EntryErrorTracker()
    tracker.record(ROOT_KEY, { options: { id: 'X' } }, new Error('boom'), ABDICATED)
    const listener = vi.fn()
    tracker.subscribe(listener)

    tracker.clear('nobody')
    expect(listener).not.toHaveBeenCalled()
    expect(tracker.failed('X')).toBeDefined()

    tracker.clear('X')
    expect(tracker.failed('X')).toBeUndefined()
    expect(tracker.getSnapshot().size).toBe(0)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
