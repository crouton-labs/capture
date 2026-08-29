import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gradeRun } from "./grade.mjs";

const now = "2026-01-01T00:00:00.000Z";
const later = "2026-01-01T00:00:01.000Z";

function oracle({ status = "shipped" } = {}) {
  return {
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
        writeFile(join(runDir, "meta.json"), `${JSON.stringify({ caseId: "case-test", runId: "run", captureBuildHash: "build", fixtureRevision: "1", promptRevision: "v1", chromeBuild: "chrome", model: "model", hostClass: "host", startedAt: now, browserFlags: [], ...meta })}\n`),
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

test("an unaccounted CDP connection invalidates an otherwise correct run", async (t) => {
  const connection = { connId: 1, acceptedAt: "2026-01-01T00:01:00.000Z", closedAt: "2026-01-01T00:01:01.000Z", remoteAddr: "127.0.0.1", remotePort: 1, bytesToBrowser: 0, bytesToClient: 0, firstRequestLine: "GET /json/version HTTP/1.1" };
  const paths = await fixture(t, { connections: [connection] });
  const result = await gradeRun({ runId: "run", ...paths, facts });
  assert.equal(result.record.grade.finalClass, "invalid");
  assert.equal(result.record.grade.cdpAccounting.unaccounted, 1);
});

test("a report that does not reproduce the symptom fails despite favorable fact verdicts", async (t) => {
  const paths = await fixture(t, { reportValue: report.replace("Symptom reproduced: yes", "Symptom reproduced: no") });
  const result = await gradeRun({ runId: "run", ...paths, facts });
  assert.equal(result.record.grade.finalClass, "fail");
  assert.match(result.record.grade.reasons.join("\n"), /does not state that the symptom was reproduced/);
});

test("capability help does not count as successful intended evidence", async (t) => {
  const paths = await fixture(t, { events: [event(1, ["-h"]), event(2, ["page", "inspect", "--help"])] });
  const result = await gradeRun({ runId: "run", ...paths, facts });
  assert.equal(result.record.routeMetrics.firstIntendedCapabilityOrdinal, null);
  assert.equal(result.record.grade.finalClass, "diagnosis-only");
});

test("incompatible reference provenance invalidates the run", async (t) => {
  const paths = await fixture(t, { meta: { hostClass: "other-host" } });
  const result = await gradeRun({ runId: "run", ...paths, facts });
  assert.equal(result.record.grade.finalClass, "invalid");
  assert.match(result.record.grade.reasons.join("\n"), /host class does not match reference/);
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
