// OPTIONAL Node/Bun reference backend. Single serial writer on a local filesystem, not a lock service.
import { closeSync, constants, existsSync, fsyncSync, fstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { canonicalJsonHash } from '../sdk/canonical-json.ts'
import { stateLimits, statePartitionId, validateStateCommit, validateStateSnapshot, type StateBinding, type StateLimits, type StatePersistencePort, type StateSnapshot } from './state-persistence.ts'

/** Root must be a trusted, existing private directory on a local filesystem with atomic rename.
 * Every successful commit fsyncs the file and partition directory. Unsupported fsync throws UNKNOWN;
 * there is no silent durability downgrade. Backups, encryption, multi-process writers and migrations
 * are deliberately not provided. Never delete a partition to make room for more work. */
export function createFileStatePort(root: string, binding: StateBinding, input: Partial<StateLimits> = {}): StatePersistencePort {
  const limits = stateLimits(input), directory = join(resolve(root), statePartitionId(binding))
  let created = false
  try { mkdirSync(directory, { mode: 0o700 }); created = true } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  const syncDirectory = (path: string) => { const fd = openSync(path, constants.O_RDONLY); try { fsyncSync(fd) } finally { closeSync(fd) } }
  if (created) syncDirectory(resolve(root))
  const file = join(directory, 'state.json'), temporary = join(directory, 'state.tmp')
  // An existing empty partition is ambiguous (e.g. crash at first commit), not empty protection.
  if (!created && !existsSync(file)) throw Error('missing state in existing partition; reconciliation required')
  let initialized = !created
  return Object.freeze({ schemaVersion: 1 as const, limits,
    read(): StateSnapshot | undefined {
      let fd: number
      try { fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)) }
      catch (error) { if (!initialized && (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
      try {
        if (fstatSync(fd).size > limits.maxBytes + 256) throw Error('state file byte bound')
        const envelope: unknown = JSON.parse(readFileSync(fd, 'utf8'))
        if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw Error('corrupt state envelope')
        const e = envelope as Record<string, unknown>
        if (Object.keys(e).sort().join(',') !== 'checksum,format,state' || e.format !== 'monitoring-state/v1' || typeof e.checksum !== 'string') throw Error('unknown state file format')
        const state = validateStateSnapshot(e.state, limits)
        if (canonicalJsonHash(state) !== e.checksum || statePartitionId(state.binding) !== statePartitionId(binding)) throw Error('state checksum or partition mismatch')
        return state
      } finally { closeSync(fd) }
    },
    commit(expectedRevision: number | undefined, next: StateSnapshot) {
      const current = this.read(), state = validateStateSnapshot(next, limits)
      if (statePartitionId(state.binding) !== statePartitionId(binding)) throw Error('state partition conflict')
      const transition = validateStateCommit(current, expectedRevision, state)
      if (transition === 'replay') { syncDirectory(directory); return Object.freeze({ revision: state.revision, durability: 'fsync' as const }) }
      const bytes = JSON.stringify({ format: 'monitoring-state/v1', checksum: canonicalJsonHash(state), state })
      let fd: number | undefined
      try {
        fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0), 0o600)
        writeFileSync(fd, bytes, 'utf8'); fsyncSync(fd); closeSync(fd); fd = undefined
        renameSync(temporary, file)
        initialized = true
        syncDirectory(directory)
        return Object.freeze({ revision: state.revision, durability: 'fsync' as const })
      } finally {
        if (fd !== undefined) closeSync(fd)
        try { unlinkSync(temporary) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      }
    },
  })
}
