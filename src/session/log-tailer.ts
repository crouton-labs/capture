/**
 * Session log tailer ownership.
 *
 * The command process opens the contained destination descriptor, starts this
 * executable's hidden worker route as a detached process-group leader, records
 * its PID birth identity and private control socket, registers that complete
 * handle, and confirms the registration over the control socket before reporting
 * success. The worker invokes `tail` with argv only, timestamps its lines onto
 * the inherited destination descriptor, self-terminates if the registration
 * confirmation never arrives, and drains on a nonce-authenticated control
 * request from `session stop`. A running worker also self-terminates when its
 * recorded control socket stops existing: that socket is the one channel any
 * owner can reach it through, so a worker without it is an unowned orphan.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { captureError } from '../errors.js';
import {
  ensurePrivateDir,
  LOG_TAILER_NONCE,
  LOG_TAILER_SOCKET_DIR,
  LOG_TAILER_SOCKET_TOKEN,
  openPrivateAppendFd,
  parseRegisteredLogTailer,
  processPidBirthProvider,
  sameBirth,
  type PidBirth,
  type PidBirthProvider,
  type RegisteredLogTailer,
} from './artifacts.js';

const READINESS_FD = 3;
/** Bounded positive milliseconds — the grammar for every worker `--… <ms>` flag. */
const WORKER_MS = /^[1-9][0-9]{0,6}$/;
const CONTROL_MESSAGE_LIMIT = 4096;
const WORKER_CHILD_EXIT_TIMEOUT_MS = 2_000;

export interface LogTailWorld {
  /** Node argv before the hidden route token. */
  entryArgv(): string[];
  pidBirthProvider: PidBirthProvider;
  readinessTimeoutMs: number;
  teardownWaitMs: number;
  /** How long a ready worker waits for its registration confirmation before self-terminating. */
  confirmTimeoutMs: number;
  /** How often a running worker re-verifies its recorded control socket still exists. */
  orphanCheckIntervalMs: number;
}

const productionWorld: LogTailWorld = {
  entryArgv: () => [...process.execArgv, process.argv[1]],
  pidBirthProvider: processPidBirthProvider,
  readinessTimeoutMs: 10_000,
  teardownWaitMs: 5_000,
  confirmTimeoutMs: 10_000,
  orphanCheckIntervalMs: 5_000,
};
let world: LogTailWorld = productionWorld;

/** Test seam for the executable entry and process-identity provider. */
export function __setLogTailWorld(next?: Partial<LogTailWorld>): void {
  world = next ? { ...productionWorld, ...next } : productionWorld;
}

function socketDir(create: boolean): string {
  return create ? ensurePrivateDir(LOG_TAILER_SOCKET_DIR) : LOG_TAILER_SOCKET_DIR;
}

function socketPathForToken(token: string, createDir: boolean): string {
  if (!LOG_TAILER_SOCKET_TOKEN.test(token)) throw new Error('invalid log tailer socket token');
  return path.join(socketDir(createDir), `${token}.sock`);
}

/** The throwing point-of-use gate over the neutral strict parser in artifacts. */
function requireRegisteredLogTailer(value: unknown): RegisteredLogTailer {
  const record = parseRegisteredLogTailer(value);
  if (!record) throw captureError('artifact', 'invalid_log_tailer_record', 'Session metadata contains an invalid log tailer registration.');
  return record;
}

function readRequiredBirth(provider: PidBirthProvider, pid: number): PidBirth {
  const observed = provider.read(pid);
  if (observed.status === 'found') return observed.identity;
  const detail = observed.status === 'unknown' ? observed.reason : 'process absent';
  throw captureError('internal', 'log_tailer_identity_failed', `Could not establish log tailer birth identity: ${detail}.`);
}

type Ownership = 'same' | 'gone';
function ownership(record: Pick<RegisteredLogTailer, 'pid' | 'birth'>, provider: PidBirthProvider): Ownership {
  const observed = provider.read(record.pid);
  if (observed.status === 'unknown') {
    throw captureError('cleanup', 'log_tailer_identity_unknown', `Could not establish log tailer pid ${record.pid} identity: ${observed.reason}.`);
  }
  return observed.status === 'found' && sameBirth(observed.identity, record.birth) ? 'same' : 'gone';
}

