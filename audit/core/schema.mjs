import { z } from "zod";

const IsoDate = z.string().datetime();
const StringId = z.string().min(1);
const Variant = z.enum(["faulty", "healthy"]);
export const PhaseSchema = z.enum(["discovery", "setup", "reproduction", "collection", "interpretation", "reporting"]);
export const FrictionCategorySchema = z.enum(["ambiguous-help", "missing-route", "invocation-error", "unclear-progress", "output-volume", "evidence-buried", "artifact-discovery", "schema-ambiguity", "missing-first-class-operation", "expectation-mismatch"]);
export const FrictionSeveritySchema = z.enum(["blocked", "caused-wrong-turn", "caused-extra-call", "cosmetic"]);
export const CommandClassificationSchema = z.enum(["help", "setup", "interaction", "intended-capability", "other-first-class", "escape-hatch", "error", "repeated"]);
export const FinalClassSchema = z.enum(["pass", "diagnosis-only", "fail", "invalid"]);

export const OracleSchema = z.object({
  opaqueCaseId: StringId, caseId: StringId, fixtureRevision: StringId, vagueSymptom: z.string(), plantedCondition: z.string(),
  requiredDiagnosisFacts: z.array(z.object({ id: StringId, fact: z.string(), why: z.string() })),
  requiredEvidence: z.array(z.object({ id: StringId, evidence: z.string(), why: z.string() })),
  plausibleWrongAnswer: z.string(),
  ranges: z.object({ faulty: z.array(z.object({ name: StringId, min: z.number(), max: z.number() })), healthy: z.array(z.object({ name: StringId, min: z.number(), max: z.number() })) }),
  intendedCapability: z.string(), intendedCapabilityMatchers: z.array(z.array(z.string().min(1)).min(1)),
  intendedCapabilityStatus: z.enum(["shipped", "unshipped"]).optional(),
  // Set false only for a case graded on the evidence itself rather than on reaching it through the
  // intended capability. Escape-hatch evidence is still rejected either way. Defaults to true.
  intendedCapabilityRequiredForPass: z.boolean().optional(),
  escapeHatchMatchers: z.array(z.array(z.string().min(1)).min(1)),
  // Loose on purpose: environment is the per-case pin, and each case pins different things
  // (Case C a full Chrome build, Case D a trace-engine version, Case E any required flag).
  // A closed object silently ate those pins, so an author's pin vanished with no error.
  environment: z.looseObject({ chromeBuild: z.string(), flags: z.array(z.string()), coldCache: z.boolean(), repetitions: z.number().int().positive() }),
  budgets: z.object({ calls: z.number().int().positive(), minutes: z.number().positive(), stdoutTokens: z.number().int().positive() }),
});

export const CommandEventSchema = z.object({
  runId: StringId, ordinal: z.number().int().positive(), argv: z.array(z.string()), startedAt: IsoDate, endedAt: IsoDate, elapsedMs: z.number().nonnegative(),
  exitCode: z.number().int().nullable(), signal: z.string().nullable(), stdoutBytes: z.number().int().nonnegative(), stderrBytes: z.number().int().nonnegative(),
  stdoutTokens: z.number().int().nonnegative(), stderrTokens: z.number().int().nonnegative(), artifactPaths: z.array(z.string()), cwd: z.string(), pid: z.number().int().positive(),
});

export const CdpConnectionSchema = z.object({
  connId: z.number().int().positive(), acceptedAt: IsoDate, closedAt: IsoDate, remoteAddr: z.string(), remotePort: z.number().int().nonnegative(),
  bytesToBrowser: z.number().int().nonnegative(), bytesToClient: z.number().int().nonnegative(), firstRequestLine: z.string(),
});

/** Coordinator-owned provenance and lifecycle state read by the grader before a run record exists. */
export const AuditMetaSchema = z.object({
  caseId: StringId, runId: StringId, captureBuildHash: StringId, fixtureRevision: StringId,
  promptRevision: StringId, chromeBuild: StringId, model: StringId, hostClass: StringId, startedAt: IsoDate,
  browserFlags: z.array(z.string()), cdpProxyPort: z.number().int().min(1).max(65_535).optional(), stopReason: z.string().optional(), infrastructureFailure: z.boolean().optional(),
  infrastructure: z.object({ failed: z.boolean() }).optional(),
  provenance: z.object({ runId: StringId, captureBuildHash: StringId, fixtureRevision: StringId, promptRevision: StringId, chromeBuild: StringId, model: StringId, hostClass: StringId, startedAt: IsoDate, browserFlags: z.array(z.string()) }).partial().optional(),
});

