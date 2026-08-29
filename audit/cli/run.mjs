import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { auditRoot, getCase } from "../core/registry.mjs";
import { startFixture } from "../core/server.mjs";
import { launchChrome, targetUrl } from "../core/chrome.mjs";
import { startCdpProxy } from "../core/cdp-proxy.mjs";
import { connect } from "../core/cdp-client.mjs";
import { invokeCapture } from "../core/capture-invoke.mjs";
import { AuditMetaSchema, OracleSchema } from "../core/schema.mjs";

const execFileAsync = promisify(execFile);
const PROMPT_REVISION = "v1";
const HANDOFF_SETTLE_MS = 4_000;
const PRIVATE_ORACLE_FIELDS = ["plantedCondition", "requiredDiagnosisFacts", "requiredEvidence", "plausibleWrongAnswer"];

function usage() {
  return "Usage: audit run start --case <case-id> [--model <model-version>]";
}

function parseArgs(args) {
  if (args.length === 0) throw new Error(usage());
  let caseId;
  let model = process.env.AUDIT_MODEL ?? "operator";
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option !== "--case" && option !== "--model") throw new Error(`Unknown audit run option: ${option}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${option} needs a value`);
    if (option === "--case") {
      if (caseId) throw new Error("--case may be provided once");
      caseId = value;
    } else model = value;
    index += 1;
  }
  if (!caseId) throw new Error("--case needs a value");
  return { entry: getCase(caseId), model };
}

async function readOracleInput(entry) {
  const oracle = OracleSchema.parse(JSON.parse(await readFile(join(entry.oracleDir, "oracle.json"), "utf8")));
  if (oracle.caseId !== entry.id || oracle.opaqueCaseId !== entry.opaqueId || oracle.fixtureRevision !== entry.revision) throw new Error(`Oracle identity does not match registry for ${entry.id}`);
  return {
    opaqueCaseId: oracle.opaqueCaseId,
    vagueSymptom: oracle.vagueSymptom,
    budgets: oracle.budgets,
    chromeBuild: oracle.environment.chromeBuild,
    browserFlags: oracle.environment.flags,
  };
}

async function fixtureModule(entry) {
  return (await import(pathToFileURL(resolve(entry.fixtureDir, "fixture.mjs")).href)).default;
}

async function captureBuildHash() {
  return (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: auditRoot })).stdout.trim();
}

function renderPrompt(template, values) {
  let rendered = template;
  for (const [name, value] of Object.entries(values)) rendered = rendered.replaceAll(`{{${name}}}`, String(value));
  if (/{{[a-z_]+}}/.test(rendered)) throw new Error("Blind-node prompt has an unrendered placeholder");
  return rendered;
}

function assertInitialRunOpacity({ oracle, paths }) {
  const forbiddenValues = [
    oracle.plantedCondition,
    oracle.plausibleWrongAnswer,
    ...oracle.requiredDiagnosisFacts.flatMap((item) => [item.fact, item.why]),
    ...oracle.requiredEvidence.flatMap((item) => [item.evidence, item.why]),
  ].filter((value) => typeof value === "string" && value.length > 0);
  for (const [label, contents] of Object.entries(paths)) {
    for (const field of PRIVATE_ORACLE_FIELDS) {
      if (contents.includes(`"${field}"`) || contents.includes(field)) throw new Error(`Initial run ${label} leaks private oracle field ${field}`);
    }
    for (const value of forbiddenValues) {
      if (contents.includes(value)) throw new Error(`Initial run ${label} leaks private oracle content`);
    }
  }
}

async function assertRunDirectoryShape(runDir) {
  const names = (await readdir(runDir)).sort();
  const expected = ["cdp-connections.ndjson", "meta.json", "prompt.md", "report.md", "transcript.ndjson"];
  if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error(`Initial run directory has unexpected contents: ${names.join(", ")}`);
}