function socketIdentity(socketPath: string): { dev: string; ino: string } {
  const stat = fs.lstatSync(socketPath, { bigint: true });
  if (!stat.isSocket()) throw new Error(`log tailer control path is not a socket: ${socketPath}`);
  return { dev: stat.dev.toString(), ino: stat.ino.toString() };
}

function unlinkRecordedSocket(record: Pick<RegisteredLogTailer, 'socketPath' | 'socketDev' | 'socketIno'>): void {
  let current: fs.BigIntStats;
  try { current = fs.lstatSync(record.socketPath, { bigint: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  if (!current.isSocket()
      || current.dev.toString() !== record.socketDev
      || current.ino.toString() !== record.socketIno) return;
  fs.unlinkSync(record.socketPath);
}

function closeOwnedFd(fd: number | undefined): undefined {
  if (fd !== undefined) fs.closeSync(fd);
  return undefined;
}

function awaitChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('exit', onGone);
      child.removeListener('error', onGone);
      resolve(value);
    };
    const onGone = (): void => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once('exit', onGone);
    child.once('error', onGone);
  });
}

async function terminateOwnedGroup(child: ChildProcess, pid: number, birth: PidBirth | undefined, provider: PidBirthProvider): Promise<void> {
  const canSignal = (): boolean => {
    if (!birth) return child.exitCode === null && child.signalCode === null;
    return ownership({ pid, birth }, provider) === 'same';
  };
  // A failed group signal is never proof of a live worker: a group whose only
  // member is already a zombie yields EPERM on macOS. The exit/birth
  // convergence checks below are the authority — a signal error surfaces only
  // if the group never proves gone.
  let signalError: unknown;
  const signalGroup = (signal: NodeJS.Signals): void => {
    if (!canSignal()) return;
    try { process.kill(-pid, signal); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') signalError = error; }
  };
  signalGroup('SIGTERM');
  if (await awaitChildExit(child, 1_000)) return;
  signalGroup('SIGKILL');
  if (await awaitChildExit(child, 2_000)) return;
  if (birth && ownership({ pid, birth }, provider) === 'gone') return;
  throw captureError('cleanup', 'log_tailer_rollback_failed', `Could not reap log tailer process group ${pid}.`, signalError);
}

function awaitReadiness(child: ChildProcess, timeoutMs: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const pipe = child.stdio[READINESS_FD] as NodeJS.ReadableStream | null;
    if (!pipe) { reject(new Error('log tailer readiness pipe was not created')); return; }
    let input = '';
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pipe.removeListener('data', onData);
      pipe.removeListener('error', onError);
      pipe.removeListener('end', onEnd);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
      try { (pipe as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.(); } catch { /* descriptor is already closing */ }
      action();
    };
    const onData = (chunk: Buffer): void => {
      input += chunk.toString('utf-8');
      if (input.length > CONTROL_MESSAGE_LIMIT) {
        finish(() => reject(new Error('log tailer readiness response exceeded its bound')));
        return;
      }
      const newline = input.indexOf('\n');
      if (newline >= 0) finish(() => resolve(input.slice(0, newline).trim()));
    };
    const onError = (error: Error): void => finish(() => reject(error));
    const onEnd = (): void => finish(() => reject(new Error('log tailer readiness pipe closed without a response')));
    const onExit = (): void => finish(() => reject(new Error('log tailer exited before signalling readiness')));
    const timer = setTimeout(() => finish(() => reject(new Error(`log tailer did not signal readiness within ${timeoutMs}ms`))), timeoutMs);
    pipe.on('data', onData);
    pipe.once('error', onError);
    pipe.once('end', onEnd);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

export interface StartSessionLogTailerOptions {
  sessionDir: string;
  sourcePath: string;
  name: string;
  register(record: RegisteredLogTailer): Promise<void>;
  /** Removes exactly this registered handle again when startup fails after registration. */
  unregister(record: RegisteredLogTailer): Promise<void>;
}

/** Starts and registers a worker, rolling its owned process group back on failure. */
export async function startSessionLogTailer(options: StartSessionLogTailerOptions): Promise<{ destPath: string; pid: number }> {
  const logsDir = ensurePrivateDir(path.join(options.sessionDir, 'logs'));
  const destPath = path.join(logsDir, `${options.name}.log`);
  const socketToken = crypto.randomBytes(8).toString('hex');
  const socketPath = socketPathForToken(socketToken, true);
  const nonce = crypto.randomBytes(24).toString('hex');

  let destFd: number | undefined;
  let child: ChildProcess | undefined;
  let pid: number | undefined;
  let birth: PidBirth | undefined;
  let registered: RegisteredLogTailer | undefined;
  try {
    destFd = openPrivateAppendFd(destPath);
    child = spawn(
      process.execPath,
      [...world.entryArgv(), '__log-tail-serve', '--source', options.sourcePath, '--socket-token', socketToken, '--confirm-timeout', String(world.confirmTimeoutMs), '--orphan-check', String(world.orphanCheckIntervalMs)],
      {
        detached: true,
        shell: false,
        stdio: ['ignore', destFd, 'ignore', 'pipe'],
        env: { ...process.env, CAPTURE_LOG_TAIL_NONCE: nonce },
      },
    );
    child.on('error', () => { /* readiness/rollback owns the failure */ });
    pid = child.pid;
    if (!pid) throw captureError('internal', 'log_tailer_spawn_failed', 'Failed to spawn the session log tailer process.');

    destFd = closeOwnedFd(destFd);
    birth = readRequiredBirth(world.pidBirthProvider, pid);

    const response = await awaitReadiness(child, world.readinessTimeoutMs);
    if (response !== 'ready') {
      const detail = response.replace(/^error:\s*/, '');
      throw captureError('internal', 'log_tailer_startup_failed', `Log tailer failed to start: ${detail}`);
    }
    const currentBirth = readRequiredBirth(world.pidBirthProvider, pid);
    if (!sameBirth(birth, currentBirth)) {
      throw captureError('internal', 'log_tailer_identity_changed', 'Log tailer identity changed before registration.');
    }
    const socket = socketIdentity(socketPath);
    const record: RegisteredLogTailer = {
      pid,
      name: options.name,
      sourcePath: options.sourcePath,
      birth,
      socketPath,
      socketDev: socket.dev,
      socketIno: socket.ino,
      nonce,
    };
    await options.register(record);
    registered = record;
    // Confirm the durable registration to the worker; a worker never confirmed
    // self-terminates at its deadline instead of tailing as an unowned orphan
    // (the shape a parent killed between spawn and registration would leave).
    let confirmed = false;
    try { confirmed = await requestControl(socketPath, nonce, 'confirm', world.readinessTimeoutMs); }
    catch { /* an unconfirmed worker converges via its own deadline; rollback owns the rest */ }
    if (!confirmed) {
      throw captureError('internal', 'log_tailer_confirm_failed', 'Log tailer did not acknowledge its registration confirmation.');
    }
    child.unref();
    return { destPath, pid };
  } catch (primary) {
    const cleanup: unknown[] = [];
    let workerGone = true;
    if (child && pid) {
      try { await terminateOwnedGroup(child, pid, birth, world.pidBirthProvider); }
      catch (error) { workerGone = false; cleanup.push(error); }
    }
    // A handle registered but never confirmed is unpublished with its worker:
    // once the owned group is provably gone, exactly that record is removed so
    // no phantom registration survives the failure. A worker that could not be
    // reaped keeps its record — the handle is how `session stop` drains it.
    if (registered && workerGone) {
      try { await options.unregister(registered); }
      catch (error) { cleanup.push(error); }
    }
    if (destFd !== undefined) {
      try { destFd = closeOwnedFd(destFd); }
      catch (error) { cleanup.push(error); }
    }
    if (cleanup.length) throw new AggregateError([primary, ...cleanup], 'Log tailer startup failed and rollback was incomplete.');
    throw primary;
  }
}

async function waitUntilGone(record: RegisteredLogTailer, provider: PidBirthProvider, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (ownership(record, provider) === 'gone') return true;
    if (Date.now() >= deadline) return false;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

async function requestControl(socketPath: string, nonce: string, op: 'drain' | 'confirm', timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const connection = net.createConnection(socketPath);
    let input = '';
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      connection.destroy();
      action();
    };
    const timer = setTimeout(() => finish(() => reject(new Error(`log tailer ${op} timed out`))), timeoutMs);
    connection.setEncoding('utf-8');
    connection.on('connect', () => connection.write(`${JSON.stringify({ nonce, op })}\n`));
    connection.on('data', (chunk: string) => {
      input += chunk;
      if (input.length > CONTROL_MESSAGE_LIMIT) {
        finish(() => reject(new Error(`log tailer ${op} response exceeded its bound`)));
        return;
      }
      const newline = input.indexOf('\n');
      if (newline < 0) return;
      let ok = false;
      try { ok = (JSON.parse(input.slice(0, newline)) as { ok?: unknown }).ok === true; } catch { /* malformed response */ }
      finish(() => resolve(ok));
    });
    connection.on('error', error => finish(() => reject(error)));
    connection.on('close', () => finish(() => reject(new Error(`log tailer ${op} connection closed without a reply`))));
  });
}

