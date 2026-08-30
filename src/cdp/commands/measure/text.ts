import { ArtifactResolutionError, resolveSnapRef } from '../../../output/artifact.js';
import { data, emitResult, fact, formatCoordinate, line, lineList, text, type FactLine, type RenderableResult } from '../../../output/render.js';
import { type ParsedArgs } from '../../types.js';
import { measureTextSnapshot, writeTextCrop, type TextMeasurement } from '../../measure/text.js';

const USAGE = `capture measure text <snap> --selector <target> — direct DOM content text, font, recorded color-model contrast, and provenance from one settled snapshot

input:
  <snap>               snapshot id in the active session or absolute artifact path (required)
  --selector <target>  one recorded CSS/text/AX selector input or backend:<id> (required)
  --crop               write a measured selector crop artifact; its sessionless bundle is rooted by --artifact-dir
  --artifact-dir <path>  root for the sessionless crop bundle; ignored when an active session owns the crop
output: <text selector=… contrast=…> — one target's direct DOM content text, font metrics, recorded foreground/background color model, contrast ratio, and recorded style provenance
effects: reads an existing snapshot and never drives the browser; --crop maps recorded CSS geometry through queries.json's CSS viewport and writes one PNG under the active session or, sessionless, a one-shot bundle under --artifact-dir`;

function attestation(measurement: TextMeasurement) {
  return {
    kind: 'snapshot' as const,
    id: measurement.ref.id,
    path: measurement.ref.dir,
    note: measurement.meta.settled === false
      ? text`Snapshot was captured unsettled; text facts intersecting an unstable region may vary on re-capture.`
      : measurement.meta.settled === true
        ? fact`Snapshot settled${measurement.meta.settleMs === undefined ? '' : ` after ${measurement.meta.settleMs}ms`}.`
        : text`Snapshot settledness was not recorded.`,
  };
}

function textFacts(measurement: TextMeasurement): FactLine[] {
  if (!measurement.textAvailable) return [fact`Text collection was unavailable: ${measurement.textUnavailableReason ?? 'no reason was recorded'}; no direct DOM content text, text metrics, or font facts are available.`];
  const record = measurement.text;
  if (!record) return [text`No text-layout record joined to the selected geometry record by backend node id or geometry element id.`];
  const font = record.font ?? {};
  const lines = record.lines ?? [];
  return [
    line(text`Direct DOM content text: `, data(record.text ?? '(not recorded)', Number.MAX_SAFE_INTEGER)),
    text`This is raw text from the target's direct DOM text nodes; CSS text transforms and generated ::before/::after content are not represented in this text value.`,
    fact`Text metrics: chars=${record.textLength ?? (record.text?.length ?? 0)}; lines=${record.lineCount ?? lines.length}; truncated=${String(record.truncated ?? false)}; truncation-style=${record.truncationStyle ?? 'none'}; scroll-width=${record.scrollWidth ?? 0}; client-width=${record.clientWidth ?? 0}.`,
    fact`Font metrics: family=${font.family ?? 'unknown'}; size=${font.size ?? 'unknown'}; weight=${font.weight ?? 'unknown'}; line-height=${font.lineHeight ?? 'unknown'}; writing-mode=${record.writingMode ?? 'unknown'}; direction=${record.direction ?? 'unknown'}; fallback-used=${String(record.fallbackUsed ?? 'unknown')}.`,
    fact`Text-line collection: ${lines.length} recorded line box(es); platform-fonts-available=${String(record.platformFontsAvailable ?? false)}; platform-families=${(record.platformFonts ?? []).map((entry) => entry.familyName ?? 'unknown').join(', ') || 'none recorded'}.`,
  ];
}

function contrastFacts(measurement: TextMeasurement): FactLine[] {
  const contrast = measurement.contrast;
  if (!contrast.available) return [fact`Foreground/background color model and contrast ratio were not resolved: ${contrast.uncertainty}.`];
  return [
    fact`Foreground in the recorded color model: rgb(${contrast.foreground.join(', ')}).`,
    fact`Background in the recorded color model: rgb(${contrast.background.join(', ')}); opaque background-color source=${contrast.backgroundSource}.`,
    fact`Contrast ratio in the recorded color model: ${contrast.ratio.toFixed(2)}:1.`,
    fact`Color-model provenance: ${contrast.provenance}. The model composites recorded computed color, background-color, and geometry opacity; background images, gradients, and other paint are not recorded.`,
  ];
}

function styleFacts(measurement: TextMeasurement): FactLine[] {
  const facts: FactLine[] = measurement.styles.map((style) => fact`Style winner for ${style.element}: ${style.property}=${style.value}; selector ${style.selector}; specificity ${style.specificity}; source ${style.source}.${style.uncertainty ? ` Cascade uncertainty: ${style.uncertainty}.` : ''}`);
  if (!facts.length) facts.push(text`No recorded winning declaration provenance for the selected color or background-color paint chain.`);
  if (measurement.styleProvenanceUnavailableFor.length) facts.push(fact`Winning-declaration provenance was unavailable for: ${measurement.styleProvenanceUnavailableFor.join(', ')}.`);
  return facts;
}

