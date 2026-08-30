import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gradeRun } from "./grade.mjs";

const now = "2026-01-01T00:00:00.000Z";
const later = "2026-01-01T00:00:01.000Z";

function oracle({ status = "shipped", intendedCapabilityRequiredForPass } = {}) {
  return {
    ...(intendedCapabilityRequiredForPass === undefined ? {} : { intendedCapabilityRequiredForPass }),
    opaqueCaseId: "opaque", caseId: "case-test", fixtureRevision: "1", vagueSymptom: "Broken", plantedCondition: "private",
    requiredDiagnosisFacts: [{ id: "cause", fact: "The concrete cause", why: "Required causal diagnosis" }],
    requiredEvidence: [{ id: "proof", evidence: "The causal measurement", why: "Rules out the alternative" }],
    plausibleWrongAnswer: "The plausible alternative", ranges: { faulty: [], healthy: [] },
    intendedCapability: "test capability", intendedCapabilityMatchers: [["page", "inspect"]], intendedCapabilityStatus: status,
    escapeHatchMatchers: [["cdp"]], environment: { chromeBuild: "chrome", flags: [], coldCache: true, repetitions: 1 }, budgets: { calls: 40, minutes: 25, stdoutTokens: 40_000 },
  };
}

function reference(provisional = false) {
  return { caseId: "case-test", measuredAt: now, provisional, captureBuildHash: "build", chromeBuild: "chrome", hostClass: "host", route: [], totals: { calls: 2, elapsedSeconds: 2, stdoutTokens: 20 }, notes: "reference" };
}

function event(ordinal, argv, { elapsedMs = 1_000, stdoutTokens = 10, exitCode = 0 } = {}) {
  return { runId: "run", ordinal, argv, startedAt: now, endedAt: later, elapsedMs, exitCode, signal: null, stdoutBytes: stdoutTokens * 4, stderrBytes: 0, stdoutTokens, stderrTokens: 0, artifactPaths: [], cwd: "/scratch", pid: 1 };
}

const report = `Outcome
- Symptom reproduced: yes
- Diagnosis: The concrete cause
- Confidence: high

Evidence
- Command ordinal 2 produced the causal measurement.

Investigation path
- The command ordinal where the hypothesis became established: 2
`;

const facts = {
  cause: { present: true, quote: "The concrete cause", ordinals: [2] },
  proof: { present: true, quote: "causal measurement", ordinals: [2] },
  symptomReproduced: { present: true, quote: "Symptom reproduced: yes", ordinals: [2] },
  plausibleWrongAnswer: { present: true, quote: "rules out alternative", ordinals: [2] },
};

