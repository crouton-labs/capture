// Runner preamble (package.json "test"): pins a process-unique CAPTURE_ROOT
// before any test file's module graph loads, so parallel test processes never
// share os.tmpdir()/capture-sessions. artifacts.ts freezes the root at import.
// The assignment is unconditional: an inherited ambient CAPTURE_ROOT would
// recreate cross-process sharing. Files that set their own root before a lazy
// import of artifacts.ts overwrite this value and stay isolated their own way.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

process.env.CAPTURE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-test-root-'));
