/**
 * The one `deepFreeze` the unit tests share: it freezes fixtures so a test
 * fails loudly if the code under test mutates its input. eslint.config.js
 * keeps test files from defining another copy.
 */

/** Freezes `value` and everything nested in it in place, and returns the same reference. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}