async function fixture(t, { events = [event(1, ["-h"]), event(2, ["page", "inspect"])], connections = [], oracleValue = oracle(), referenceValue = reference(), meta = {}, reportValue = report } = {}) {
  const root = await mkdtemp(join(tmpdir(), "capture-grader-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runDir = join(root, "run");
  const oraclePath = join(root, "oracle.json");
  const referencePath = join(root, "reference-route.json");
  await writeFile(join(root, "meta.json"), "");
  await Promise.all([
    writeFile(oraclePath, `${JSON.stringify(oracleValue)}\n`),
    writeFile(referencePath, `${JSON.stringify(referenceValue)}\n`),
    (async () => {
      await (await import("node:fs/promises")).mkdir(runDir);
      await Promise.all([
        writeFile(join(runDir, "meta.json"), `${JSON.stringify({ caseId: "case-test", runId: "run", captureBuildHash: "build", fixtureRevision: "1", promptRevision: "v1", chromeBuild: "chrome", model: "model", hostClass: "host", startedAt: now, browserFlags: [], cdpProxyPort: 50066, ...meta })}\n`),
        writeFile(join(runDir, "transcript.ndjson"), `${events.map((item) => JSON.stringify(item)).join("\n")}\n`),
        writeFile(join(runDir, "cdp-connections.ndjson"), `${connections.map((item) => JSON.stringify(item)).join("\n")}${connections.length ? "\n" : ""}`),
        writeFile(join(runDir, "report.md"), reportValue),
      ]);
    })(),
  ]);
  return { runDir, oraclePath, referencePath };
}

test("pass requires adjudicated facts, intended load-bearing evidence, and all route limits", async (t) => {
  const paths = await fixture(t);
  const result = await gradeRun({ runId: "run", ...paths, facts });
  assert.equal(result.record.grade.finalClass, "pass");
  assert.equal(result.record.routeMetrics.firstIntendedCapabilityOrdinal, 2);
  assert.equal(result.record.routeMetrics.helpCalls, 1);
});

test("missing causal fact produces fail", async (t) => {
  const paths = await fixture(t);
  const result = await gradeRun({ runId: "run", ...paths, facts: { ...facts, cause: { present: false, quote: "", ordinals: [] } } });
  assert.equal(result.record.grade.finalClass, "fail");
  assert.match(result.record.grade.reasons.join("\n"), /required diagnosis fact absent: cause/);
});

test("a correct answer reached by a wasteful route is diagnosis-only", async (t) => {
  const events = [event(1, ["-h"]), event(2, ["page", "inspect"]), event(3, ["tab", "list"]), event(4, ["tab", "list"]), event(5, ["tab", "list"]), event(6, ["tab", "list"]), event(7, ["tab", "list"])];
  const paths = await fixture(t, { events });
  const result = await gradeRun({ runId: "run", ...paths, facts });
  assert.equal(result.record.grade.finalClass, "diagnosis-only");
  assert.match(result.record.grade.reasons.join("\n"), /call ratio exceeds 2x reference \(transcript ordinals: 7\)/);
});

test("a version-only HTTP probe does not invalidate an otherwise correct run", async (t) => {
  for (const [bytesToBrowser, bytesToClient] of [[151, 1_141], [77, 0]]) {
    const connection = { connId: 1, acceptedAt: "2026-01-01T00:01:00.000Z", closedAt: "2026-01-01T00:01:01.000Z", remoteAddr: "127.0.0.1", remotePort: 1, bytesToBrowser, bytesToClient, firstRequestLine: "GET /json/version HTTP/1.1", versionOnlyHttpProbe: true };
    const paths = await fixture(t, { connections: [connection] });
    const result = await gradeRun({ runId: "run", ...paths, facts });
    assert.equal(result.record.grade.finalClass, "pass");
    assert.equal(result.record.grade.cdpAccounting.unaccounted, 0);
  }
});

test("other JSON endpoints and version requests with extra traffic remain unaccounted", async (t) => {
  const unaccounted = [
    ...["/json/list", "/json/new", "/json/activate/target", "/json/close/target"].map((path) => ({ bytesToBrowser: 151, bytesToClient: 1_141, firstRequestLine: `GET ${path} HTTP/1.1` })),
    { bytesToBrowser: 151, bytesToClient: 1_141, firstRequestLine: "GET /json/version HTTP/1.1" },
    { bytesToBrowser: 182, bytesToClient: 558, firstRequestLine: "GET /json/version HTTP/1.1" },
    { bytesToBrowser: 151, bytesToClient: 1_141, firstRequestLine: "GET /json/version HTTP/1.1", versionOnlyHttpProbe: false },
  ];
  for (const connection of unaccounted) {
    const paths = await fixture(t, { connections: [{ connId: 1, acceptedAt: "2026-01-01T00:01:00.000Z", closedAt: "2026-01-01T00:01:01.000Z", remoteAddr: "127.0.0.1", remotePort: 1, ...connection }] });
    const result = await gradeRun({ runId: "run", ...paths, facts });
    assert.equal(result.record.grade.finalClass, "invalid");
    assert.equal(result.record.grade.cdpAccounting.unaccounted, 1);
  }
});

test("a file URL in a wrapped invocation invalidates the run and appears in the worksheet", async (t) => {
  const paths = await fixture(t, { events: [event(1, ["-h"]), event(2, ["page", "exec", "file:///sealed/oracle.json"])] });
  const result = await gradeRun({ runId: "run", ...paths, facts });
  assert.equal(result.record.grade.finalClass, "invalid");
  assert.match(result.record.grade.reasons.join("\n"), /file:\/\/ URL in wrapped invocation \(transcript ordinal 2\)/);
  assert.match(await readFile(join(paths.runDir, "grading-worksheet.md"), "utf8"), /Isolation contamination: file:\/\/ URL in wrapped invocation \(transcript ordinal 2\)/);
});

test("a target-establishing command using an explicit foreign port invalidates the run", async (t) => {
  for (const argv of [
    ["session", "start", "--url", "http://fixture.test", "--port=50067"],
    ["session", "start", "--url", "http://fixture.test", "--port", "50066", "--port", "50067"],
  ]) {
    const paths = await fixture(t, { events: [event(1, ["-h"]), event(2, argv)] });
    const result = await gradeRun({ runId: "run", ...paths, facts });
    assert.equal(result.record.grade.finalClass, "invalid");
    assert.match(result.record.grade.reasons.join("\n"), /target-establishing session start used CDP port 50067 instead of sanctioned proxy port 50066/);
  }
});

test("proxy-targeted and ambient-proxy session starts are not contamination", async (t) => {
  for (const argv of [
    ["session", "start", "--url", "http://host.docker.internal:50011", "--port", "50066"],
    ["session", "start", "--url", "http://fixture.test", "--port=50066"],
    ["session", "start", "--url", "http://fixture.test"],
  ]) {
    const paths = await fixture(t, { events: [event(1, ["-h"]), event(2, argv)] });
    const result = await gradeRun({ runId: "run", ...paths, facts });
    assert.notEqual(result.record.grade.finalClass, "invalid");
    assert.doesNotMatch(result.record.grade.reasons.join("\n"), /Isolation contamination|target-establishing/);
  }
});

test("targetless and failed setup commands are not contamination", async (t) => {
  for (const setupEvent of [
    event(2, ["session", "start"]),
    event(2, ["tab", "open"], { exitCode: 1 }),
  ]) {
    const paths = await fixture(t, { events: [event(1, ["-h"]), setupEvent] });
    const result = await gradeRun({ runId: "run", ...paths, facts });
    assert.notEqual(result.record.grade.finalClass, "invalid");
    assert.doesNotMatch(result.record.grade.reasons.join("\n"), /Isolation contamination|target-establishing/);
  }
});

test("a report that does not reproduce the symptom fails despite favorable fact verdicts", async (t) => {
  const paths = await fixture(t, { reportValue: report.replace("Symptom reproduced: yes", "Symptom reproduced: no") });
  const result = await gradeRun({ runId: "run", ...paths, facts });
  assert.equal(result.record.grade.finalClass, "fail");
  assert.match(result.record.grade.reasons.join("\n"), /does not state that the symptom was reproduced/);
});

test("a case that waives the intended capability passes on other first-class evidence but not on an escape hatch", async (t) => {
  const waived = oracle({ intendedCapabilityRequiredForPass: false });
  const firstClass = await fixture(t, { oracleValue: waived, events: [event(1, ["-h"]), event(2, ["page", "measure"])] });
  const passed = await gradeRun({ runId: "run", ...firstClass, facts });
  assert.equal(passed.record.grade.finalClass, "pass");
  assert.equal(passed.record.routeMetrics.firstIntendedCapabilityOrdinal, null);

  const escapeHatch = await fixture(t, { oracleValue: waived, events: [event(1, ["-h"]), event(2, ["cdp", "send"])] });
  const graded = await gradeRun({ runId: "run", ...escapeHatch, facts });
  assert.equal(graded.record.grade.finalClass, "diagnosis-only");
});

test("capability help does not count as successful intended evidence", async (t) => {
  const paths = await fixture(t, { events: [event(1, ["-h"]), event(2, ["page", "inspect", "--help"])] });
  const result = await gradeRun({ runId: "run", ...paths, facts });
  assert.equal(result.record.routeMetrics.firstIntendedCapabilityOrdinal, null);
  assert.equal(result.record.grade.finalClass, "diagnosis-only");
});

test("reference build drift is recorded without invalidating an otherwise gradeable run", async (t) => {
  const paths = await fixture(t, { referenceValue: { ...reference(), hostClass: "other-host", chromeBuild: "other-chrome", captureBuildHash: "other-build" } });
  const result = await gradeRun({ runId: "run", ...paths, facts });
  assert.equal(result.record.grade.finalClass, "pass");
  assert.deepEqual(result.record.grade.referenceDrift, ["hostClass", "chromeBuild", "captureBuildHash"]);
});

test("run-integrity provenance mismatch still invalidates the run", async (t) => {
  const paths = await fixture(t, { meta: { fixtureRevision: "other-fixture" } });
  const result = await gradeRun({ runId: "run", ...paths, facts });
  assert.equal(result.record.grade.finalClass, "invalid");
  assert.match(result.record.grade.reasons.join("\n"), /run fixture revision does not match oracle/);
});

test("present fact verdicts need retained transcript provenance", async (t) => {
  const paths = await fixture(t);
  await assert.rejects(gradeRun({ runId: "run", ...paths, facts: { ...facts, cause: { present: true, quote: "", ordinals: [] } } }), /present verdicts need a quote/);
});

test("ambiguous transcript ordinals invalidate the run", async (t) => {
  const paths = await fixture(t, { events: [event(1, ["-h"]), event(1, ["page", "inspect"])] });
  const result = await gradeRun({ runId: "run", ...paths, facts: { ...facts, cause: { ...facts.cause, ordinals: [1] }, proof: { ...facts.proof, ordinals: [1] }, symptomReproduced: { ...facts.symptomReproduced, ordinals: [1] }, plausibleWrongAnswer: { ...facts.plausibleWrongAnswer, ordinals: [1] } } });
  assert.equal(result.record.grade.finalClass, "invalid");
  assert.match(result.record.grade.reasons.join("\n"), /not strictly increasing/);
});

test("unshipped intended capabilities are unavailable and provisional references remain stamped", async (t) => {
  const paths = await fixture(t, { oracleValue: oracle({ status: "unshipped" }), referenceValue: reference(true) });
  const stageOne = await gradeRun({ runId: "run", ...paths });
  assert.equal(stageOne.record.grade, undefined);
  assert.equal(stageOne.record.routeMetrics.firstIntendedCapabilityOrdinal, null);
  assert.equal(stageOne.record.referenceProvisional, true);
  const stageTwo = await gradeRun({ runId: "run", ...paths, facts });
  assert.equal(stageTwo.record.grade.firstClassCapability, "unavailable");
  assert.equal(stageTwo.record.grade.finalClass, "diagnosis-only");
  assert.match(stageTwo.record.grade.reasons.join("\n"), /no intended first-class capability/);
});
