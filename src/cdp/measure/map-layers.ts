import type { LayerRecord, LayersReport } from './collectors/layers.js';
import type { SnapMeta } from '../../session/artifacts.js';
import {
  annotateUnstableFacts,
  readGeometry,
  readLayers,
  readMeta,
  unstableRegionsFor,
  type Rect,
  type SnapRef,
  type UnstableCaveat,
} from '../../output/artifact.js';
import {
  data,
  fact,
  formatCoordinate,
  formatProvenance,
  line,
  lineList,
  text,
  type FactLine,
  type RenderableResult,
} from '../../output/render.js';

interface LayerFact {
  readonly layer: LayerRecord;
  readonly rect: Rect;
}

function sourceFor(layer: LayerRecord): string | undefined {
  const provenance = layer.styleProvenance;
  if (!provenance) return undefined;
  if (provenance.authored) {
    return `${provenance.authored.file}:${provenance.authored.line}:${provenance.authored.column}`;
  }
  if (provenance.generated) {
    return `${provenance.generated.sourceURL}:${provenance.generated.line}:${provenance.generated.column}`;
  }
  return provenance.sourceStyleSheetUrl;
}

function caveatLine(caveats: readonly UnstableCaveat[]): FactLine | undefined {
  if (!caveats.length) return undefined;
  return lineList(caveats.map((caveat) => fact`nondeterminism caveat: unstable region ${caveat.regionId}${caveat.selector ? ` (${caveat.selector})` : ''}${caveat.reason ? ` — ${caveat.reason}` : ''}`));
}