async function preflight(entry, browserFlags, resources) {
  const usedPorts = new Set();
  const fixture = await fixtureModule(entry);
  for (const variant of ["faulty", "healthy"]) {
    resources.fixtureServer = await startFixture({ caseId: entry.id, variant, runId: `preflight-${randomUUID()}` });
    let cdp;
    try {
      resources.chrome = await launchChrome({ fixtureUrl: resources.fixtureServer.url, flavor: fixture.chromeFlavor, args: browserFlags, handleSignals: false, onStarted: (resource) => { resources.chrome = resource; } });
      usedPorts.add(resources.chrome.port);
      cdp = await connect(`http://127.0.0.1:${resources.chrome.port}`);
      const capture = (argv, options = {}) => invokeCapture(argv, { ...options, env: { ...options.env, CDP_PORT: String(resources.chrome.port) } });
      const result = await resources.fixtureServer.preflight({ url: targetUrl(resources.fixtureServer.url), cdp, capture });
      if (!result.ok || result.assertions?.some((assertion) => !assertion.ok)) throw new Error(`${entry.id} ${variant} preflight failed`);
    } finally {
      try { await cdp?.close(); }
      finally {
        try { await resources.chrome?.stop(); }
        finally {
          resources.chrome = undefined;
          await resources.fixtureServer?.stop();
          resources.fixtureServer = undefined;
        }
      }
    }
  }
  return usedPorts;
}

async function startProxyOutside(ports, targetPort, logPath) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const proxy = await startCdpProxy({ targetPort, logPath });
    if (!ports.has(proxy.port)) return proxy;
    await proxy.stop();
  }
  throw new Error("Could not allocate a CDP proxy port distinct from preflight targets");
}

function printedEnvironment({ runId, scratchDir, promptPath, transcriptPath, fixtureUrl, proxyPort }) {
  const wrapperDir = join(auditRoot, "wrapper");
  return [
    `Prompt: ${promptPath}`,
    `Scratch: ${scratchDir}`, 
    `Fixture URL: ${fixtureUrl}`,
    "Wrapper environment:",
    `  AUDIT_RUN_ID=${runId}`,
    `  AUDIT_TRANSCRIPT=${transcriptPath}`,
    `  PATH=${wrapperDir}:$PATH`,
    `  CDP_PORT=${proxyPort}`,
    "Stop this run with Ctrl-C.",
  ];
}

