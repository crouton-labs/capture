import * as crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const configuredRoot = process.env.CAPTURE_ROOT;
if (configuredRoot !== undefined && !path.isAbsolute(configuredRoot)) throw new Error('CAPTURE_ROOT must be an absolute path');
/** The private artifact root pathname, frozen at process start; the directory itself is
 * established lazily by the first artifact transaction. Intentionally not realpathed. */
export const CAPTURE_ROOT = path.resolve(configuredRoot ?? path.join(os.tmpdir(), 'capture-sessions'));
export const DIR_MODE = 0o700;
export const FILE_MODE = 0o600;
const MAX_TIMING_MS = 86_400_000;

type Identity = { dev: number; ino: number };
export type ArtifactHookOperation = 'root-bootstrap' | 'traversal' | 'final-file' | 'recursive-removal' | 'lock';
export type ArtifactHookPhase = 'afterComponentLstat' | 'beforeComponentCreate' | 'beforeComponentChdir' | 'afterComponentChdirBeforeIdentityCheck' | 'afterRootPinned' | 'afterParentPinned' | 'afterFinalOpen' | 'afterDescriptorValidated' | 'beforeTempCreate' | 'afterTempCreate' | 'beforeRename' | 'beforeUnlink' | 'beforeOwnedCleanupUnlink' | 'afterChildLstat' | 'beforeChildChdir' | 'afterChildChdirBeforeIdentityCheck' | 'beforeChildUnlink' | 'beforeDirectoryRmdir' | 'beforePublishAttempt' | 'afterStageMkdirPinned' | 'beforeStageChdir' | 'afterStageChdirBeforeIdentityCheck' | 'afterOwnerWrite' | 'beforePublishRename' | 'beforeStageCleanup' | 'afterCanonicalOwnerValidation' | 'afterOwnerRemoval' | 'beforeCanonicalRmdir';
export interface ArtifactHookDetail { operation: ArtifactHookOperation; phase: ArtifactHookPhase; path: string; component?: string; }
type Hook = (detail: ArtifactHookDetail) => void;
export interface ArtifactTestHooks {
  onHook?: Hook;
  afterComponentLstat?: Hook; beforeComponentCreate?: Hook; beforeComponentChdir?: Hook; afterComponentChdirBeforeIdentityCheck?: Hook; afterRootPinned?: Hook; afterParentPinned?: Hook;
  afterFinalOpen?: Hook; afterDescriptorValidated?: Hook; beforeTempCreate?: Hook; afterTempCreate?: Hook; beforeRename?: Hook; beforeUnlink?: Hook; beforeOwnedCleanupUnlink?: Hook;
  afterChildLstat?: Hook; beforeChildChdir?: Hook; afterChildChdirBeforeIdentityCheck?: Hook; beforeChildUnlink?: Hook; beforeDirectoryRmdir?: Hook;
  beforePublishAttempt?: Hook; afterStageMkdirPinned?: Hook; beforeStageChdir?: Hook; afterStageChdirBeforeIdentityCheck?: Hook; afterOwnerWrite?: Hook; beforePublishRename?: Hook; beforeStageCleanup?: Hook; afterCanonicalOwnerValidation?: Hook; afterOwnerRemoval?: Hook; beforeCanonicalRmdir?: Hook;
}
/** A hook may be installed via this global symbol before importing this module, so the first transaction's root bootstrap is observable. */
export const ARTIFACT_TEST_HOOKS_SYMBOL = Symbol.for('capture.artifacts.test-hooks');
let hooks = globalThis[ARTIFACT_TEST_HOOKS_SYMBOL as keyof typeof globalThis] as ArtifactTestHooks | undefined;
function hook(operation: ArtifactHookOperation, phase: ArtifactHookPhase, path: string, component?: string): void { const detail = { operation, phase, path, component }; hooks?.onHook?.(detail); hooks?.[phase]?.(detail); }
/** Test-only synchronous race seams. Production callers must not configure these. */
export function __setArtifactTestHooks(next?: ArtifactTestHooks): void { hooks = next; }
export type ArtifactSyscallRole = 'artifact-data-write' | 'lock-owner-write' | 'artifact-temp-fsync' | 'lock-owner-fsync' | 'lock-stage-dir-fsync' | 'artifact-temp-close' | 'lock-owner-close' | 'artifact-rename' | 'lock-publish-rename' | 'artifact-cleanup-unlink' | 'lock-canonical-rmdir' | 'artifact-open' | 'artifact-fstat' | 'artifact-fchmod';
export interface ArtifactTestFaults { before?: (role: ArtifactSyscallRole) => void; after?: (role: ArtifactSyscallRole) => void; write?: (role: Extract<ArtifactSyscallRole, 'artifact-data-write' | 'lock-owner-write'>, real: () => number) => number; }
let faults: ArtifactTestFaults | undefined;
/** Test-only syscall adapter. Calls are always real by default and this is reset by passing undefined. */
export function __setArtifactTestFaults(next?: ArtifactTestFaults): void { faults = next; }
let artifactTempToken = () => crypto.randomBytes(12).toString('hex');
let lockToken = () => crypto.randomBytes(24).toString('hex');
/** Deterministic test-only sources for nameable collision and publication cases. */
export function __setArtifactTestTokens(next?: { artifactTemp?: () => string; lock?: () => string }): void { artifactTempToken = next?.artifactTemp ?? (() => crypto.randomBytes(12).toString('hex')); lockToken = next?.lock ?? (() => crypto.randomBytes(24).toString('hex')); }

