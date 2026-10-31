/** Node half: the host Loader imports this entry; the plugin owns one profile value, the saved layout. */
import Schema from '@deepseek-ai/schemastery'

/** Settings of the plugin (profile namespace `webui-framework`); `layout` is written by the browser half. */
export const Config = Schema.object({
  layout: Schema.any().volatile(),
})

export function apply(): void {}
