import { access, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AuditMetaSchema, CdpConnectionSchema, CommandEventSchema, OracleSchema, ReferenceRouteSchema, RunRecordSchema } from "../core/schema.mjs";
import { getCase } from "../core/registry.mjs";

const auditRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const CDP_GRACE_MS = 2_000;
const CDP_ACCOUNTING_RULE = "A CDP connection is accounted when its accepted-to-closed window overlaps a wrapped invocation window extended by 2 seconds at each end, or when it is a version-only HTTP probe that could not carry CDP traffic.";
const CDP_VERSION_REQUEST = "GET /json/version HTTP/1.1";
const ARCHIVED_RUNS_WITH_UNMARKED_VERSION_PROBES = new Set(["m6-orbit-1788046056091-e4a8273e", "r7-atlas-1788046245618-57483495", "v2-harbor-1788045061244-59efa5e1"]);
const TARGET_ESTABLISHING_COMMANDS = new Map([
  ["session start", "session start"],
  ["tab launch", "tab launch"],
  ["tab open", "tab open"],
  ["tab reset", "tab reset"],
]);
const PLAUSIBLE_WRONG_ANSWER_FACT_ID = "plausibleWrongAnswer";
const SYMPTOM_REPRODUCED_FACT_ID = "symptomReproduced";
const ABSOLUTE_CEILINGS = { calls: 40, elapsedSeconds: 25 * 60, stdoutTokens: 40_000 };
const FIRST_CLASS_ROOTS = new Set(["session", "page", "tab", "measure", "motion", "cdp", "lib"]);
const INTERACTION_COMMANDS = new Set(["click", "type", "navigate", "scroll"]);

function parseArgs(args) {
  if (!Array.isArray(args) || args.length === 0) throw new Error("Usage: audit grade <runId> [--facts facts.json]");
  const [runId, ...rest] = args;
  if (!runId || runId.startsWith("-")) throw new Error("Usage: audit grade <runId> [--facts facts.json]");
  let factsPath = null;
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] !== "--facts") throw new Error(`Unknown audit grade option: ${rest[index]}`);
    if (factsPath !== null || !rest[index + 1]) throw new Error("--facts needs a path");
    factsPath = resolve(rest[index + 1]);
    index += 1;
  }
  return { runId, factsPath };
}