type RuntimeContext = {
  hooks: ArtifactTestHooks | undefined;
  faults: ArtifactTestFaults | undefined;
  artifactTempToken: () => string;
  lockToken: () => string;
  execFileSyncForProvider: ExecFileSync;
  linuxProviderRead: (file: '/proc/sys/kernel/random/boot_id' | `/proc/${number}/stat`) => string;
};
function snapshotRuntime(): RuntimeContext { return { hooks, faults, artifactTempToken, lockToken, execFileSyncForProvider, linuxProviderRead }; }
function withRuntime<T>(runtime: RuntimeContext, action: () => T): T {
  const prior = { hooks, faults, artifactTempToken, lockToken, execFileSyncForProvider, linuxProviderRead };
  hooks = runtime.hooks;
  faults = runtime.faults;
  artifactTempToken = runtime.artifactTempToken;
  lockToken = runtime.lockToken;
  execFileSyncForProvider = runtime.execFileSyncForProvider;
  linuxProviderRead = runtime.linuxProviderRead;
  try { return action(); }
  finally {
    hooks = prior.hooks;
    faults = prior.faults;
    artifactTempToken = prior.artifactTempToken;
    lockToken = prior.lockToken;
    execFileSyncForProvider = prior.execFileSyncForProvider;
    linuxProviderRead = prior.linuxProviderRead;
  }
}
async function withRuntimeAsync<T>(runtime: RuntimeContext, action: () => Promise<T>): Promise<T> {
  const prior = { hooks, faults, artifactTempToken, lockToken, execFileSyncForProvider, linuxProviderRead };
  hooks = runtime.hooks;
  faults = runtime.faults;
  artifactTempToken = runtime.artifactTempToken;
  lockToken = runtime.lockToken;
  execFileSyncForProvider = runtime.execFileSyncForProvider;
  linuxProviderRead = runtime.linuxProviderRead;
  try { return await action(); }
  finally {
    hooks = prior.hooks;
    faults = prior.faults;
    artifactTempToken = prior.artifactTempToken;
    lockToken = prior.lockToken;
    execFileSyncForProvider = prior.execFileSyncForProvider;
    linuxProviderRead = prior.linuxProviderRead;
  }
}
let privateLockGate: Promise<unknown> = Promise.resolve();
function withPrivateLockSerial<T>(task: () => Promise<T>): Promise<T> {
  const run = privateLockGate.then(() => task());
  privateLockGate = run.then(() => undefined, () => undefined);
  return run;
}
function syscall<T>(role: ArtifactSyscallRole, real: () => T): T { faults?.before?.(role); return real(); }
function closeDescriptor(fd: number, role: Extract<ArtifactSyscallRole, 'artifact-temp-close' | 'lock-owner-close'>, afterRealClose?: () => void): void {
  faults?.before?.(role);
  fs.closeSync(fd);
  afterRealClose?.();
  // Close is the sole after-real-call fault seam: the descriptor is definitely closed
  // before this callback can throw.
  faults?.after?.(role);
}
function combineFailure(primary: unknown, secondary: unknown, message: string): never {
  throw new AggregateError([primary, secondary], message);
}
// The root is established lazily by the first pinned artifact transaction: every
// transaction traverses it, pinning its identity on first use and verifying it
// on every later traversal. Non-artifact invocations touch no filesystem state.
let captureRootIdentity: Identity | undefined;
let cwdPinned = false;

export interface SnapMeta { id: string; url: string | null; viewport: string | null; settled: boolean; capturedAt: string; }
export interface RecMeta { id: string; action: string | null; frames: number; durationMs: number; state: string; viewportRestored?: boolean | null; }
function identity(stat: fs.Stats): Identity { return { dev: stat.dev, ino: stat.ino }; }
function sameIdentity(a: Identity, b: Identity): boolean { return a.dev === b.dev && a.ino === b.ino; }
function errno(error: unknown): string | undefined { return (error as NodeJS.ErrnoException).code; }
function isMissing(error: unknown): boolean { return errno(error) === 'ENOENT'; }
function assertName(name: string): void { if (!name || name === '.' || name === '..' || name.includes(path.sep)) throw new Error(`invalid artifact path component: ${name}`); }
function writeAll(fd: number, data: string | Buffer, role: Extract<ArtifactSyscallRole, 'artifact-data-write' | 'lock-owner-write'> = 'artifact-data-write'): void { const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data); for (let off = 0; off < bytes.length;) { const remaining = bytes.length - off; faults?.before?.(role); if (!faults?.write) { const wrote = fs.writeSync(fd, bytes, off, remaining); if (!Number.isSafeInteger(wrote) || wrote <= 0 || wrote > remaining) throw new Error('short private artifact write'); off += wrote; continue; }
    // A fault callback prescribes the segment to persist. Its `real` callback reports
    // the unmodified syscall capacity; delaying the actual write avoids writing a full
    // buffer and then falsely reporting a partial result.
    const prescribed = faults.write(role, () => remaining); if (!Number.isSafeInteger(prescribed) || prescribed <= 0 || prescribed > remaining) throw new Error('short private artifact write');
    const wrote = fs.writeSync(fd, bytes, off, prescribed); if (!Number.isSafeInteger(wrote) || wrote <= 0 || wrote > prescribed) throw new Error('short private artifact write'); off += wrote;
  } }
function privateDirHere(): void { const fd = fs.openSync('.', fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW); try { fs.fchmodSync(fd, DIR_MODE); } finally { fs.closeSync(fd); } }
function verifyRoot(actual: Identity): void { if (captureRootIdentity) { if (!sameIdentity(captureRootIdentity, actual)) throw new Error('capture root changed since it was first established'); } else captureRootIdentity = actual; }
function rootOrAncestor(current: string): boolean { return current === CAPTURE_ROOT || CAPTURE_ROOT.startsWith(`${current}${path.sep}`); }