export async function start(args) {
  const { entry, model } = parseArgs(args);
  if (entry.status !== "built") throw new Error(`Audit fixture ${entry.id} is not built`);
  const [input, template, buildHash] = await Promise.all([
    readOracleInput(entry),
    readFile(join(auditRoot, "prompt", "blind-node.v1.md"), "utf8"),
    captureBuildHash(),
  ]);
  const runId = `${input.opaqueCaseId}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const runDir = join(auditRoot, "runs", runId);
  const paths = {
    meta: join(runDir, "meta.json"), transcript: join(runDir, "transcript.ndjson"), connections: join(runDir, "cdp-connections.ndjson"), report: join(runDir, "report.md"), prompt: join(runDir, "prompt.md"), scratch: null,
  };
  const startedAt = new Date().toISOString();
  const meta = {
    caseId: entry.id,
    runId,
    captureBuildHash: buildHash,
    fixtureRevision: entry.revision,
    promptRevision: PROMPT_REVISION,
    chromeBuild: input.chromeBuild,
    model,
    hostClass: `${process.platform}-${process.arch}`,
    startedAt,
    browserFlags: input.browserFlags,
    stopReason: "running",
    infrastructureFailure: false,
  };
  let fixtureServer;
  let chrome;
  let proxy;
  let stopped = false;
  let signal;
  const stop = async (stopReason, infrastructureFailure = false) => {
    if (stopped) return;
    stopped = true;
    meta.stopReason = stopReason;
    meta.infrastructureFailure = infrastructureFailure;
    const cleanup = await Promise.allSettled([proxy?.stop(), chrome?.stop(), fixtureServer?.stop()]);
    await writeFile(paths.meta, `${JSON.stringify(AuditMetaSchema.parse(meta), null, 2)}\n`);
    const failures = cleanup.filter((result) => result.status === "rejected").map((result) => result.reason);
    if (failures.length) throw new AggregateError(failures, "Audit run teardown failed");
  };
  const onSignal = (received) => {
    signal = received;
    void stop(`stopped by ${received}`).then(() => process.exit(0), (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
  };
  process.once("SIGINT", () => onSignal("SIGINT"));
  process.once("SIGTERM", () => onSignal("SIGTERM"));
  try {
    await mkdir(runDir, { recursive: true });
    paths.scratch = await mkdtemp(join(tmpdir(), `${runId}-`));
    await Promise.all([writeFile(paths.transcript, ""), writeFile(paths.connections, ""), writeFile(paths.report, "")]);
    const preflightPorts = await preflight(entry, input.browserFlags, { get fixtureServer() { return fixtureServer; }, set fixtureServer(value) { fixtureServer = value; }, get chrome() { return chrome; }, set chrome(value) { chrome = value; } });
    fixtureServer = await startFixture({ caseId: entry.id, variant: "faulty", runId });
    const fixture = await fixtureModule(entry);
    chrome = await launchChrome({ fixtureUrl: fixtureServer.url, flavor: fixture.chromeFlavor, args: input.browserFlags, handleSignals: false, onStarted: (resource) => { chrome = resource; } });
    proxy = await startProxyOutside(preflightPorts, chrome.port, paths.connections);
    const fixtureUrl = targetUrl(fixtureServer.url);
    const prompt = renderPrompt(template, {
      opaque_run_id: runId,
      fixture_url: fixtureUrl,
      vague_symptom: input.vagueSymptom,
      capture_call_budget: input.budgets.calls,
      elapsed_budget_minutes: input.budgets.minutes,
      stdout_budget_tokens: input.budgets.stdoutTokens,
    });
    await writeFile(paths.prompt, prompt);
    await writeFile(join(paths.scratch, "prompt.md"), prompt);
    const shim = `#!/bin/sh\nexport AUDIT_RUN_ID=${runId}\nexport AUDIT_TRANSCRIPT=${paths.transcript}\nexport CDP_PORT=${proxy.port}\nexec ${join(auditRoot, "wrapper", "capture")} "$@"\n`;
    await writeFile(join(paths.scratch, "capture"), shim, { mode: 0o700 });
    await chmod(join(paths.scratch, "capture"), 0o700);
    const rawOracle = OracleSchema.parse(JSON.parse(await readFile(join(entry.oracleDir, "oracle.json"), "utf8")));
    assertInitialRunOpacity({ oracle: rawOracle, paths: { meta: JSON.stringify(meta), prompt, shim, transcript: "", connections: "", report: "" } });
    await writeFile(paths.meta, `${JSON.stringify(AuditMetaSchema.parse(meta), null, 2)}\n`);
    await assertRunDirectoryShape(runDir);
    const lines = printedEnvironment({ runId, scratchDir: paths.scratch, promptPath: join(paths.scratch, "prompt.md"), transcriptPath: paths.transcript, fixtureUrl, proxyPort: proxy.port });
    console.log(`${lines.join("\n")}\nInitializing CDP handoff; wait for Run ready before launching the agent.`);
    await new Promise((resolve) => setTimeout(resolve, HANDOFF_SETTLE_MS));
    await Promise.all([writeFile(paths.connections, ""), writeFile(paths.transcript, "")]);
    meta.startedAt = new Date().toISOString();
    await writeFile(paths.meta, `${JSON.stringify(AuditMetaSchema.parse(meta), null, 2)}\n`);
    console.log("Run ready.");
    await new Promise((resolve) => {
      const poll = () => signal ? resolve() : setTimeout(poll, 1_000);
      poll();
    });
  } catch (error) {
    try {
      await stop("infrastructure failure", true);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Audit run startup failed and teardown was incomplete");
    }
    throw error;
  }
}
