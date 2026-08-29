import { emitResult, fact, formatArtifactList, type RenderableResult } from '../../../../output/render.js';
import { type ParsedArgs } from '../../../types.js';
import { stopMock, type StoppedMock } from './lifecycle.js';

const HELP = `capture tab mock stop — remove the mock rules and finalize the record of what was mocked

input:
  (none)   the session's one live mock is selected without an id
output: <mock …> — how many requests paused, how many matched each rule, how many were released unmatched at teardown, and the mock's completion state; --json mirrors
effects: returns the tab to real network behavior; releases the collector host's \`fetch-interception\` claim and exits the host when nothing else is collecting`;

export function buildMockStoppedResult(mock: StoppedMock): RenderableResult {
  const sections = mock.ruleMatches.map((matched, index) => fact`Rule ${index} matched ${matched} request(s).`);
  const incomplete = mock.completion === 'complete' ? [] : [fact`Mock completion is ${mock.completion}; counts reflect the finalized collector record.`];
  return {
    tag: 'mock',
    attrs: {
      mock: mock.id,
      path: mock.dir,
      state: 'stopped',
      completion: mock.completion,
      rules: mock.rules,
      paused: mock.paused,
      matched: mock.matched,
      'released-unmatched': mock.releasedUnmatched,
    },
    summary: fact`Requests were answered from the rule document copied to rules.json; counts are per rule in document order, first match wins. ${mock.paused} request(s) paused, ${mock.matched} matched a rule, and ${mock.releasedUnmatched} paused request(s) were continued unmodified during teardown.`,
    artifacts: formatArtifactList([{ name: 'rules.json', note: 'the exact installed rule document' }, { name: 'interceptions.jsonl', note: 'one record per paused request' }, { name: 'meta.json', note: 'completion and collector counts' }]),
    sections: [...sections, ...incomplete],
  };
}

export async function cmdTabMockStop(parsed: ParsedArgs): Promise<void> {
  if (parsed.help) {
    console.log(HELP);
    return;
  }
  emitResult(buildMockStoppedResult(await stopMock()), { json: parsed.json });
}