/** Performs only synchronous single-component operations while cwd is inode-pinned. */
function inPinnedDirectory<T>(absoluteDir: string, create: boolean, operation: () => T, operationKind: ArtifactHookOperation = 'traversal'): T {
  if (cwdPinned) throw new Error('nested private artifact cwd transaction');
  if (!path.isAbsolute(absoluteDir)) throw new Error(`private artifact directory must be absolute: ${absoluteDir}`);
  cwdPinned = true;
  const original = process.cwd();
  const originalIdentity = identity(fs.statSync('.'));
  let result: T | undefined; let failure: unknown;
  try {
    const root = path.parse(absoluteDir).root; process.chdir(root); let current = root;
    for (const component of absoluteDir.slice(root.length).split(path.sep).filter(Boolean)) {
      assertName(component); current = path.join(current, component);
      const privateComponent = current === CAPTURE_ROOT || current.startsWith(`${CAPTURE_ROOT}${path.sep}`);
      const darwinVarAlias = process.platform === 'darwin' && current === '/var' && CAPTURE_ROOT.startsWith('/var/');
      const hookOperation: ArtifactHookOperation = current === CAPTURE_ROOT || darwinVarAlias ? 'root-bootstrap' : operationKind;
      let before: fs.Stats;
      try { before = fs.lstatSync(component); hook(hookOperation, 'afterComponentLstat', current, component); }
      catch (error) {
        if (!create || !(privateComponent || rootOrAncestor(current)) || !isMissing(error)) throw error;
        hook(hookOperation, 'beforeComponentCreate', current, component);
        // A concurrent honest bootstrap can create this component between the
        // ENOENT lstat and this mkdir. Tolerate exactly EEXIST, then re-lstat the
        // same name: the symlink/non-directory/identity/mode checks below remain
        // authoritative over whatever won the create.
        try { fs.mkdirSync(component, { mode: DIR_MODE }); }
        catch (createError) { if (errno(createError) !== 'EEXIST') throw createError; }
        before = fs.lstatSync(component);
      }
      // Darwin exposes /var as a kernel-owned alias for /private/var. It is the only
      // host alias accepted before the configured root; all user-controlled components
      // including the configured root itself must be real directories.
      // Pin and compare the followed vnode, not the alias directory entry.
      if (before.isSymbolicLink() && darwinVarAlias) {
        const expected = identity(fs.statSync(component));
        hook(hookOperation, 'beforeComponentChdir', current, component);
        process.chdir(component);
        hook(hookOperation, 'afterComponentChdirBeforeIdentityCheck', current, component);
        if (!sameIdentity(expected, identity(fs.statSync('.')))) throw new Error(`artifact directory changed while pinning: ${component}`);
        continue;
      }
      if (before.isSymbolicLink()) throw new Error(`refusing symlinked artifact directory component: ${component}`);
      if (!before.isDirectory()) throw new Error(`refusing non-directory artifact component: ${component}`);
      const expected = identity(before); hook(hookOperation, 'beforeComponentChdir', current, component); process.chdir(component); hook(hookOperation, 'afterComponentChdirBeforeIdentityCheck', current, component);
      if (!sameIdentity(expected, identity(fs.statSync('.')))) throw new Error(`artifact directory changed while pinning: ${component}`);
      if (current === CAPTURE_ROOT) { verifyRoot(expected); hook('root-bootstrap', 'afterRootPinned', current, component); }
      if (privateComponent) privateDirHere();
    }
    hook(absoluteDir === CAPTURE_ROOT ? 'root-bootstrap' : operationKind, 'afterParentPinned', absoluteDir); result = operation();
  } catch (error) { failure = error; }
  let restoreFailure: unknown;
  try { process.chdir(original); if (!sameIdentity(originalIdentity, identity(fs.statSync('.')))) restoreFailure = new Error('private artifact cwd restoration changed directory identity'); }
  catch (error) { restoreFailure = error; }
  cwdPinned = false;
  if (restoreFailure) { if (failure) throw new AggregateError([failure, restoreFailure], 'private artifact cwd restoration failed'); throw restoreFailure; }
  if (failure) throw failure;
  return result as T;
}

export function assertUnderCaptureRoot(targetPath: string): string { const resolved = path.resolve(targetPath); const relative = path.relative(CAPTURE_ROOT, resolved); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`artifact path escapes capture root ${CAPTURE_ROOT}: ${targetPath}`); return resolved; }
function pinnedParent<T>(target: string, operation: (name: string) => T, create = true, operationKind: ArtifactHookOperation = 'traversal'): T { const resolved = assertUnderCaptureRoot(target); const name = path.basename(resolved); assertName(name); return inPinnedDirectory(path.dirname(resolved), create, () => operation(name), operationKind); }
export function ensurePrivateDir(dirPath: string): string { const resolved = assertUnderCaptureRoot(dirPath); inPinnedDirectory(resolved, true, () => undefined); return resolved; }
function openRegular(name: string, flags: number, create = false, onOpened?: (fd: number) => void, closeRole: Extract<ArtifactSyscallRole, 'artifact-temp-close' | 'lock-owner-close'> = 'artifact-temp-close', hookOperation: ArtifactHookOperation = 'final-file'): number {
  let fd: number | undefined;
  try { fd = syscall('artifact-open', () => fs.openSync(name, flags | fs.constants.O_NOFOLLOW, create ? FILE_MODE : undefined)); onOpened?.(fd); hook(hookOperation, 'afterFinalOpen', path.resolve(process.cwd(), name), name); const stat = syscall('artifact-fstat', () => fs.fstatSync(fd!)); if (!stat.isFile()) throw new Error(`artifact is not a regular file: ${name}`); syscall('artifact-fchmod', () => fs.fchmodSync(fd!, FILE_MODE)); hook(hookOperation, 'afterDescriptorValidated', path.resolve(process.cwd(), name), name); return fd; }
  catch (error) { if (fd !== undefined) { try { closeDescriptor(fd, closeRole); } catch (closeError) { combineFailure(error, closeError, 'private artifact descriptor setup failed'); } } throw error; }
}
export function createPrivateFile(filePath: string, data: string | Buffer = ''): void { pinnedParent(filePath, name => {
  let fd: number | undefined; let created: Identity | undefined; let closed = false;
  let primary: unknown;
  try {
    fd = openRegular(name, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, true, opened => { created = identity(fs.fstatSync(opened)); });
    writeAll(fd, data); syscall('artifact-temp-fsync', () => fs.fsyncSync(fd));
    closeDescriptor(fd, 'artifact-temp-close', () => { closed = true; });
  } catch (error) { primary = error; }
  if (fd !== undefined && !closed) { try { closeDescriptor(fd, 'artifact-temp-close', () => { closed = true; }); } catch (closeError) { if (primary) combineFailure(primary, closeError, 'private artifact creation failed'); throw closeError; } }
  if (primary) { try { cleanupOwnedFile(name, created); } catch (cleanupError) { combineFailure(primary, cleanupError, 'private artifact creation cleanup failed'); } throw primary; }
}); }
function readFd(fd: number): Buffer { const chunks: Buffer[] = []; const chunk = Buffer.allocUnsafe(65536); for (;;) { const n = fs.readSync(fd, chunk, 0, chunk.length, null); if (!n) return Buffer.concat(chunks); chunks.push(Buffer.from(chunk.subarray(0, n))); } }
export function readPrivateFile(filePath: string): Buffer { return pinnedParent(filePath, name => { const fd = openRegular(name, fs.constants.O_RDONLY); let value: Buffer | undefined; let primary: unknown; try { value = readFd(fd); } catch (error) { primary = error; } try { closeDescriptor(fd, 'artifact-temp-close'); } catch (closeError) { if (primary) combineFailure(primary, closeError, 'private artifact read failed'); throw closeError; } if (primary) throw primary; return value!; }); }
/** Opens a contained, no-follow, append descriptor the caller owns and must close.
 * Reuses the pinned-parent transaction and fchmod-on-descriptor private mode, so a
 * planted symlink at the final component fails the open (O_NOFOLLOW) and the target's
 * bytes/mode are never touched. */
