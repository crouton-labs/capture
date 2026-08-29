import * as fs from 'node:fs';
import * as path from 'node:path';
import { MotionCollector } from './collectors/motion.js';
import type { CollectorKind, CollectorKindEntry, DrainOutcome } from './collector.js';

function motionReconstruct(dir: string): DrainOutcome {
  const framesDir = path.join(dir, 'frames');
  const frames = fs.existsSync(framesDir) ? fs.readdirSync(framesDir).filter(name => name.endsWith('.png')).length : 0;
  const bytes = (name: string): number => {
    try { return fs.statSync(path.join(dir, name)).size; } catch { return 0; }
  };
  const files = ['events.jsonl', 'rects.jsonl', 'markers.json'].filter(name => fs.existsSync(path.join(dir, name))).map(name => ({ name, bytes: bytes(name) }));
  return { summary: { frames, state: 'orphaned-finalized' }, files };
}

const motion: CollectorKindEntry = {
  kind: 'motion',
  idSegments: ['motion', 'recs'],
  idPrefix: 'rec',
  label: 'recording',
  parseConfig(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof (raw as { harId?: unknown }).harId !== 'string' || !(raw as { harId: string }).harId) {
      throw new Error('motion config requires a session HAR recording id');
    }
    return raw;
  },
  create() { return new MotionCollector(); },
  reconstruct: motionReconstruct,
};

const unsupported = (kind: Exclude<CollectorKind, 'motion'>, idSegments: string[], idPrefix: string, label: string): CollectorKindEntry => ({
  kind,
  idSegments,
  idPrefix,
  label,
  parseConfig(raw) { return raw; },
  create() { throw new Error(`${kind} collector is not installed`); },
  reconstruct(dir) { return { summary: {}, files: [] }; },
});

export const COLLECTOR_KINDS: Record<CollectorKind, CollectorKindEntry> = {
  motion,
  trace: unsupported('trace', ['perf', 'traces'], 'trace', 'trace'),
  heap: unsupported('heap', ['heap', 'snapshots'], 'heap', 'heap snapshot'),
  intercept: unsupported('intercept', ['network', 'mocks'], 'mock', 'mock'),
};

export function collectorKind(kind: CollectorKind): CollectorKindEntry { return COLLECTOR_KINDS[kind]; }
