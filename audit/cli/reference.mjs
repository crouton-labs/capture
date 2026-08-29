import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { getCase } from "../core/registry.mjs";
import { CommandEventSchema, ReferenceRouteSchema } from "../core/schema.mjs";

function option(args, name, fallback) { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1] ?? (() => { throw new Error(`${name} needs a value`); })(); }

export async function record(args) {
  const entry = getCase(option(args, "--case"));
  const transcript = option(args, "--transcript");
  if (!transcript) throw new Error("reference record requires --transcript <path>");
  const events = (await readFile(transcript, "utf8")).split("\n").filter(Boolean).map((line) => CommandEventSchema.parse(JSON.parse(line)));
  const route = events.map(({ ordinal, argv, elapsedMs, stdoutTokens }) => ({ ordinal, argv, elapsedMs, stdoutTokens }));
  const record = ReferenceRouteSchema.parse({
    caseId: entry.id, measuredAt: new Date().toISOString(), provisional: args.includes("--provisional"),
    captureBuildHash: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), chromeBuild: "unknown", hostClass: `${process.platform}-${process.arch}`,
    route, totals: { calls: route.length, elapsedSeconds: route.reduce((sum, event) => sum + event.elapsedMs, 0) / 1000, stdoutTokens: route.reduce((sum, event) => sum + event.stdoutTokens, 0) }, notes: "Recorded from authoritative audit transcript.",
  });
  await writeFile(join(entry.oracleDir, "reference-route.json"), `${JSON.stringify(record, null, 2)}\n`);
  console.log(join(entry.oracleDir, "reference-route.json"));
}
