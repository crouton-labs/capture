import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const auditRoot = dirname(dirname(fileURLToPath(import.meta.url)));
function paths(id) { return { fixtureDir: join(auditRoot, "fixtures", id), oracleDir: join(auditRoot, "sealed", id) }; }

export const CASES = [
  { id: "case-a", opaqueId: "r7-atlas", revision: "a.1", status: "built", ...paths("case-a") },
  { id: "case-b", opaqueId: "n4-ember", revision: "b.1", status: "built", ...paths("case-b") },
  { id: "case-c", opaqueId: "k9-lumen", revision: "c.1", status: "not-built" },
  { id: "case-d", opaqueId: "v2-harbor", revision: "d.1", status: "built", ...paths("case-d") },
  { id: "case-e", opaqueId: "m6-orbit", revision: "e.1", status: "built", ...paths("case-e") },
];
export function getCase(id) { const entry = CASES.find((candidate) => candidate.id === id); if (!entry) throw new Error(`Unknown audit fixture: ${id}`); return entry; }
export { auditRoot };