export function openPrivateAppendFd(filePath: string): number {
  return pinnedParent(filePath, name => openRegular(name, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT, true));
}
export function appendPrivateFile(filePath: string, data: string | Buffer): void { pinnedParent(filePath, name => { const fd = openRegular(name, fs.constants.O_WRONLY | fs.constants.O_APPEND); let primary: unknown; try { writeAll(fd, data); syscall('artifact-temp-fsync', () => fs.fsyncSync(fd)); } catch (error) { primary = error; } try { closeDescriptor(fd, 'artifact-temp-close'); } catch (closeError) { if (primary) combineFailure(primary, closeError, 'private artifact append failed'); throw closeError; } if (primary) throw primary; }); }
function cleanupOwnedFile(name: string, expected?: Identity): void {
  if (!expected) return;
  let lastFailure: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const current = fs.lstatSync(name);
      if (!sameIdentity(expected, identity(current)) || !current.isFile()) return;
      hook('final-file', 'beforeOwnedCleanupUnlink', path.resolve(process.cwd(), name), name);
      const rechecked = fs.lstatSync(name);
      if (!sameIdentity(expected, identity(rechecked)) || !rechecked.isFile()) return;
      syscall('artifact-cleanup-unlink', () => fs.unlinkSync(name));
      return;
    } catch (error) {
      if (isMissing(error)) return;
      lastFailure = error;
    }
  }
  throw lastFailure;
}
export function writePrivateFile(filePath: string, data: string | Buffer): void { pinnedParent(filePath, name => {
  try { if (fs.lstatSync(name).isSymbolicLink()) throw new Error(`refusing to replace symlinked private artifact: ${name}`); } catch (error) { if (!isMissing(error)) throw error; }
  const temporary = `.${name}.${process.pid}.${artifactTempToken()}.tmp`; let fd: number | undefined; let created: Identity | undefined; let closed = false; let published = false;
  let primary: unknown;
  try {
    hook('final-file', 'beforeTempCreate', path.resolve(process.cwd(), temporary), temporary);
    fd = openRegular(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, true, opened => { created = identity(fs.fstatSync(opened)); });
    hook('final-file', 'afterTempCreate', path.resolve(process.cwd(), temporary), temporary);
    writeAll(fd, data); syscall('artifact-temp-fsync', () => fs.fsyncSync(fd)); closeDescriptor(fd, 'artifact-temp-close', () => { closed = true; });
    hook('final-file', 'beforeRename', path.resolve(process.cwd(), name), name);
    const temporaryState = fs.lstatSync(temporary);
    if (!created || !temporaryState.isFile() || !sameIdentity(created, identity(temporaryState))) throw new Error(`private artifact temporary replaced before rename: ${temporary}`);
    syscall('artifact-rename', () => fs.renameSync(temporary, name)); published = true;
  } catch (error) { primary = error; }
  if (fd !== undefined && !closed) { try { closeDescriptor(fd, 'artifact-temp-close', () => { closed = true; }); } catch (closeError) { if (primary) combineFailure(primary, closeError, 'private artifact replacement failed'); throw closeError; } }
  if (primary) { if (!published) { try { cleanupOwnedFile(temporary, created); } catch (cleanupError) { combineFailure(primary, cleanupError, 'private artifact replacement cleanup failed'); } } throw primary; }
}); }
export function unlinkPrivateFile(filePath: string): void { pinnedParent(filePath, name => { const stat = fs.lstatSync(name); if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`refusing to unlink non-regular private artifact: ${name}`); hook('final-file', 'beforeUnlink', path.resolve(process.cwd(), name), name); syscall('artifact-cleanup-unlink', () => fs.unlinkSync(name)); }); }
export function writeJsonPrivate(filePath: string, value: unknown): void { writePrivateFile(filePath, JSON.stringify(value, null, 2)); }
export function writeNdjsonPrivate(filePath: string, records: unknown[]): void { writePrivateFile(filePath, records.map(record => JSON.stringify(record)).join('\n') + (records.length ? '\n' : '')); }
export function appendNdjsonPrivate(filePath: string, record: unknown): void { const line = `${JSON.stringify(record)}\n`; try { appendPrivateFile(filePath, line); } catch (error) { if (!isMissing(error)) throw error; try { createPrivateFile(filePath, line); } catch (created) { if (errno(created) === 'EEXIST') appendPrivateFile(filePath, line); else throw created; } } }
export function writeBinaryPrivate(filePath: string, data: Buffer): void { writePrivateFile(filePath, data); }
function removePinnedEntry(name: string): void { const absolute = path.resolve(process.cwd(), name); const stat = fs.lstatSync(name); hook('recursive-removal', 'afterChildLstat', absolute, name); if (stat.isSymbolicLink() || stat.isFile()) { hook('recursive-removal', 'beforeChildUnlink', absolute, name); syscall('artifact-cleanup-unlink', () => fs.unlinkSync(name)); return; } if (!stat.isDirectory()) throw new Error(`refusing to remove unusual artifact entry: ${name}`); const parent = identity(fs.statSync('.')); const expected = identity(stat); hook('recursive-removal', 'beforeChildChdir', absolute, name); process.chdir(name); hook('recursive-removal', 'afterChildChdirBeforeIdentityCheck', absolute, name); if (!sameIdentity(expected, identity(fs.statSync('.')))) throw new Error(`artifact directory changed while removing: ${name}`); for (const child of fs.readdirSync('.')) removePinnedEntry(child); process.chdir('..'); if (!sameIdentity(parent, identity(fs.statSync('.')))) throw new Error('artifact parent changed while removing');
  let removalName = name; let displaced = false;
  try { displaced = !sameIdentity(expected, identity(fs.lstatSync(name))); } catch (error) { if (!isMissing(error)) throw error; displaced = true; }
  if (displaced) {
    removalName = fs.readdirSync('.').find(candidate => { try { return sameIdentity(expected, identity(fs.lstatSync(candidate))); } catch { return false; } }) ?? '';
    if (!removalName) throw new Error(`artifact directory changed while removing: ${name}`);
  }
  hook('recursive-removal', 'beforeDirectoryRmdir', path.resolve(process.cwd(), removalName), removalName);
  const finalEntry = fs.lstatSync(removalName);
  if (!sameIdentity(expected, identity(finalEntry)) || !finalEntry.isDirectory()) throw new Error(`artifact directory changed while removing: ${name}`);
  syscall('artifact-cleanup-unlink', () => fs.rmdirSync(removalName));
  if (displaced) throw new Error(`artifact directory changed while removing: ${name}`);
}
export function removeArtifactTree(targetPath: string): void { try { pinnedParent(targetPath, removePinnedEntry, false); } catch (error) { if (!isMissing(error)) throw error; } }