export const FrictionEventSchema = z.object({
  eventId: StringId, runId: StringId, commandOrdinals: z.array(z.number().int().positive()), phase: PhaseSchema, category: FrictionCategorySchema,
  expected: z.string(), actual: z.string(), workaround: z.string(),
  cost: z.object({ extraCalls: z.number().int().nonnegative(), elapsedMs: z.number().nonnegative(), stdoutTokens: z.number().int().nonnegative(), abandonedArtifacts: z.array(z.string()) }),
  severity: FrictionSeveritySchema, repetitionKey: z.string().min(1),
});

export const ReferenceRouteSchema = z.object({
  caseId: StringId, measuredAt: IsoDate, provisional: z.boolean(), captureBuildHash: z.string(), chromeBuild: z.string(), hostClass: z.string(),
  route: z.array(z.object({ ordinal: z.number().int().positive(), argv: z.array(z.string()), elapsedMs: z.number().nonnegative(), stdoutTokens: z.number().int().nonnegative() })),
  totals: z.object({ calls: z.number().int().nonnegative(), elapsedSeconds: z.number().nonnegative(), stdoutTokens: z.number().int().nonnegative() }), notes: z.string(),
});

export const RunRecordSchema = z.object({
  provenance: z.object({ runId: StringId, captureBuildHash: z.string(), fixtureRevision: z.string(), promptRevision: z.string(), chromeBuild: z.string(), model: z.string(), hostClass: z.string(), startedAt: IsoDate, browserFlags: z.array(z.string()) }),
  outcome: z.object({ reproduced: z.boolean(), diagnosis: z.string(), confidence: z.enum(["high", "medium", "low"]), stopReason: z.string() }),
  evidence: z.array(z.object({ claim: z.string(), ordinals: z.array(z.number().int().positive()), artifactPaths: z.array(z.string()) })),
  hypothesisLedger: z.array(z.object({ hypothesis: z.string(), status: z.enum(["final", "rejected"]), formedAtOrdinal: z.number().int().positive().nullable(), resolvedAtOrdinal: z.number().int().positive().nullable(), commandCost: z.number().int().nonnegative() })),
  fallbackLedger: z.array(z.object({ route: z.string(), why: z.string(), firstClassAttempts: z.array(z.number().int().positive()), evidence: z.string(), ordinals: z.array(z.number().int().positive()) })),
  outputVolumeLedger: z.object({ commands: z.array(z.object({ ordinal: z.number().int().positive(), stdoutBytes: z.number().int().nonnegative(), stdoutTokens: z.number().int().nonnegative() })), cumulativeStdoutTokens: z.number().int().nonnegative(), largestStdoutTokens: z.number().int().nonnegative(), contextImpact: z.string() }),
  routeMetrics: z.object({ totalCalls: z.number().int().nonnegative(), helpCalls: z.number().int().nonnegative(), failedCalls: z.number().int().nonnegative(), repeatedCalls: z.number().int().nonnegative(), escapeHatchCalls: z.number().int().nonnegative(), elapsedSeconds: z.number().nonnegative(), firstIntendedCapabilityOrdinal: z.number().int().positive().nullable(), establishmentOrdinal: z.number().int().positive().nullable(), referenceCalls: z.number().int().nonnegative(), callRatio: z.number().nonnegative().nullable(), elapsedRatio: z.number().nonnegative().nullable(), stdoutTokenRatio: z.number().nonnegative().nullable() }),
  frictionEvents: z.array(FrictionEventSchema),
  grade: z.object({ correctness: z.boolean(), evidenceComplete: z.boolean(), firstClassCapability: z.enum(["used", "absent", "unavailable"]), cdpAccounting: z.object({ unaccounted: z.number().int().nonnegative(), rule: z.string() }), callRatio: z.number().nonnegative().nullable(), elapsedRatio: z.number().nonnegative().nullable(), stdoutTokenRatio: z.number().nonnegative().nullable(), finalClass: FinalClassSchema, reasons: z.array(z.string()) }),
  referenceProvisional: z.boolean().optional(),
});