function invalidInput(message: FactLine): RenderableResult {
  return {
    tag: 'error',
    attrs: { command: 'measure text', status: 'invalid_input' },
    summary: message,
    followUp: text`Run capture measure text <snap> --selector <CSS|backend:id|axid:id|ax:name|text:value>.`,
  };
}

export async function cmdMeasureText(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) { console.log(USAGE); return; }
  if (parsed.positional.length !== 1) {
    emitResult(invalidInput(fact`Expected exactly one snapshot target; received ${parsed.positional.length}.`), { json: parsed.json });
    process.exitCode = 1;
    return;
  }
  if (!parsed.selector?.trim()) {
    emitResult(invalidInput(text`The --selector flag is required.`), { json: parsed.json });
    process.exitCode = 1;
    return;
  }
  try {
    const ref = await resolveSnapRef(parsed.positional[0]!);
    const report = measureTextSnapshot(ref, parsed.selector);
    if (report.kind === 'missing-selector') {
      emitResult({
        tag: 'error',
        attrs: { command: 'measure text', status: 'missing_selector', selector: report.selector },
        summary: fact`No geometry element matched selector input ${report.selector}.`,
        sections: [lineList(report.available.candidates.map((candidate, index) => fact`${index + 1}. ${candidate}`))],
        followUp: text`Use an exact recorded selector, backend id, AX identity, or text identity from this snapshot.`,
      }, { json: parsed.json });
      process.exitCode = 1;
      return;
    }
    if (report.kind === 'ambiguous-selector') {
      emitResult({
        tag: 'error',
        attrs: { command: 'measure text', status: 'ambiguous_selector', selector: report.selector, matches: report.matchCount, displayed: report.candidates.length },
        summary: fact`Selector input ${report.selector} matched ${report.matchCount} recorded elements; no text target was selected.`,
        sections: [lineList(report.candidates.map((candidate, index) => fact`${index + 1}. ${candidate.selector ?? candidate.id}${typeof candidate.backendNodeId === 'number' ? ` — backend:${candidate.backendNodeId}` : ''}`))],
        followUp: text`Retry with an exact CSS selector, axid, or numeric backend id from the candidate identity facts.`,
      }, { json: parsed.json });
      process.exitCode = 1;
      return;
    }
    const crop = parsed.textCrop ? writeTextCrop(report, parsed.artifactDir) : undefined;
    const target = report.element.selector ?? report.element.id;
    const result: RenderableResult = {
      tag: 'text',
      attestation: attestation(report),
      attrs: {
        selector: target,
        matches: report.matchCount,
        ...(typeof report.element.backendNodeId === 'number' ? { backend: report.element.backendNodeId } : {}),
        settled: report.meta.settled ?? 'unknown',
        contrast: report.contrast.available ? `${report.contrast.ratio.toFixed(2)}:1` : 'unresolved',
        ...(crop ? { crop: crop.path } : {}),
      },
      summary: report.textAvailable
        ? report.contrast.available
          ? fact`Recorded direct-DOM-content text, font, color-model contrast, and style-provenance facts for ${target} from one snapshot.`
          : fact`Recorded direct-DOM-content text, font, and style-provenance facts for ${target}; the recorded color model did not resolve a contrast ratio.`
        : report.contrast.available
          ? fact`Recorded color-model contrast and style-provenance facts for ${target}; text collection was unavailable (${report.textUnavailableReason ?? 'no reason was recorded'}).`
          : fact`Recorded style-provenance facts for ${target}; text collection was unavailable (${report.textUnavailableReason ?? 'no reason was recorded'}) and the recorded color model did not resolve a contrast ratio.`,
      sections: [
        ...(report.element.rect && report.element.rect.width !== undefined && report.element.rect.height !== undefined ? [line(text`Target geometry: `, formatCoordinate({ x: report.element.rect.x, y: report.element.rect.y, w: report.element.rect.width, h: report.element.rect.height }))] : [text`Target geometry was not recorded.`]),
        ...textFacts(report),
        ...contrastFacts(report),
        ...styleFacts(report),
        ...(crop ? [fact`Crop artifact: ${crop.path}; requested CSS geometry x=${crop.requested.x} y=${crop.requested.y} w=${crop.requested.w} h=${crop.requested.h}; delivered raster geometry x=${crop.delivered.x} y=${crop.delivered.y} w=${crop.delivered.w} h=${crop.delivered.h}; CSS-to-raster scale x=${crop.scale.x} y=${crop.scale.y}, derived from queries.json's recorded CSS viewport.`] : []),
      ],
    };
    emitResult(result, { json: parsed.json });
  } catch (error) {
    const detail = error instanceof ArtifactResolutionError || error instanceof Error ? error.message : String(error);
    emitResult({
      tag: 'error',
      attrs: { command: 'measure text', status: error instanceof ArtifactResolutionError ? 'artifact_unavailable' : 'text_unavailable' },
      summary: fact`The requested text measurement could not be read: ${detail}`,
      followUp: text`Create a settled snapshot with capture measure snap <url>, then pass its id or absolute path.`,
    }, { json: parsed.json });
    process.exitCode = 1;
  }
}