export type PidBirth = { provider: 'linux-proc-v1'; bootId: string; startTicks: string } | { provider: 'darwin-kern-proc-v1'; startSec: string; startUsec: number };
export type PidBirthRead = { status: 'found'; identity: PidBirth } | { status: 'absent' } | { status: 'unknown'; reason: string };
export interface PidBirthProvider { read(pid: number): PidBirthRead; }
function unknown(reason: string): PidBirthRead { return { status: 'unknown', reason }; }
const BOOT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** True when `value` carries exactly `keys` — the strict-record shape gate shared with the log tailer. */
export function exactKeys(value: Record<string, unknown>, keys: string[]): boolean { const actual = Object.keys(value).sort(); return actual.length === keys.length && actual.every((key, index) => key === keys.slice().sort()[index]); }
/** Strictly parses a persisted PID-birth identity; anything malformed is undefined. */
export function parseBirth(value: unknown): PidBirth | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const b = value as Record<string, unknown>;
  if (b.provider === 'linux-proc-v1' && exactKeys(b, ['provider', 'bootId', 'startTicks']) && typeof b.bootId === 'string' && BOOT_ID.test(b.bootId) && typeof b.startTicks === 'string' && /^[1-9][0-9]*$/.test(b.startTicks)) return { provider: 'linux-proc-v1', bootId: b.bootId, startTicks: b.startTicks };
  if (b.provider === 'darwin-kern-proc-v1' && exactKeys(b, ['provider', 'startSec', 'startUsec']) && typeof b.startSec === 'string' && /^[1-9][0-9]*$/.test(b.startSec) && typeof b.startUsec === 'number' && Number.isInteger(b.startUsec) && b.startUsec >= 0 && b.startUsec < 1_000_000) return { provider: 'darwin-kern-proc-v1', startSec: b.startSec, startUsec: b.startUsec };
  return undefined;
}
export const MAX_LOG_LABEL_BYTES = 64;
/** Returns a diagnostic for an invalid log destination filename component, otherwise null. */
export function rejectLogLabel(label: string): string | null {
  if (label.length === 0) return 'empty';
  if (label === '.' || label === '..') return `\`${label}\` is not a filename`;
  if (label.includes('/') || label.includes('\\')) return 'contains a path separator';
  if (label.includes('\0')) return 'contains a NUL byte';
  if (Buffer.byteLength(label, 'utf-8') > MAX_LOG_LABEL_BYTES) return `exceeds ${MAX_LOG_LABEL_BYTES} bytes`;
  return null;
}
export const LOG_TAILER_SOCKET_TOKEN = /^[0-9a-f]{16}$/;
export const LOG_TAILER_NONCE = /^[0-9a-f]{48}$/;
/** Private control-socket directory shared by every session log tailer. */
export const LOG_TAILER_SOCKET_DIR = path.join(CAPTURE_ROOT, 'sock');
const DECIMAL_IDENTITY = /^(?:0|[1-9][0-9]*)$/;
/** An identity-bearing registered log tailer — exactly the persisted `logPids` record shape. */
export interface RegisteredLogTailer { pid: number; name: string; sourcePath: string; birth: PidBirth; socketPath: string; socketDev: string; socketIno: string; nonce: string; }
/** Strictly parses a persisted log tailer registration; anything weaker is undefined. */
export function parseRegisteredLogTailer(value: unknown): RegisteredLogTailer | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const birth = parseBirth(record.birth);
  const valid = birth !== undefined
    && exactKeys(record, ['pid', 'name', 'sourcePath', 'birth', 'socketPath', 'socketDev', 'socketIno', 'nonce'])
    && Number.isSafeInteger(record.pid) && (record.pid as number) > 0
    && typeof record.name === 'string' && rejectLogLabel(record.name) === null
    && typeof record.sourcePath === 'string' && path.isAbsolute(record.sourcePath)
    && typeof record.socketPath === 'string'
    && path.dirname(record.socketPath) === LOG_TAILER_SOCKET_DIR
    && LOG_TAILER_SOCKET_TOKEN.test(path.basename(record.socketPath, '.sock'))
    && path.extname(record.socketPath) === '.sock'
    && typeof record.socketDev === 'string' && DECIMAL_IDENTITY.test(record.socketDev)
    && typeof record.socketIno === 'string' && DECIMAL_IDENTITY.test(record.socketIno)
    && typeof record.nonce === 'string' && LOG_TAILER_NONCE.test(record.nonce);
  // `valid` already implies a parsed birth, but the explicit disjunct is what
  // narrows `birth` for the return type — do not "simplify" it away.
  if (!valid || birth === undefined) return undefined;
  return { pid: record.pid as number, name: record.name as string, sourcePath: record.sourcePath as string, birth, socketPath: record.socketPath as string, socketDev: record.socketDev as string, socketIno: record.socketIno as string, nonce: record.nonce as string };
}
export interface DarwinKernProcValidationContext { arch: string; selfPid: number; selfStartSeconds: number; nowSeconds: number; }
export function parseDarwinKernProc(snapshot: Buffer, pid: number, context: DarwinKernProcValidationContext = { arch: process.arch, selfPid: process.pid, selfStartSeconds: Math.floor(Date.now() / 1000 - process.uptime()), nowSeconds: Math.floor(Date.now() / 1000) }): PidBirthRead {
  if (!['arm64', 'x64'].includes(context.arch) || !Number.isSafeInteger(pid) || pid <= 0 || !snapshot.length || snapshot.length % 648) return unknown('unexpected kern.proc layout');
  const seen = new Set<number>(); let found: PidBirth | undefined; let selfStart: bigint | undefined; const future = BigInt(context.nowSeconds + 60);
  for (let offset = 0; offset < snapshot.length; offset += 648) {
    const recordPid = snapshot.readInt32LE(offset + 40); const sec = snapshot.readBigInt64LE(offset); const usec = snapshot.readBigInt64LE(offset + 8);
    // kern.proc can include the kernel PID 0 record; it has no user-process
    // birth timeval and is not a liveness candidate. Every real process record
    // is globally validated before this snapshot can answer for any target.
    if (recordPid < 0 || recordPid > 10_000_000 || seen.has(recordPid) || (recordPid !== 0 && (sec <= 0n || sec > future || usec < 0n || usec >= 1_000_000n))) return unknown('invalid kern.proc snapshot');
    seen.add(recordPid); if (recordPid === context.selfPid) selfStart = sec;
    if (recordPid === pid) found = { provider: 'darwin-kern-proc-v1', startSec: sec.toString(), startUsec: Number(usec) };
  }
  const expectedSelf = BigInt(Math.floor(context.selfStartSeconds));
  if (!seen.has(1) || selfStart === undefined || abs(selfStart - expectedSelf) > 60n) return unknown('kern.proc snapshot missing or invalid self identity');
  return found ? { status: 'found', identity: found } : { status: 'absent' };
}
export function parseLinuxProcStat(stat: string, expectedPid: number, bootId: string): PidBirthRead { if (!BOOT_ID.test(bootId.trim()) || !stat.startsWith(`${expectedPid} (`)) return unknown('malformed proc identity'); const close = stat.lastIndexOf(') '); const fields = close < 0 ? [] : stat.slice(close + 2).trim().split(/\s+/); const startTicks = fields[19]; if (!/^[1-9][0-9]*$/.test(startTicks ?? '')) return unknown('malformed proc identity'); return { status: 'found', identity: { provider: 'linux-proc-v1', bootId: bootId.trim(), startTicks } }; }
type ExecFileSync = typeof execFileSync;
let execFileSyncForProvider: ExecFileSync = execFileSync;
type LinuxProviderRead = (file: '/proc/sys/kernel/random/boot_id' | `/proc/${number}/stat`) => string;
let linuxProviderRead: LinuxProviderRead = file => fs.readFileSync(file, 'utf8');
/** Test-only provider seams are limited to process-identity inputs. */
export function __setArtifactTestExecFileSync(next?: ExecFileSync): void { execFileSyncForProvider = next ?? execFileSync; }
export function __setArtifactTestLinuxProviderRead(next?: LinuxProviderRead): void { linuxProviderRead = next ?? (file => fs.readFileSync(file, 'utf8')); }
export const processPidBirthProvider: PidBirthProvider = { read(pid) { try { if (!Number.isSafeInteger(pid) || pid <= 0) return unknown('invalid pid'); if (process.platform === 'linux') { let boot: string; try { boot = linuxProviderRead('/proc/sys/kernel/random/boot_id'); } catch (error) { return unknown(String(error)); } try { return parseLinuxProcStat(linuxProviderRead(`/proc/${pid}/stat`), pid, boot); } catch (error) { return isMissing(error) ? { status: 'absent' } : unknown(String(error)); } } if (process.platform === 'darwin') return parseDarwinKernProc(Buffer.from(execFileSyncForProvider('/usr/sbin/sysctl', ['-b', 'kern.proc'], { encoding: null, maxBuffer: 64 * 1024 * 1024, timeout: 1_000 }) as Buffer), pid); return unknown(`unsupported platform ${process.platform}`); } catch (error) { return unknown(String(error)); } } };
function abs(value: bigint): bigint { return value < 0n ? -value : value; }

