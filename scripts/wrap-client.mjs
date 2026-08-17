import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const src = readFileSync('build/client.raw.js', 'utf8')
const wrapped = `window.__ModuleLoader__.load({
  id: "dsh-session-plus",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${src}
    return module.exports;
  },
});
`
mkdirSync('lib', { recursive: true })
writeFileSync('lib/client.js', wrapped, 'utf8')
console.log('wrapped lib/client.js', wrapped.length)