async function stopOne(record: RegisteredLogTailer, provider: PidBirthProvider): Promise<void> {
  if (ownership(record, provider) === 'gone') {
    unlinkRecordedSocket(record);
    return;
  }

  let acknowledged = false;
  try { acknowledged = await requestControl(record.socketPath, record.nonce, 'drain', Math.min(1_000, world.teardownWaitMs)); }
  catch { /* the identity-verified group signal remains authoritative */ }
  if (acknowledged && await waitUntilGone(record, provider, world.teardownWaitMs)) {
    unlinkRecordedSocket(record);
    return;
  }

  if (ownership(record, provider) === 'gone') {
    unlinkRecordedSocket(record);
    return;
  }
  try { process.kill(-record.pid, 'SIGTERM'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    unlinkRecordedSocket(record);
    return;
  }
  if (!await waitUntilGone(record, provider, world.teardownWaitMs)) {
    throw captureError('cleanup', 'log_tailer_still_alive', `Log tailer pid ${record.pid} (${record.name}) could not be drained or terminated before session stop.`);
  }
  unlinkRecordedSocket(record);
}

/** Drains every strictly validated registered worker before the bundle commit. */
export async function stopSessionLogTailers(entries: unknown[]): Promise<void> {
  const failures: unknown[] = [];
  for (const value of entries) {
    let record: RegisteredLogTailer;
    try { record = requireRegisteredLogTailer(value); }
    catch (error) { failures.push(error); continue; }
    try { await stopOne(record, world.pidBirthProvider); }
    catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'Session stop could not drain every registered log tailer.');
}

interface WorkerArgs {
  sourcePath: string;
  socketToken: string;
  confirmTimeoutMs: number;
  orphanCheckIntervalMs: number;
}

function parseWorkerArgs(argv: string[]): WorkerArgs {
  const usage = 'log tailer expects exactly --source <path> --socket-token <token> --confirm-timeout <ms> --orphan-check <ms>';
  let sourcePath: string | undefined;
  let socketToken: string | undefined;
  let confirmTimeout: string | undefined;
  let orphanCheck: string | undefined;
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (value === undefined) throw new Error(usage);
    if (flag === '--source') {
      if (sourcePath !== undefined) throw new Error('duplicate --source');
      sourcePath = value;
    } else if (flag === '--socket-token') {
      if (socketToken !== undefined) throw new Error('duplicate --socket-token');
      socketToken = value;
    } else if (flag === '--confirm-timeout') {
      if (confirmTimeout !== undefined) throw new Error('duplicate --confirm-timeout');
      confirmTimeout = value;
    } else if (flag === '--orphan-check') {
      if (orphanCheck !== undefined) throw new Error('duplicate --orphan-check');
      orphanCheck = value;
    } else {
      throw new Error(usage);
    }
  }
  if (!sourcePath || !socketToken || !confirmTimeout || !orphanCheck || argv.length !== 8
      || !LOG_TAILER_SOCKET_TOKEN.test(socketToken) || !WORKER_MS.test(confirmTimeout) || !WORKER_MS.test(orphanCheck)) {
    throw new Error(usage);
  }
  return { sourcePath, socketToken, confirmTimeoutMs: Number(confirmTimeout), orphanCheckIntervalMs: Number(orphanCheck) };
}