interface LockOwner { version: 1; token: string; pid: number; birth: PidBirth; leaseDeadlineNs: string; }
export interface PrivateLockHandle { readonly token: string; readonly ownerBirth: PidBirth; release(): void; }
export interface PrivateLockOptions { acquireTimeoutMs: number; leaseMs: number; pidBirthProvider?: PidBirthProvider; nowNs?: () => bigint; sleep?: (ms: number) => Promise<void>; token?: () => string; afterOwnerValidated?: () => void; afterOwnerRemoved?: () => void; beforeCanonicalRmdir?: () => void; beforePublishRename?: () => void; }
/** Field-exact birth-identity equality — the gate before any signal is authorized. */
export function sameBirth(a: PidBirth, b: PidBirth): boolean { return a.provider === b.provider && (a.provider === 'linux-proc-v1' ? a.bootId === (b as Extract<PidBirth, { provider: 'linux-proc-v1' }>).bootId && a.startTicks === (b as Extract<PidBirth, { provider: 'linux-proc-v1' }>).startTicks : a.startSec === (b as Extract<PidBirth, { provider: 'darwin-kern-proc-v1' }>).startSec && a.startUsec === (b as Extract<PidBirth, { provider: 'darwin-kern-proc-v1' }>).startUsec); }
function sameOwner(a: LockOwner, b: LockOwner): boolean { return a.token === b.token && a.pid === b.pid && a.leaseDeadlineNs === b.leaseDeadlineNs && sameBirth(a.birth, b.birth); }
function parseOwner(value: Buffer): LockOwner | undefined { try { const o = JSON.parse(value.toString('utf8')) as Record<string, unknown>; const birth = parseBirth(o?.birth); if (!o || Array.isArray(o) || !exactKeys(o, ['version', 'token', 'pid', 'birth', 'leaseDeadlineNs']) || o.version !== 1 || typeof o.token !== 'string' || !/^[0-9a-f]{32,}$/.test(o.token) || !Number.isSafeInteger(o.pid) || (o.pid as number) <= 0 || typeof o.leaseDeadlineNs !== 'string' || !/^(0|[1-9][0-9]*)$/.test(o.leaseDeadlineNs) || !birth) return undefined; BigInt(o.leaseDeadlineNs); return { version: 1, token: o.token, pid: o.pid as number, birth, leaseDeadlineNs: o.leaseDeadlineNs }; } catch { return undefined; } }
type OwnerState = { kind: 'missing' } | { kind: 'valid'; owner: LockOwner } | { kind: 'malformed' };
function ownerStateHere(): OwnerState { let fd: number; try { fd = openRegular('owner', fs.constants.O_RDONLY, false, undefined, 'lock-owner-close', 'lock'); } catch (error) { return isMissing(error) ? { kind: 'missing' } : { kind: 'malformed' }; } let state: OwnerState; try { const parsed = parseOwner(readFd(fd)); state = parsed ? { kind: 'valid', owner: parsed } : { kind: 'malformed' }; } catch { state = { kind: 'malformed' }; } try { closeDescriptor(fd, 'lock-owner-close'); } catch { return { kind: 'malformed' }; } return state; }
function validTiming(value: number, positive: boolean): boolean { return Number.isFinite(value) && value <= MAX_TIMING_MS && (positive ? value > 0 : value >= 0); }
const sleepDefault = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
/** Acquires a fully-published private lock directory; it never falls back to unlocked operation. */
export async function acquirePrivateLock(lockPath: string, options: PrivateLockOptions): Promise<PrivateLockHandle> {
  if (!validTiming(options.acquireTimeoutMs, false) || !validTiming(options.leaseMs, true)) throw new Error('invalid private lock timing');
  const canonical = assertUnderCaptureRoot(lockPath); const provider = options.pidBirthProvider ?? processPidBirthProvider; const self = provider.read(process.pid); if (self.status !== 'found') throw new Error(`cannot identify lock owner birth: ${self.status === 'unknown' ? self.reason : 'process absent'}`);
  const now = options.nowNs ?? process.hrtime.bigint; const enforceTimeout = options.acquireTimeoutMs > 0; const deadline = now() + BigInt(Math.floor(options.acquireTimeoutMs * 1e6)); const sleep = options.sleep ?? sleepDefault; const random = options.token ?? lockToken;
  const publish = (): { owner: LockOwner; generation: Identity } | undefined => pinnedParent(canonical, name => {
    hook('lock', 'beforePublishAttempt', canonical, name);
    const token = random(); if (!/^[0-9a-f]{32,}$/.test(token)) throw new Error('lock token source returned unsafe token');
    const stage = `.${name}.${process.pid}.${token}.pending`; const owner: LockOwner = { version: 1, token, pid: process.pid, birth: self.identity, leaseDeadlineNs: (now() + BigInt(Math.floor(options.leaseMs * 1e6))).toString() };
    let inside = false; let stageIdentity: Identity | undefined; let ownerIdentity: Identity | undefined; let primary: unknown;
    try {
      fs.mkdirSync(stage, { mode: DIR_MODE }); stageIdentity = identity(fs.lstatSync(stage));
      const stageParent = identity(fs.statSync('.'));
      hook('lock', 'afterStageMkdirPinned', path.resolve(process.cwd(), stage), stage);
      hook('lock', 'beforeStageChdir', path.resolve(process.cwd(), stage), stage);
      process.chdir(stage); inside = true;
      hook('lock', 'afterStageChdirBeforeIdentityCheck', path.resolve(process.cwd()), stage);
      if (!sameIdentity(stageIdentity, identity(fs.statSync('.'))) || !sameIdentity(stageParent, identity(fs.statSync('..')))) throw new Error('lock stage changed while pinning');
      privateDirHere();
      const fd = openRegular('owner', fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, true, opened => { ownerIdentity = identity(fs.fstatSync(opened)); }, 'lock-owner-close', 'lock'); let ownerPrimary: unknown;
      try { writeAll(fd, JSON.stringify(owner), 'lock-owner-write'); syscall('lock-owner-fsync', () => fs.fsyncSync(fd)); hook('lock', 'afterOwnerWrite', path.resolve(process.cwd(), 'owner'), 'owner'); } catch (error) { ownerPrimary = error; }
      try { closeDescriptor(fd, 'lock-owner-close'); } catch (closeError) { if (ownerPrimary) combineFailure(ownerPrimary, closeError, 'lock owner publication failed'); throw closeError; }
      if (ownerPrimary) throw ownerPrimary;
      const dfd = fs.openSync('.', fs.constants.O_RDONLY | fs.constants.O_DIRECTORY); try { syscall('lock-stage-dir-fsync', () => fs.fsyncSync(dfd)); } finally { fs.closeSync(dfd); }
      process.chdir('..'); inside = false;
      if (!sameIdentity(stageParent, identity(fs.statSync('.')))) throw new Error('lock stage parent changed before publication');
      if (enforceTimeout && options.acquireTimeoutMs > 0 && now() >= deadline) throw new Error(`private lock acquisition timed out: ${canonical}`);
      hook('lock', 'beforePublishRename', canonical, name); options.beforePublishRename?.();
      const currentOwner = fs.lstatSync(path.join(stage, 'owner'));
      if (!ownerIdentity || !currentOwner.isFile() || !sameIdentity(ownerIdentity, identity(currentOwner))) throw new Error('lock owner changed while publishing');
      try {
        syscall('lock-publish-rename', () => fs.renameSync(stage, name));
        const generation = identity(fs.lstatSync(name));
        if (enforceTimeout && options.acquireTimeoutMs > 0 && now() >= deadline) {
          // The rename published this exact stage; retire only that retained generation.
          if (sameIdentity(generation, identity(fs.lstatSync(name)))) { process.chdir(name); try { if (sameIdentity(generation, identity(fs.statSync('.')))) { try { fs.unlinkSync('owner'); } catch (error) { if (!isMissing(error)) throw error; } } } finally { process.chdir('..'); } try { if (sameIdentity(generation, identity(fs.lstatSync(name)))) fs.rmdirSync(name); } catch (error) { if (!isMissing(error) && errno(error) !== 'ENOTEMPTY') throw error; } }
          throw new Error(`private lock acquisition timed out: ${canonical}`);
        }
        return { owner, generation };
      } catch (error) { if (errno(error) === 'EEXIST' || errno(error) === 'ENOTEMPTY' || errno(error) === 'ENOTDIR') return undefined; throw error; }
    } catch (error) { primary = error; throw error; } finally {
      if (inside) process.chdir('..');
      // Only remove the exact staging generation this attempt created. A substituted
      // pathname is untrusted and deliberately left for its owner.
      try {
        const current = identity(fs.lstatSync(stage));
        if (stageIdentity && sameIdentity(current, stageIdentity)) {
          hook('lock', 'beforeStageCleanup', path.resolve(process.cwd(), stage), stage);
          const rechecked = identity(fs.lstatSync(stage));
          if (sameIdentity(rechecked, stageIdentity)) {
            process.chdir(stage);
            if (sameIdentity(stageIdentity, identity(fs.statSync('.')))) {
              try { const child = fs.lstatSync('owner'); if (child.isFile()) { for (let attempt = 0; attempt < 2; attempt++) { try { syscall('artifact-cleanup-unlink', () => fs.unlinkSync('owner')); break; } catch (error) { if (isMissing(error) || attempt) throw error; } } } } catch (error) { if (!isMissing(error)) throw error; }
              process.chdir('..');
              const finalStage = fs.lstatSync(stage);
              if (sameIdentity(stageIdentity, identity(finalStage)) && finalStage.isDirectory()) syscall('lock-canonical-rmdir', () => fs.rmdirSync(stage));
            } else process.chdir('..');
          }
        }
      } catch (error) { if (!isMissing(error) && errno(error) !== 'ENOTEMPTY') { if (primary) combineFailure(primary, error, 'lock stage cleanup failed'); throw error; } }
    }
  }, true, 'lock');
  const retire = (): boolean => pinnedParent(canonical, name => {
    try {
      let stat: fs.Stats; try { stat = fs.lstatSync(name); } catch (error) { return isMissing(error); }
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('malformed private lock publication');
      const parent = identity(fs.statSync('.')); const generation = identity(stat); try { process.chdir(name); } catch (error) { if (isMissing(error)) return true; throw error; }
      if (!sameIdentity(generation, identity(fs.statSync('.')))) { process.chdir('..'); return true; }
      const state = ownerStateHere(); process.chdir('..'); if (!sameIdentity(parent, identity(fs.statSync('.')))) return true;
      if (state.kind === 'malformed') throw new Error('malformed private lock publication');
      if (state.kind === 'missing') { hook('lock', 'beforeCanonicalRmdir', canonical, name); options.beforeCanonicalRmdir?.(); try { const final = fs.lstatSync(name); if (!sameIdentity(generation, identity(final)) || !final.isDirectory()) return true; syscall('lock-canonical-rmdir', () => fs.rmdirSync(name)); } catch (error) { if (!isMissing(error) && errno(error) !== 'ENOTEMPTY') throw error; } return true; }
      const owner = state.owner; if (now() < BigInt(owner.leaseDeadlineNs)) return false;
      const observed = provider.read(owner.pid); if (observed.status === 'unknown' || (observed.status === 'found' && sameBirth(observed.identity, owner.birth))) return false;
      try { process.chdir(name); } catch (error) { if (isMissing(error)) return true; throw error; }
      if (!sameIdentity(generation, identity(fs.statSync('.')))) { process.chdir('..'); return true; }
      const current = ownerStateHere(); if (current.kind !== 'valid' || !sameOwner(current.owner, owner)) { process.chdir('..'); return true; }
      hook('lock', 'afterCanonicalOwnerValidation', path.resolve(process.cwd(), 'owner'), 'owner'); options.afterOwnerValidated?.(); try { syscall('artifact-cleanup-unlink', () => fs.unlinkSync('owner')); } catch (error) { if (ownerStateHere().kind !== 'missing') throw error; } hook('lock', 'afterOwnerRemoval', path.resolve(process.cwd(), 'owner'), 'owner'); options.afterOwnerRemoved?.(); process.chdir('..'); hook('lock', 'beforeCanonicalRmdir', canonical, name); options.beforeCanonicalRmdir?.();
      try { const final = fs.lstatSync(name); if (!sameIdentity(generation, identity(final)) || !final.isDirectory()) return true; syscall('lock-canonical-rmdir', () => fs.rmdirSync(name)); } catch (error) { if (!isMissing(error) && errno(error) !== 'ENOTEMPTY') throw error; } return true;
    } catch (error) { if (isMissing(error)) return true; throw error; }
  }, true, 'lock');
  let immediate = true;
  for (;;) {
    if (!immediate && now() >= deadline) throw new Error(`private lock acquisition timed out: ${canonical}`);
    immediate = false;
    const published = publish();
    if (published) {
      const owner = published.owner;
      let released = false; let ownerRemoved = false; const acquiredGeneration = published.generation;
      return { token: owner.token, ownerBirth: self.identity, release() {
        if (released) return;
        pinnedParent(canonical, name => {
          let stat: fs.Stats;
          try { stat = fs.lstatSync(name); } catch (error) { if (isMissing(error)) { released = true; return; } throw error; }
          if (stat.isSymbolicLink() || !stat.isDirectory()) return;
          const generation = identity(stat);
          if (!sameIdentity(acquiredGeneration, generation)) return;
          const parent = identity(fs.statSync('.'));
          if (!ownerRemoved) {
            try { process.chdir(name); } catch (error) { if (isMissing(error)) { released = true; return; } throw error; }
            if (!sameIdentity(generation, identity(fs.statSync('.')))) { process.chdir('..'); return; }
            const current = ownerStateHere();
            if (current.kind !== 'valid' || !sameOwner(current.owner, owner)) { process.chdir('..'); return; }
            hook('lock', 'afterCanonicalOwnerValidation', path.resolve(process.cwd(), 'owner'), 'owner'); options.afterOwnerValidated?.(); try { syscall('artifact-cleanup-unlink', () => fs.unlinkSync('owner')); ownerRemoved = true; } catch (error) { if (ownerStateHere().kind === 'missing') ownerRemoved = true; throw error; } hook('lock', 'afterOwnerRemoval', path.resolve(process.cwd(), 'owner'), 'owner'); options.afterOwnerRemoved?.(); process.chdir('..');
          }
          if (!sameIdentity(parent, identity(fs.statSync('.')))) throw new Error('lock parent changed before release');
          hook('lock', 'beforeCanonicalRmdir', canonical, name); options.beforeCanonicalRmdir?.();
          try { const final = fs.lstatSync(name); if (!sameIdentity(acquiredGeneration, identity(final)) || !final.isDirectory()) return; syscall('lock-canonical-rmdir', () => fs.rmdirSync(name)); released = true; } catch (error) { if (isMissing(error)) { released = true; return; } if (errno(error) !== 'ENOTEMPTY') throw error; }
        }, true, 'lock');
      } };
    }
    retire();
    if (now() >= deadline) throw new Error(`private lock acquisition timed out: ${canonical}`);
    await sleep(Math.max(0, Math.min(10, Number((deadline - now()) / 1_000_000n))));
  }
}
