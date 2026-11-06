/**
 * Bundle the browser half into the DSH client-module format.
 *
 * The shipped artifact is a plain script that registers a CommonJS-style
 * factory on `window.__ModuleLoader__`; React and the client primitives stay
 * external and resolve from the shell's static module table. Nothing here is
 * needed at runtime — `lib/client.js` is committed.
 */
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'

const ID = 'dsh-plugin-netease-music'

const result = await build({
  entryPoints: ['src/client.tsx'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: ['es2020'],
  jsx: 'automatic',
  external: [
    'react',
    'react/jsx-runtime',
    'react-dom',
    '@deepseek-ai/dsh-client-ui-primitives',
    '@deepseek-ai/dsh-client-ui-dockkit',
    '@deepseek-ai/dsh-client-store',
  ],
  legalComments: 'none',
  logLevel: 'warning',
})

const code = result.outputFiles[0].text
const wrapped = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(ID)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
${code}
\t\treturn module.exports;
\t}
});
`

await mkdir('lib', { recursive: true })
await writeFile('lib/client.js', wrapped)
console.log(`built lib/client.js (${(wrapped.length / 1024).toFixed(1)} KiB)`)