function nonceMatches(expected: string, candidate: unknown): boolean {
  if (typeof candidate !== 'string') return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(candidate);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function writeReadiness(message: string): boolean {
  try { fs.writeSync(READINESS_FD, message); return true; }
  catch { return false; }
}

function readinessError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `error: ${message.replace(/[\r\n]+/g, ' ').slice(0, 1_000)}\n`;
}

function waitForChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const done = (): void => resolve();
    child.once('exit', done);
    child.once('error', done);
  });
}

function resolvesWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    promise.then(() => finish(true), () => finish(true));
  });
}

async function stopWorkerChild(child: ChildProcess, exited: Promise<void>): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  if (await resolvesWithin(exited, WORKER_CHILD_EXIT_TIMEOUT_MS)) return;
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  if (!await resolvesWithin(exited, WORKER_CHILD_EXIT_TIMEOUT_MS)) throw new Error('tail subprocess did not exit');
}

function closeServer(server: net.Server | undefined, connections: Set<net.Socket>): Promise<void> {
  for (const connection of connections) connection.destroy();
  if (!server?.listening) return Promise.resolve();
  return new Promise(resolve => server.close(() => resolve()));
}

/** Hidden worker route. All startup diagnostics travel over fd 3, never stdout. */
export async function runLogTailer(argv: string[]): Promise<void> {
  let server: net.Server | undefined;
  let tail: ChildProcess | undefined;
  let tailExited: Promise<void> | undefined;
  let reader: readline.Interface | undefined;
  let readerClosed = false;
  let socketPath: string | undefined;
  let ownedSocket: { dev: string; ino: string } | undefined;
  let ready = false;
  let exitCode = 0;
  let orphanCheck: NodeJS.Timeout | undefined;
  let confirmDeadline: NodeJS.Timeout | undefined;
  const clearConfirmDeadline = (): void => {
    if (confirmDeadline === undefined) return;
    clearTimeout(confirmDeadline);
    confirmDeadline = undefined;
  };
  const connections = new Set<net.Socket>();
  let requestStop: ((reason: 'drain' | 'tail-exit' | 'fatal') => void) | undefined;
  const onSigterm = (): void => requestStop?.('drain');

  try {
    const args = parseWorkerArgs(argv);
    const nonce = process.env.CAPTURE_LOG_TAIL_NONCE;
    if (!nonce || !LOG_TAILER_NONCE.test(nonce)) throw new Error('missing or invalid control nonce');
    socketPath = socketPathForToken(args.socketToken, true);

    let stopReason: 'drain' | 'tail-exit' | 'fatal' | undefined;
    const stopped = new Promise<'drain' | 'tail-exit' | 'fatal'>(resolve => {
      requestStop = reason => {
        if (stopReason !== undefined) return;
        stopReason = reason;
        resolve(reason);
      };
    });

    server = net.createServer(connection => {
      connections.add(connection);
      connection.setEncoding('utf-8');
      connection.setTimeout(2_000, () => connection.destroy());
      let input = '';
      let handled = false;
      const reply = (accepted: 'drain' | 'confirm' | false): void => {
        if (handled) return;
        handled = true;
        connection.end(`${JSON.stringify({ ok: accepted !== false })}\n`);
        if (accepted === 'drain') requestStop?.('drain');
        else if (accepted === 'confirm') clearConfirmDeadline();
      };
      connection.on('data', (chunk: string) => {
        input += chunk;
        if (input.length > CONTROL_MESSAGE_LIMIT) { reply(false); return; }
        const newline = input.indexOf('\n');
        if (newline < 0) return;
        let accepted: 'drain' | 'confirm' | false = false;
        try {
          const message = JSON.parse(input.slice(0, newline)) as { op?: unknown; nonce?: unknown };
          if (nonceMatches(nonce, message.nonce) && message.op === 'drain') accepted = 'drain';
          // A confirm is meaningful only while the deadline is still armed.
          else if (nonceMatches(nonce, message.nonce) && message.op === 'confirm' && confirmDeadline !== undefined) accepted = 'confirm';
        } catch { /* invalid control message */ }
        reply(accepted);
      });
      connection.on('error', () => { /* one failed client does not affect ownership */ });
      connection.on('close', () => connections.delete(connection));
    });
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => { server!.removeListener('listening', onListening); reject(error); };
      const onListening = (): void => { server!.removeListener('error', onError); resolve(); };
      server!.once('error', onError);
      server!.once('listening', onListening);
      server!.listen(socketPath);
    });
    ownedSocket = socketIdentity(socketPath);
    server.on('error', () => requestStop?.('fatal'));

    // Orphan self-check: the recorded control socket is the one channel any
    // owner (a registered session handle) can ever reach this worker through.
    // If that directory entry disappears or is replaced, no `session stop` can
    // drain it, so the worker tears itself down instead of tailing forever as
    // an unowned process. Each probe is one lstat; nothing is held open
    // between checks. Only a provable loss of the entry — ENOENT or a
    // different inode — counts; a transiently failing stat never does.
    const ownedSocketPath = socketPath;
    const owned = ownedSocket;
    orphanCheck = setInterval(() => {
      try {
        const current = fs.lstatSync(ownedSocketPath, { bigint: true });
        if (current.isSocket()
            && current.dev.toString() === owned.dev
            && current.ino.toString() === owned.ino) return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return;
      }
      requestStop?.('fatal');
    }, args.orphanCheckIntervalMs);

    const tailEnv = { ...process.env };
    delete tailEnv.CAPTURE_LOG_TAIL_NONCE;
    tail = spawn('tail', ['-f', '--', args.sourcePath], {
      shell: false,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: tailEnv,
    });
    tailExited = waitForChild(tail);
    reader = readline.createInterface({ input: tail.stdout!, crlfDelay: Infinity });
    reader.once('close', () => { readerClosed = true; });
    reader.on('line', line => {
      try { fs.writeSync(1, `${new Date().toISOString()} ${line}\n`); }
      catch { requestStop?.('fatal'); }
    });
    tail.once('exit', () => requestStop?.('tail-exit'));
    tail.once('error', () => requestStop?.('fatal'));
    await new Promise<void>((resolve, reject) => {
      tail!.once('spawn', resolve);
      tail!.once('error', reject);
    });
    if (tail.exitCode !== null || tail.signalCode !== null) throw new Error('tail exited during startup');

    process.once('SIGTERM', onSigterm);
    if (!writeReadiness('ready\n')) throw new Error('parent closed the readiness channel');
    ready = true;
    try { fs.closeSync(READINESS_FD); } catch { /* the parent owns readiness completion */ }
    // A worker never confirmed was never durably registered — its parent died
    // between spawn and registration — so it tears itself down instead of
    // tailing as an orphan no session record owns.
    confirmDeadline = setTimeout(() => { confirmDeadline = undefined; requestStop?.('fatal'); }, args.confirmTimeoutMs);

    const reason = await stopped;
    exitCode = reason === 'drain' ? 0 : 1;
    await stopWorkerChild(tail, tailExited);
    if (reader && !readerClosed) {
      const drained = await resolvesWithin(new Promise<void>(resolve => reader!.once('close', () => resolve())), WORKER_CHILD_EXIT_TIMEOUT_MS);
      if (!drained) throw new Error('tail output did not drain');
    }
  } catch (error) {
    exitCode = 1;
    if (!ready) writeReadiness(readinessError(error));
    if (tail && tailExited) {
      try { await stopWorkerChild(tail, tailExited); } catch { /* process exit code preserves the worker failure */ }
    }
  } finally {
    if (orphanCheck !== undefined) clearInterval(orphanCheck);
    clearConfirmDeadline();
    process.removeListener('SIGTERM', onSigterm);
    try { reader?.close(); } catch { /* child output is already closed */ }
    await closeServer(server, connections);
    if (socketPath && ownedSocket) {
      try {
        const current = socketIdentity(socketPath);
        if (current.dev === ownedSocket.dev && current.ino === ownedSocket.ino) fs.unlinkSync(socketPath);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') exitCode = 1; }
    }
    process.exitCode = exitCode;
  }
}