function uniqueCaveats(caveats: readonly UnstableCaveat[]): UnstableCaveat[] {
  const seen = new Set<string>();
  return caveats.filter((caveat) => {
    const key = `${caveat.regionId}\u0000${caveat.selector ?? ''}\u0000${caveat.reason ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatLayer(layer: LayerRecord, membershipAvailable: boolean, caveats: readonly UnstableCaveat[]): FactLine {
  const details: FactLine[] = [
    line(
      text`Layer `,
      data(layer.id),
      text` — `,
      formatCoordinate({ x: layer.bounds.x, y: layer.bounds.y, w: layer.bounds.width, h: layer.bounds.height }),
      text`; LayerTree delivery index `,
      data(layer.layerPaintOrder),
      text`; draws content `,
      data(layer.drawsContentUnavailable ? 'unavailable' : String(layer.drawsContent)),
      text`; paint count `,
      data(layer.paintCountUnavailable ? 'unavailable' : layer.paintCount),
    ),
  ];
  if (layer.backendNodeId !== null) details.push(fact`owner backend node ${layer.backendNodeId}${layer.selector ? ` (${layer.selector})` : ''}`);
  if (layer.parentLayerId) details.push(fact`parent layer ${layer.parentLayerId}`);
  if (layer.compositingReasonsUnavailable) details.push(text`Compositing reasons were unavailable for this layer.`);
  else if (layer.compositingReasons.length) details.push(fact`Compositing reasons: ${layer.compositingReasons.join(', ')}`);
  else details.push(text`Compositing reasons: none reported.`);
  if (!membershipAvailable) details.push(text`Node membership was unavailable for this layer.`);
  else if (layer.membersTruncated) details.push(fact`Node membership: ${layer.memberCount} painted node(s); first ${layer.memberBackendNodeIds.length} backend id(s): ${layer.memberBackendNodeIds.join(', ')}; ${layer.membersTruncated} additional id(s) not listed.`);
  else details.push(fact`Node membership: ${layer.memberCount} painted node(s); backend id(s): ${layer.memberBackendNodeIds.join(', ') || '(none)'}.`);
  if (layer.styleProvenance) {
    const provenance = layer.styleProvenance;
    details.push(line(
      text`Layer-affecting property `,
      data(provenance.property),
      text`: `,
      formatProvenance({
        selector: provenance.selector ?? '(no selector)',
        source: sourceFor(layer),
        specificity: provenance.specificity ?? undefined,
        extra: provenance.value === null ? text`computed value unavailable` : fact`computed value ${provenance.value}`,
      }),
    ));
    if (provenance.winnerApproximate) details.push(fact`Winning-declaration ordering is approximate${provenance.winnerApproximateReason ? `: ${provenance.winnerApproximateReason}` : ''}.`);
    if (provenance.sourceResolutionUnavailable) details.push(fact`Source provenance resolution was unavailable${provenance.sourceResolutionUnavailableReason ? `: ${provenance.sourceResolutionUnavailableReason}` : ''}.`);
  } else if (layer.styleProvenanceUnavailable) {
    details.push(text`Layer-affecting declaration provenance was unavailable for this layer.`);
  } else {
    details.push(text`No author-declared layer-affecting property was recorded for this layer.`);
  }
  const caveat = caveatLine(caveats);
  if (caveat) details.push(caveat);
  return lineList(details);
}

function paintOrderLine(report: LayersReport, caveats: readonly UnstableCaveat[]): FactLine {
  if (!report.paintOrder.available) return fact`DOMSnapshot paint order unavailable${report.paintOrder.reason ? `: ${report.paintOrder.reason}` : ''}.`;
  const ids = report.paintOrder.backendNodeIds;
  const suffix = report.paintOrder.truncated ? `; ${report.paintOrder.truncated} additional backend node id(s) not listed` : '';
  const base = fact`DOMSnapshot paint order (back-to-front): ${ids.join(', ') || '(no painted backend nodes recorded)'}${suffix}.`;
  const caveat = caveatLine(caveats);
  return caveat ? lineList([base, caveat]) : base;
}

export function buildMeasureMapLayersResult(ref: SnapRef): RenderableResult {
  const report = readLayers<LayersReport>(ref);
  const meta = readMeta<SnapMeta>(ref);
  const regions = unstableRegionsFor(ref);
  const geometry = readGeometry<{ elements?: Array<{ id?: string; backendNodeId?: number; rect?: Rect }> }>(ref);
  const geometryByBackendNodeId = new Map<number, { id?: string; rect?: Rect }>();
  for (const element of geometry.elements ?? []) {
    if (typeof element.backendNodeId === 'number') geometryByBackendNodeId.set(element.backendNodeId, element);
  }
  const caveatsForBackendNodeIds = (ids: readonly number[]): UnstableCaveat[] => uniqueCaveats(
    annotateUnstableFacts(ids.map((id) => {
      const element = geometryByBackendNodeId.get(id);
      return { elementId: element?.id, rect: element?.rect };
    }), regions).flatMap(({ caveats }) => caveats),
  );
  const layerFacts: LayerFact[] = report.layers.map((layer) => ({
    layer,
    rect: { x: layer.bounds.x, y: layer.bounds.y, w: layer.bounds.width, h: layer.bounds.height },
  }));
  const annotated = annotateUnstableFacts(layerFacts, regions).map(({ fact: layerFact, caveats }) => ({
    layerFact,
    caveats: uniqueCaveats([...caveats, ...caveatsForBackendNodeIds(layerFact.layer.memberBackendNodeIds)]),
  }));
  const paintOrderCaveats = caveatsForBackendNodeIds(report.paintOrder.backendNodeIds);
  const layerTreeStatus = report.layerTree.available ? 'available' : 'unavailable';
  const paintOrderStatus = report.paintOrder.available ? 'available' : 'unavailable';
  const membershipStatus = report.membership.available ? 'available' : 'unavailable';
  const availability = report.layerTree.available
    ? fact`LayerTree facts available for ${report.layers.length} layer(s). DOMSnapshot paint order is ${paintOrderStatus}.`
    : fact`LayerTree facts unavailable${report.layerTree.reason ? `: ${report.layerTree.reason}` : ''}. DOMSnapshot paint order is ${paintOrderStatus}.`;
  const sections: FactLine[] = [availability, paintOrderLine(report, paintOrderCaveats)];
  if (report.layersTruncated) sections.push(fact`${report.layersTruncated} compositor layer(s) were not listed because the snapshot collector capped the layer inventory.`);
  if (report.membership.available) {
    sections.push(fact`Per-node layer membership available; ${report.membership.unassignedCount} painted node(s) had no layer assignment.`);
  } else {
    sections.push(fact`Per-node layer membership unavailable${report.membership.reason ? `: ${report.membership.reason}` : ''}.`);
  }
  if (!report.styleSheetHeaders.available) {
    sections.push(fact`Stylesheet-header provenance availability: unavailable${report.styleSheetHeaders.reason ? `: ${report.styleSheetHeaders.reason}` : ''}.`);
  }
  sections.push(...annotated.map(({ layerFact, caveats }) => formatLayer(layerFact.layer, report.membership.available, caveats)));

  return {
    tag: 'layer-map',
    attestation: {
      kind: 'snapshot',
      id: ref.id,
      path: ref.dir,
      note: meta.settled
        ? text`Snapshot was settled before its layer facts were captured.`
        : fact`Snapshot was captured unsettled; layer facts carry per-region nondeterminism caveats where their bounds overlap marked unstable regions.`,
    },
    attrs: {
      layers: report.layers.length,
      'layer-tree': layerTreeStatus,
      'paint-order': paintOrderStatus,
      membership: membershipStatus,
      settled: meta.settled,
    },
    summary: text`Paint/compositor layer facts, DOMSnapshot paint order, node membership, and available layer-style provenance are reported from layers.json.`,
    sections,
    followUp: fact`Inspect an element's cascade and stacking facts with \`capture measure explain ${ref.id} --selector <selector>\`.`,
  };
}
