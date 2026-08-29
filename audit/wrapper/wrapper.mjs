import { constants, closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { estimateTokens } from '/Users/silasrhyneer/Code/cli/capture/audit/core/tokens.mjs';

const DEFAULT_CAPTURE_BIN = '/Users/silasrhyneer/Code/cli/capture/bin/capture';
const LOCK_RETRY_MS = 5;
const LOCK_ACQUIRE_TIMEOUT_MS = 2_000;
const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 };

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function transcriptFailurePath(transcriptPath) {
  return `${transcriptPath}.failure`;
}

export function assertTranscriptIntegrity(transcriptPath) {
  const failurePath = transcriptFailurePath(transcriptPath);
  if (existsSync(failurePath)) {
    throw new Error(`audit transcript recording failed; inspect ${failurePath}`);
  }
}

function markTranscriptFailure(transcriptPath, error) {
  if (!transcriptPath) return;

  const marker = JSON.stringify({
    failedAt: new Date().toISOString(),
    pid: process.pid,
    error: String(error?.stack ?? error),
  }) + '\n';

  try {
    writeFileSync(transcriptFailurePath(transcriptPath), marker, { flag: 'w' });
  } catch {
    // A preflight failure is surfaced before the child starts. A later disk failure can
    // make even the sidecar unavailable; preserving the child result remains mandatory.
  }
}

function verifyTranscriptPath(transcriptPath) {
  if (!transcriptPath) {
    throw new Error('AUDIT_TRANSCRIPT is required by the instrumented capture wrapper');
  }

  const descriptor = openSync(transcriptPath, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT, 0o600);
  closeSync(descriptor);
}

async function acquireLock(lockPath) {
  const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS;
  for (;;) {
    try {
      return openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) {
        throw new Error('transcript append lock remained unavailable for 2000ms');
      }
      await sleep(LOCK_RETRY_MS);
    }
  }
}

class ArtifactExtractor {
  #decoder = new StringDecoder('utf8');
  #partial = '';
  #candidates = new Set();

  add(chunk) {
    this.#consume(this.#partial + this.#decoder.write(chunk));
  }

  paths() {
    this.#consume(this.#partial + this.#decoder.end() + ' ');
    this.#partial = '';
    return [...this.#candidates].filter((candidate) => isAbsolute(candidate) && existsSync(candidate));
  }

  #consume(text) {
    const tokens = text.split(/\s+/);
    this.#partial = tokens.pop() ?? '';
    for (const token of tokens) {
      for (let start = token.indexOf('/'); start >= 0; start = token.indexOf('/', start + 1)) {
        let candidate = token.slice(start);
        if (candidate.length > 1 && existsSync(candidate)) {
          this.#candidates.add(candidate);
          continue;
        }
        while (/[.,;:)}\]"']$/.test(candidate)) {
          candidate = candidate.slice(0, -1);
          if (candidate.length > 1 && existsSync(candidate)) {
            this.#candidates.add(candidate);
            break;
          }
        }
      }
    }
  }
}

async function appendEvent(transcriptPath, event) {
  const lockPath = `${transcriptPath}.lock`;
  const lock = await acquireLock(lockPath);

  try {
    const prior = readFileSync(transcriptPath, 'utf8').trimEnd();
    let ordinal = 1;
    if (prior) {
      const lastLine = prior.slice(prior.lastIndexOf('\n') + 1);
      const previous = JSON.parse(lastLine).ordinal;
      if (!Number.isSafeInteger(previous) || previous < 1) {
        throw new Error('invalid ordinal in transcript');
      }
      ordinal = previous + 1;
    }

    const line = JSON.stringify({ ...event, ordinal }) + '\n';
    const descriptor = openSync(transcriptPath, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT, 0o600);
    try {
      const bytesWritten = writeSync(descriptor, line);
      if (bytesWritten !== Buffer.byteLength(line)) throw new Error('incomplete transcript append');
    } finally {
      closeSync(descriptor);
    }
  } finally {
    closeSync(lock);
    unlinkSync(lockPath);
  }
}

function pipeOutput(source, destination, onChunk) {
  source.on('data', (chunk) => {
    onChunk(chunk);
    if (!destination.write(chunk)) source.pause();
  });
  destination.on('drain', () => source.resume());
}

export async function runWrapper({ argv = process.argv.slice(2), env = process.env, cwd = process.cwd() } = {}) {
  const transcriptPath = env.AUDIT_TRANSCRIPT;
  try {
    verifyTranscriptPath(transcriptPath);
  } catch (error) {
    markTranscriptFailure(transcriptPath, error);
    process.stderr.write(`capture audit wrapper configuration error: ${error.message}\n`);
    return 70;
  }

  const startedAt = new Date();
  let stdoutBytes = 0;
  let stderrBytes = 0;
  const artifacts = new ArtifactExtractor();
  const child = spawn(env.AUDIT_CAPTURE_BIN || DEFAULT_CAPTURE_BIN, argv, {
    cwd,
    env,
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  pipeOutput(child.stdout, process.stdout, (chunk) => {
    stdoutBytes += chunk.length;
    artifacts.add(chunk);
  });
  pipeOutput(child.stderr, process.stderr, (chunk) => {
    stderrBytes += chunk.length;
  });

  let forwardedSignal = null;
  const forwardSignal = (signal) => {
    if (child.exitCode === null && child.signalCode === null) {
      forwardedSignal = signal;
      child.kill(signal);
    }
  };
  process.on('SIGINT', forwardSignal);
  process.on('SIGTERM', forwardSignal);

  const result = await new Promise((resolve) => {
    child.once('error', (error) => resolve({ exitCode: 1, signal: null, spawnError: error }));
    child.once('close', (exitCode, signal) => resolve({ exitCode, signal, spawnError: null }));
  });

  process.off('SIGINT', forwardSignal);
  process.off('SIGTERM', forwardSignal);

  const endedAt = new Date();
  const event = {
    runId: env.AUDIT_RUN_ID ?? null,
    argv,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    elapsedMs: endedAt.getTime() - startedAt.getTime(),
    exitCode: result.exitCode,
    signal: result.signal,
    stdoutBytes,
    stderrBytes,
    stdoutTokens: estimateTokens(stdoutBytes),
    stderrTokens: estimateTokens(stderrBytes),
    artifactPaths: artifacts.paths(),
    cwd,
    pid: process.pid,
  };

  try {
    await appendEvent(transcriptPath, event);
  } catch (error) {
    markTranscriptFailure(transcriptPath, error);
  }

  if (result.spawnError) {
    process.stderr.write(`${result.spawnError.message}\n`);
    return 1;
  }
  if (result.signal) return SIGNAL_EXIT_CODES[result.signal] ?? 128;
  return result.exitCode ?? (forwardedSignal ? SIGNAL_EXIT_CODES[forwardedSignal] ?? 128 : 1);
}

