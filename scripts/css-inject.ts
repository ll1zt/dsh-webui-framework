/**
 * Build the script text that merges one stylesheet into the plugin's style tag.
 * The text is spliced into the client bundle, so it must stay plain ES5 and
 * run as a function body whose only free variable is `document`.
 *
 * The whole body sits in an IIFE because the bundle concatenates every sheet's
 * module into one scope, and top-level `var`s would collide between sheets.
 *
 * The body touches only `document.querySelector`, `createElement`,
 * `head.appendChild` and `dataset`: the verify-bundle stand-in for `document`
 * offers exactly those, so a richer DOM call would fail the offline check.
 */
export function styleInjectionModule(pluginId: string, fileId: string, css: string): string {
  const tagId = `${pluginId}/${fileId}`
  return [
    '(function () {',
    `  if (typeof document === 'undefined') return;`,
    `  var css = ${JSON.stringify(css)};`,
    `  var tagId = ${JSON.stringify(tagId)};`,
    `  var tag = document.querySelector(${JSON.stringify(`style[data-plugin="${pluginId}"]`)});`,
    `  if (tag === null) {`,
    `    tag = document.createElement('style');`,
    `    tag.dataset.plugin = ${JSON.stringify(pluginId)};`,
    `    document.head.appendChild(tag);`,
    `  }`,
    // A re-run finds its own id in the list; appending the CSS again would duplicate it.
    `  var tagIds = tag.dataset.pluginCss ? tag.dataset.pluginCss.split(' ') : [];`,
    `  if (tagIds.indexOf(tagId) !== -1) return;`,
    `  tag.textContent = tag.textContent ? tag.textContent + '\\n' + css : css;`,
    `  tagIds.push(tagId);`,
    `  tag.dataset.pluginCss = tagIds.join(' ');`,
    '})();',
  ].join('\n')
}
