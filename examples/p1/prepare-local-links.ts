// Link only already-present local packages for this non-workspace review directory.
// No install, network, dependency/lockfile mutation, or source aliasing.
import { existsSync, mkdirSync, realpathSync, symlinkSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
const root = resolve(import.meta.dir, '../..')
for (const [name, target] of [
  ['@lazy-harness/monitoring-core', 'packages/core'],
  ['@lazy-harness/monitoring-host-pi', 'hosts/pi'],
  ['typebox', 'packages/core/node_modules/typebox'],
]) {
  const source = realpathSync(resolve(root, target)) // Fail if not already installed.
  const link = resolve(import.meta.dir, 'node_modules', name)
  mkdirSync(dirname(link), { recursive: true })
  if (!existsSync(link)) symlinkSync(relative(dirname(link), source), link, 'dir')
  else if (realpathSync(link) !== source) throw new Error(`Unexpected local package link: ${name}`)
}
console.log('P1 local package links ready (no installs).')