async function readJson(path, schema, label) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    return schema ? schema.parse(value) : value;
  } catch (error) {
    throw new Error(`Invalid ${label} at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function readNdjson(path, schema, label) {
  let contents;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return contents.split("\n").filter(Boolean).map((line, index) => {
    try {
      return schema.parse(JSON.parse(line));
    } catch (error) {
      throw new Error(`Invalid ${label} line ${index + 1} at ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

function startsWith(argv, prefix) {
  return prefix.every((part, index) => argv[index] === part);
}

function isHelp(argv) {
  return argv.includes("-h") || argv.includes("--help");
}

function optionValue(argv, option) {
  let value;
  for (const [index, argument] of argv.entries()) {
    if (argument === option) value = argv[index + 1] ?? null;
    else if (argument.startsWith(`${option}=`)) value = argument.slice(option.length + 1);
  }
  return value;
}

function targetEstablishingCommand(event) {
  const { argv } = event;
  if (event.exitCode !== 0 || event.signal !== null || isHelp(argv)) return null;
  const command = TARGET_ESTABLISHING_COMMANDS.get(argv.slice(0, 2).join(" ")) ?? null;
  if (command !== "session start") return command;
  return optionValue(argv, "--url") !== undefined || optionValue(argv, "--target") !== undefined ? command : null;
}

function isVersionOnlyProbe(connection, runId) {
  if (connection.versionOnlyHttpProbe !== undefined) return connection.versionOnlyHttpProbe;
  if (!ARCHIVED_RUNS_WITH_UNMARKED_VERSION_PROBES.has(runId) || connection.firstRequestLine !== CDP_VERSION_REQUEST) return false;
  // Archived runs predate the complete-request marker and have these raw detector shapes.
  return (connection.bytesToBrowser === 151 && connection.bytesToClient >= 1_000) || (connection.bytesToBrowser === 77 && connection.bytesToClient === 0);
}

function contaminationFailures(events, cdpProxyPort) {
  const failures = [];
  for (const event of events) {
    if (event.argv.some((argument) => argument.toLowerCase().includes("file://"))) {
      failures.push(`file:// URL in wrapped invocation (transcript ordinal ${event.ordinal})`);
    }
    const command = targetEstablishingCommand(event);
    if (command === null) continue;
    if (command === "tab launch") {
      failures.push(`target-establishing tab launch starts a host browser instead of using the sanctioned CDP proxy (transcript ordinal ${event.ordinal})`);
      continue;
    }
    if (cdpProxyPort === undefined) continue;
    const port = optionValue(event.argv, "--port");
    if (port !== undefined && Number(port) !== cdpProxyPort) {
      failures.push(`target-establishing ${command} used CDP port ${port} instead of sanctioned proxy port ${cdpProxyPort} (transcript ordinal ${event.ordinal})`);
    }
  }
  return failures;
}

function classifyCommands(events, oracle) {
  const seen = new Set();
  return events.map((event) => {
    const key = JSON.stringify(event.argv);
    const repeated = seen.has(key);
    seen.add(key);
    const usable = event.exitCode === 0 && event.signal === null && !isHelp(event.argv);
    const intended = usable && oracle.intendedCapabilityStatus !== "unshipped" && oracle.intendedCapabilityMatchers.some((prefix) => startsWith(event.argv, prefix));
    const escapeHatch = usable && oracle.escapeHatchMatchers.some((prefix) => startsWith(event.argv, prefix));
    let classification;
    if (event.exitCode !== 0 || event.signal !== null) classification = "error";
    else if (repeated) classification = "repeated";
    else if (isHelp(event.argv)) classification = "help";
    else if (escapeHatch) classification = "escape-hatch";
    else if (intended) classification = "intended-capability";
    else if (event.argv[0] === "session" || event.argv[0] === "tab") classification = "setup";
    else if (event.argv[0] === "page" && INTERACTION_COMMANDS.has(event.argv[1])) classification = "interaction";
    else if (FIRST_CLASS_ROOTS.has(event.argv[0])) classification = "other-first-class";
    else classification = "other-first-class";
    return { ...event, classification, intended, escapeHatch, repeated };
  });
}

function ratio(numerator, denominator) {
  if (denominator === 0) return numerator === 0 ? 0 : null;
  return numerator / denominator;
}

function firstBudgetBreach(events, limits) {
  let elapsedSeconds = 0;
  let stdoutTokens = 0;
  for (const [index, event] of events.entries()) {
    elapsedSeconds += event.elapsedMs / 1000;
    stdoutTokens += event.stdoutTokens;
    if (index + 1 > limits.calls) return { condition: "absolute call ceiling", ordinal: event.ordinal };
    if (elapsedSeconds > limits.elapsedSeconds) return { condition: "absolute elapsed-time ceiling", ordinal: event.ordinal };
    if (stdoutTokens > limits.stdoutTokens) return { condition: "absolute stdout-token ceiling", ordinal: event.ordinal };
  }
  return null;
}

function parseReport(report) {
  const sections = new Map();
  const heading = /^(?:#{1,6}\s+)?(Outcome|Evidence|Investigation path|Wrong turns|Friction|Fallbacks|Missing affordances)\s*$/im;
  const matches = [...report.matchAll(new RegExp(heading.source, "gim"))];
  for (const [index, match] of matches.entries()) {
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? report.length;
    sections.set(match[1].toLowerCase(), report.slice(start, end).trim());
  }
  const outcome = sections.get("outcome") ?? "";
  const value = (label) => outcome.match(new RegExp(`^\\s*(?:[-*]\\s*)?${label}:\\s*(.+)$`, "im"))?.[1].trim() ?? "";
  const confidence = value("Confidence").toLowerCase();
  const establishment = (sections.get("investigation path") ?? "").split("\n").find((line) => /establish/i.test(line))?.match(/\d+/)?.[0] ?? null;
  return {
    sections,
    outcome: {
      reproduced: /^yes\b/i.test(value("Symptom reproduced")),
      diagnosis: value("Diagnosis"),
      confidence: ["high", "medium", "low"].includes(confidence) ? confidence : "low",
    },
    establishmentOrdinal: establishment === null ? null : Number(establishment),
  };
}

function excerpts(report, sections, names) {
  const selected = names.map((name) => [name, sections.get(name.toLowerCase())]).filter(([, text]) => text);
  if (selected.length === 0) return report.trim() || "(The report is empty.)";
  return selected.map(([name, text]) => `### ${name}\n${text}`).join("\n\n");
}

function renderWorksheet(oracle, report, parsedReport, record) {
  const blocks = [
    "# Grading worksheet",
    "Stage 1 does not decide whether any item is present. A human or grading node must supply each verdict in `facts.json` as `{ present, quote, ordinals }`.",
    "",
    "## Mechanical route facts",
    "| Ordinal | argv | Classification | stdout tokens | elapsed ms |",
    "| --- | --- | --- | ---: | ---: |",
    ...record._mechanical.classified.map((event) => `| ${event.ordinal} | \`${event.argv.join(" ")}\` | ${event.classification} | ${event.stdoutTokens} | ${event.elapsedMs} |`),
    "",
    `- Calls: ${record.routeMetrics.totalCalls}; help: ${record.routeMetrics.helpCalls}; failed: ${record.routeMetrics.failedCalls}; repeated: ${record.routeMetrics.repeatedCalls}; escape-hatch: ${record.routeMetrics.escapeHatchCalls}.`,
    `- Elapsed seconds: ${record.routeMetrics.elapsedSeconds}; cumulative stdout tokens: ${record.outputVolumeLedger.cumulativeStdoutTokens}; largest stdout tokens: ${record.outputVolumeLedger.largestStdoutTokens}.`,
    `- First intended-capability ordinal: ${record.routeMetrics.firstIntendedCapabilityOrdinal ?? "none"}; capability use: ${record.grade.firstClassCapability}.`,
    `- Reference ratios — calls: ${record.routeMetrics.callRatio ?? "undefined"}; elapsed: ${record.routeMetrics.elapsedRatio ?? "undefined"}; stdout: ${record.routeMetrics.stdoutTokenRatio ?? "undefined"}${record.referenceProvisional ? " (reference provisional)" : ""}.`,
    `- CDP accounting: ${record.grade.cdpAccounting.unaccounted} unaccounted connection(s), using: ${record.grade.cdpAccounting.rule}`,
    `- Isolation contamination: ${record._mechanical.contaminationFailures.length ? record._mechanical.contaminationFailures.join("; ") : "none detected"}.`,
    ...record._mechanical.budgetBreaches.map((breach) => `- Budget breach: ${breach.condition} at transcript ordinal ${breach.ordinal ?? "none"}.`),
    "",
    "## Required diagnosis facts",
  ];
  for (const item of oracle.requiredDiagnosisFacts) {
    blocks.push(`### ${item.id}`, `- Statement: ${item.fact}`, `- Why required: ${item.why}`, "- Report excerpts (pulled by report section, not keyword matching):", "```text", excerpts(report, parsedReport.sections, ["Outcome", "Evidence", "Investigation path"]), "```", "");
  }
  blocks.push("## Required evidence");
  for (const item of oracle.requiredEvidence) {
    blocks.push(`### ${item.id}`, `- Statement: ${item.evidence}`, `- Why required: ${item.why}`, "- Report excerpts (pulled by report section, not keyword matching):", "```text", excerpts(report, parsedReport.sections, ["Evidence", "Investigation path", "Fallbacks"]), "```", "");
  }
  blocks.push("## Symptom reproduction", `### ${SYMPTOM_REPRODUCED_FACT_ID}`, "- Record whether the report contains evidence that the symptom was reproduced.", "- Report excerpts:", "```text", excerpts(report, parsedReport.sections, ["Outcome", "Evidence", "Investigation path"]), "```", "", "## Plausible wrong answer ruled out", `### ${PLAUSIBLE_WRONG_ANSWER_FACT_ID}`, `- Competing explanation: ${oracle.plausibleWrongAnswer}`, "- Record whether the report's evidence rules this out; do not infer it from keyword overlap.", "- Report excerpts:", "```text", excerpts(report, parsedReport.sections, ["Outcome", "Evidence", "Investigation path"]), "```");
  return `${blocks.join("\n")}\n`;
}

function infrastructureFailure(meta) {
  return meta.infrastructureFailure === true || meta.infrastructure?.failed === true;
}

function provenance(meta, runId, oracle, events) {
  const source = meta.provenance ?? meta;
  return {
    runId: source.runId ?? runId,
    captureBuildHash: source.captureBuildHash ?? "unknown",
    fixtureRevision: source.fixtureRevision ?? "unknown",
    promptRevision: source.promptRevision ?? "unknown",
    chromeBuild: source.chromeBuild ?? "unknown",
    model: source.model ?? "unknown",
    hostClass: source.hostClass ?? "unknown",
    startedAt: source.startedAt ?? events[0]?.startedAt ?? new Date(0).toISOString(),
    browserFlags: Array.isArray(source.browserFlags) ? source.browserFlags : [],
  };
}

function transcriptFailures(events, runId) {
  const failures = [];
  let priorOrdinal = 0;
  for (const event of events) {
    if (event.runId !== runId) failures.push(`transcript event ordinal ${event.ordinal} belongs to run ${event.runId}`);
    if (event.ordinal <= priorOrdinal) failures.push(`transcript ordinal ${event.ordinal} is not strictly increasing`);
    if (Date.parse(event.endedAt) < Date.parse(event.startedAt)) failures.push(`transcript event ordinal ${event.ordinal} ends before it starts`);
    priorOrdinal = event.ordinal;
  }
  return failures;
}

function provenanceFailures(provenanceRecord, oracle, requestedRunId, meta) {
  const failures = [];
  const source = meta.provenance ?? meta;
  for (const field of ["runId", "captureBuildHash", "fixtureRevision", "promptRevision", "chromeBuild", "model", "hostClass", "startedAt", "browserFlags"]) {
    if (source[field] === undefined) failures.push(`missing provenance.${field}`);
  }
  for (const field of ["captureBuildHash", "fixtureRevision", "promptRevision", "chromeBuild", "model", "hostClass"]) {
    if (provenanceRecord[field] === "unknown") failures.push(`missing provenance.${field}`);
  }
  if (provenanceRecord.runId !== requestedRunId) failures.push(`provenance runId ${provenanceRecord.runId} does not match ${requestedRunId}`);
  if (provenanceRecord.fixtureRevision !== oracle.fixtureRevision) failures.push("run fixture revision does not match oracle");
  if (provenanceRecord.chromeBuild !== oracle.environment.chromeBuild) failures.push("run Chrome build does not match oracle environment");
  if (JSON.stringify(provenanceRecord.browserFlags) !== JSON.stringify(oracle.environment.flags)) failures.push("run browser flags do not match oracle environment");
  return failures;
}

function referenceDrift(provenanceRecord, reference) {
  return ["hostClass", "chromeBuild", "captureBuildHash"].filter((field) => provenanceRecord[field] !== reference[field]);
}

function mechanicalRecord({ runId, meta, oracle, reference, events, connections, report, cdpLogPresent }) {
  const runProvenance = provenance(meta, runId, oracle, events);
  const classified = classifyCommands(events, oracle);
  const parsedReport = parseReport(report);
  const elapsedSeconds = classified.reduce((total, event) => total + event.elapsedMs, 0) / 1000;
  const cumulativeStdoutTokens = classified.reduce((total, event) => total + event.stdoutTokens, 0);
  const largestStdoutTokens = Math.max(0, ...classified.map((event) => event.stdoutTokens));
  const firstIntendedCapabilityOrdinal = classified.find((event) => event.intended)?.ordinal ?? null;
  const unaccounted = connections.filter((connection) => !isVersionOnlyProbe(connection, runId) && !classified.some((event) => {
    const connectionStart = Date.parse(connection.acceptedAt);
    const connectionEnd = Date.parse(connection.closedAt);
    return connectionStart <= Date.parse(event.endedAt) + CDP_GRACE_MS && connectionEnd >= Date.parse(event.startedAt) - CDP_GRACE_MS;
  }));
  const limits = {
    calls: Math.min(ABSOLUTE_CEILINGS.calls, oracle.budgets.calls),
    elapsedSeconds: Math.min(ABSOLUTE_CEILINGS.elapsedSeconds, oracle.budgets.minutes * 60),
    stdoutTokens: Math.min(ABSOLUTE_CEILINGS.stdoutTokens, oracle.budgets.stdoutTokens),
  };
  const callRatio = ratio(classified.length, reference.totals.calls);
  const elapsedRatio = ratio(elapsedSeconds, reference.totals.elapsedSeconds);
  const stdoutTokenRatio = ratio(cumulativeStdoutTokens, reference.totals.stdoutTokens);
  const firstHardBudgetBreach = firstBudgetBreach(classified, limits);
  const budgetBreaches = [
    classified.length > limits.calls ? { condition: "absolute call ceiling", ordinal: firstHardBudgetBreach?.condition === "absolute call ceiling" ? firstHardBudgetBreach.ordinal : classified.at(-1)?.ordinal ?? null } : null,
    elapsedSeconds > limits.elapsedSeconds ? { condition: "absolute elapsed-time ceiling", ordinal: firstHardBudgetBreach?.condition === "absolute elapsed-time ceiling" ? firstHardBudgetBreach.ordinal : classified.at(-1)?.ordinal ?? null } : null,
    cumulativeStdoutTokens > limits.stdoutTokens ? { condition: "absolute stdout-token ceiling", ordinal: firstHardBudgetBreach?.condition === "absolute stdout-token ceiling" ? firstHardBudgetBreach.ordinal : classified.at(-1)?.ordinal ?? null } : null,
  ].filter(Boolean);
  return {
    provenance: runProvenance,
    outcome: { ...parsedReport.outcome, stopReason: meta.stopReason ?? meta.outcome?.stopReason ?? "not recorded" },
    evidence: [],
    hypothesisLedger: [],
    fallbackLedger: [],
    outputVolumeLedger: {
      commands: classified.map(({ ordinal, stdoutBytes, stdoutTokens }) => ({ ordinal, stdoutBytes, stdoutTokens })),
      cumulativeStdoutTokens,
      largestStdoutTokens,
      contextImpact: parsedReport.sections.get("friction") ?? "not recorded",
    },
    routeMetrics: {
      totalCalls: classified.length,
      helpCalls: classified.filter((event) => isHelp(event.argv)).length,
      failedCalls: classified.filter((event) => event.exitCode !== 0 || event.signal !== null).length,
      repeatedCalls: classified.filter((event) => event.repeated).length,
      escapeHatchCalls: classified.filter((event) => event.escapeHatch).length,
      elapsedSeconds,
      firstIntendedCapabilityOrdinal,
      establishmentOrdinal: parsedReport.establishmentOrdinal,
      referenceCalls: reference.totals.calls,
      callRatio,
      elapsedRatio,
      stdoutTokenRatio,
    },
    frictionEvents: [],
    grade: {
      correctness: false,
      evidenceComplete: false,
      firstClassCapability: oracle.intendedCapabilityStatus === "unshipped" ? "unavailable" : firstIntendedCapabilityOrdinal === null ? "absent" : "used",
      cdpAccounting: { unaccounted: unaccounted.length, rule: CDP_ACCOUNTING_RULE },
      callRatio,
      elapsedRatio,
      stdoutTokenRatio,
      referenceDrift: referenceDrift(runProvenance, reference),
      finalClass: "fail",
      reasons: ["Awaiting semantic fact adjudication."],
    },
    referenceProvisional: reference.provisional || undefined,
    _mechanical: {
      classified,
      unaccounted,
      limits,
      budgetBreaches,
      firstHardBudgetBreach,
      infrastructureFailure: infrastructureFailure(meta),
      telemetryFailures: [...transcriptFailures(events, runId), ...(cdpLogPresent ? [] : ["missing cdp-connections.ndjson"])],
      provenanceFailures: provenanceFailures(runProvenance, oracle, runId, meta),
      contaminationFailures: contaminationFailures(events, meta.cdpProxyPort),
    },
  };
}

function validateFacts(input, transcriptOrdinals, oracle) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new Error("facts.json must be an object keyed by worksheet item ID");
  const expectedIds = new Set([
    ...oracle.requiredDiagnosisFacts.map((item) => item.id),
    ...oracle.requiredEvidence.map((item) => item.id),
    SYMPTOM_REPRODUCED_FACT_ID,
    PLAUSIBLE_WRONG_ANSWER_FACT_ID,
  ]);
  if (expectedIds.size !== oracle.requiredDiagnosisFacts.length + oracle.requiredEvidence.length + 2) throw new Error("Oracle fact IDs must be unique");
  const facts = new Map();
  for (const [id, verdict] of Object.entries(input)) {
    if (!expectedIds.has(id)) throw new Error(`Unknown fact verdict ID: ${id}`);
    const validShape = verdict !== null && typeof verdict === "object" && !Array.isArray(verdict) && typeof verdict.present === "boolean" && typeof verdict.quote === "string" && Array.isArray(verdict.ordinals) && verdict.ordinals.every((ordinal) => Number.isInteger(ordinal) && ordinal > 0 && transcriptOrdinals.has(ordinal));
    if (!validShape || (verdict.present && (verdict.quote.trim() === "" || verdict.ordinals.length === 0))) {
      throw new Error(`Invalid fact verdict for ${id}; present verdicts need a quote and at least one transcript ordinal`);
    }
    facts.set(id, verdict);
  }
  return facts;
}

function ordinalsText(ordinals) {
  return ordinals.length ? ordinals.join(", ") : "none";
}

function adjudicate(record, oracle, facts) {
  const classifiedByOrdinal = new Map(record._mechanical.classified.map((event) => [event.ordinal, event]));
  const requiredFacts = oracle.requiredDiagnosisFacts.map((item) => ({ ...item, verdict: facts.get(item.id) ?? { present: false, quote: "", ordinals: [] } }));
  const requiredEvidence = oracle.requiredEvidence.map((item) => ({ ...item, verdict: facts.get(item.id) ?? { present: false, quote: "", ordinals: [] } }));
  const symptomReproduced = facts.get(SYMPTOM_REPRODUCED_FACT_ID) ?? { present: false, quote: "", ordinals: [] };
  const wrongAnswer = facts.get(PLAUSIBLE_WRONG_ANSWER_FACT_ID) ?? { present: false, quote: "", ordinals: [] };
  const missingFacts = requiredFacts.filter((item) => !item.verdict.present);
  const missingEvidence = requiredEvidence.filter((item) => !item.verdict.present);
  const correctness = record.outcome.reproduced && symptomReproduced.present && missingFacts.length === 0 && wrongAnswer.present;
  const evidenceComplete = missingEvidence.length === 0;
  const evidenceOrdinals = requiredEvidence.flatMap((item) => item.verdict.present ? item.verdict.ordinals : []);
  const intendedEvidenceOrdinals = evidenceOrdinals.filter((ordinal) => classifiedByOrdinal.get(ordinal)?.intended);
  const escapeEvidenceOrdinals = evidenceOrdinals.filter((ordinal) => classifiedByOrdinal.get(ordinal)?.escapeHatch);
  const intendedCapabilityRequired = oracle.intendedCapabilityRequiredForPass !== false;
  const firstClassEvidence = escapeEvidenceOrdinals.length === 0 && (!intendedCapabilityRequired || intendedEvidenceOrdinals.length > 0);
  const ratioFailures = [
    record.routeMetrics.callRatio === null || record.routeMetrics.callRatio > 2 ? { condition: "call ratio exceeds 2x reference", ordinal: record._mechanical.classified.at(-1)?.ordinal ?? null } : null,
    record.routeMetrics.elapsedRatio === null || record.routeMetrics.elapsedRatio > 3 ? { condition: "elapsed ratio exceeds 3x reference", ordinal: record._mechanical.classified.at(-1)?.ordinal ?? null } : null,
    record.routeMetrics.stdoutTokenRatio === null || record.routeMetrics.stdoutTokenRatio > 3 ? { condition: "stdout-token ratio exceeds 3x reference", ordinal: record._mechanical.classified.at(-1)?.ordinal ?? null } : null,
  ].filter(Boolean);
  const establishmentOrdinal = record.routeMetrics.establishmentOrdinal;
  const established = establishmentOrdinal !== null && classifiedByOrdinal.has(establishmentOrdinal);
  const establishedAfterBudget = established && record._mechanical.firstHardBudgetBreach !== null && establishmentOrdinal >= record._mechanical.firstHardBudgetBreach.ordinal;
  const failureReasons = [
    ...missingFacts.map((item) => `required diagnosis fact absent: ${item.id} (transcript ordinals: ${ordinalsText(item.verdict.ordinals)})`),
    ...missingEvidence.map((item) => `required evidence absent: ${item.id} (transcript ordinals: ${ordinalsText(item.verdict.ordinals)})`),
    !record.outcome.reproduced ? "report does not state that the symptom was reproduced (transcript ordinals: none)" : null,
    !symptomReproduced.present ? `symptom reproduction evidence absent (transcript ordinals: ${ordinalsText(symptomReproduced.ordinals)})` : null,
    !wrongAnswer.present ? `plausible wrong answer not ruled out (transcript ordinals: ${ordinalsText(wrongAnswer.ordinals)})` : null,
    !established ? "diagnosis was not established at a valid transcript ordinal (transcript ordinals: none)" : null,
    establishedAfterBudget ? `diagnosis was established after a hard budget breach (transcript ordinals: ${record._mechanical.firstHardBudgetBreach.ordinal}, ${establishmentOrdinal})` : null,
  ].filter(Boolean);
  const passFailures = [
    !firstClassEvidence ? (escapeEvidenceOrdinals.length ? `load-bearing evidence used an escape hatch (transcript ordinals: ${ordinalsText(escapeEvidenceOrdinals)})` : `no intended first-class capability supplied load-bearing evidence (transcript ordinals: ${ordinalsText(intendedEvidenceOrdinals)})`) : null,
    ...ratioFailures.map((failure) => `${failure.condition} (transcript ordinals: ${failure.ordinal ?? "none"})`),
    ...record._mechanical.budgetBreaches.map((breach) => `${breach.condition} breached (transcript ordinals: ${breach.ordinal ?? "none"})`),
  ].filter(Boolean);
  let finalClass;
  let reasons;
  if (record._mechanical.unaccounted.length > 0 || record._mechanical.infrastructureFailure || record._mechanical.telemetryFailures.length > 0 || record._mechanical.provenanceFailures.length > 0 || record._mechanical.contaminationFailures.length > 0) {
    finalClass = "invalid";
    reasons = [
      ...record._mechanical.unaccounted.map((connection) => `unaccounted CDP connection ${connection.connId}`),
      ...(record._mechanical.infrastructureFailure ? ["meta.json flags an infrastructure failure"] : []),
      ...record._mechanical.telemetryFailures,
      ...record._mechanical.provenanceFailures,
      ...record._mechanical.contaminationFailures,
    ];
  } else if (failureReasons.length > 0) {
    finalClass = "fail";
    reasons = failureReasons;
  } else if (passFailures.length === 0) {
    finalClass = "pass";
    reasons = [];
  } else {
    finalClass = "diagnosis-only";
    reasons = passFailures;
  }
  const { _mechanical, ...plainRecord } = record;
  return RunRecordSchema.parse({
    ...plainRecord,
    grade: {
      correctness,
      evidenceComplete,
      firstClassCapability: oracle.intendedCapabilityStatus === "unshipped" ? "unavailable" : record.routeMetrics.firstIntendedCapabilityOrdinal === null ? "absent" : "used",
      cdpAccounting: { unaccounted: record._mechanical.unaccounted.length, rule: CDP_ACCOUNTING_RULE },
      callRatio: record.routeMetrics.callRatio,
      elapsedRatio: record.routeMetrics.elapsedRatio,
      stdoutTokenRatio: record.routeMetrics.stdoutTokenRatio,
      referenceDrift: record.grade.referenceDrift,
      finalClass,
      reasons,
    },
  });
}

export async function gradeRun({ runId, runDir, oraclePath, referencePath, facts = null }) {
  const cdpLogPath = join(runDir, "cdp-connections.ndjson");
  const [meta, oracle, reference, report, events, connections, cdpLogPresent] = await Promise.all([
    readJson(join(runDir, "meta.json"), AuditMetaSchema, "meta.json"),
    readJson(oraclePath, OracleSchema, "oracle"),
    readJson(referencePath, ReferenceRouteSchema, "reference route"),
    readFile(join(runDir, "report.md"), "utf8"),
    readNdjson(join(runDir, "transcript.ndjson"), CommandEventSchema, "transcript"),
    readNdjson(cdpLogPath, CdpConnectionSchema, "CDP connections"),
    access(cdpLogPath).then(() => true, () => false),
  ]);
  if (meta.caseId !== oracle.caseId) throw new Error(`Run case ${meta.caseId ?? "(missing)"} does not match oracle case ${oracle.caseId}`);
  if (reference.caseId !== oracle.caseId) throw new Error(`Reference route case ${reference.caseId} does not match oracle case ${oracle.caseId}`);
  const mechanical = mechanicalRecord({ runId, meta, oracle, reference, events, connections, report, cdpLogPresent });
  const { _mechanical, grade: _pendingGrade, ...partial } = mechanical;
  RunRecordSchema.partial().parse(partial);
  const worksheet = renderWorksheet(oracle, report, parseReport(report), mechanical);
  await Promise.all([
    writeFile(join(runDir, "grading-worksheet.md"), worksheet),
    writeFile(join(runDir, "run-record.json"), `${JSON.stringify(partial, null, 2)}\n`),
  ]);
  if (facts === null) return { stage: 1, record: partial, worksheetPath: join(runDir, "grading-worksheet.md") };
  const adjudicated = adjudicate(mechanical, oracle, validateFacts(facts, new Set(events.map((event) => event.ordinal)), oracle));
  await writeFile(join(runDir, "run-record.json"), `${JSON.stringify(adjudicated, null, 2)}\n`);
  return { stage: 2, record: adjudicated, worksheetPath: join(runDir, "grading-worksheet.md") };
}

export async function grade(args) {
  const { runId, factsPath } = parseArgs(args);
  if (basename(runId) !== runId) throw new Error("runId must name one directory under audit/runs");
  const entry = getCase((await readJson(join(auditRoot, "runs", runId, "meta.json"), AuditMetaSchema, "meta.json")).caseId);
  if (!entry.oracleDir) throw new Error(`Audit fixture ${entry.id} is not built`);
  const result = await gradeRun({
    runId,
    runDir: join(auditRoot, "runs", runId),
    oraclePath: join(entry.oracleDir, "oracle.json"),
    referencePath: join(entry.oracleDir, "reference-route.json"),
    facts: factsPath === null ? null : await readJson(factsPath, null, "facts.json"),
  });
  console.log(join(auditRoot, "runs", runId, "run-record.json"));
  console.log(result.worksheetPath);
  return result.record;
}
