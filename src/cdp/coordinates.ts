/**
 * Shared quad math and frame/shadow coordinate stitching helpers for `measure snap`.
 *
 * These helpers are pure (`axisAlignedRectFromQuad`, `composeFrameTransform`,
 * `toTopViewportQuad`) except `getContentQuadBox`, which calls the existing `CDPClient.send`
 * directly (no new client abstraction). Quad helpers always preserve the original four
 * points from CDP; an axis-aligned rect is only ever a derived convenience alongside them,
 * never a replacement — several instruments (raster crops, hit-test, motion masks) need the
 * real quad for transformed/rotated/wrapped elements.
 */

import type { CDPClient } from './client.js';

/** Four corner points clockwise from top-left, in a single local frame's coordinate space: [x1,y1,x2,y2,x3,y3,x4,y4]. */
export type Quad = [number, number, number, number, number, number, number, number];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoxModelQuads {
  content: Quad;
  padding: Quad;
  border: Quad;
  margin: Quad;
  width: number;
  height: number;
}

export interface ContentQuadBox {
  /**
   * One quad per DOM fragment. Most elements produce exactly one; an inline element wrapped
   * across lines (or an element split by column/fragmentation) produces more than one, and
   * every fragment is preserved rather than collapsed into a single bounding rect.
   */
  quads: Quad[];
  /** `DOM.getBoxModel`'s content/padding/border/margin quads plus width/height, in the same local coordinate space as `quads`. */
  boxModel: BoxModelQuads;
}

/** Identifies a DOM node the way CDP's `DOM.getContentQuads`/`DOM.getBoxModel` accept it. */
export type NodeRef = { backendNodeId: number } | { nodeId: number } | { objectId: string };

/**
 * Reads both the content quad(s) and the full box model (content/padding/border/margin) for
 * one node via `DOM.getContentQuads` and `DOM.getBoxModel`. Coordinates are in the node's own
 * frame's local viewport space — use `composeFrameTransform`/`toTopViewportQuad` to stitch
 * iframe-nested coordinates into top-viewport space.
 */
export async function getContentQuadBox(client: CDPClient, ref: NodeRef): Promise<ContentQuadBox> {
  const [quadsResult, boxResult] = await Promise.all([
    client.send('DOM.getContentQuads', ref as unknown as Record<string, unknown>) as Promise<{
      quads: number[][];
    }>,
    client.send('DOM.getBoxModel', ref as unknown as Record<string, unknown>) as Promise<{
      model: {
        content: number[];
        padding: number[];
        border: number[];
        margin: number[];
        width: number;
        height: number;
      };
    }>,
  ]);

  const model = boxResult.model;

  return {
    quads: quadsResult.quads.map(asQuad),
    boxModel: {
      content: asQuad(model.content),
      padding: asQuad(model.padding),
      border: asQuad(model.border),
      margin: asQuad(model.margin),
      width: model.width,
      height: model.height,
    },
  };
}

function asQuad(points: number[]): Quad {
  if (points.length !== 8) {
    throw new Error(`Expected an 8-number quad (x1,y1,x2,y2,x3,y3,x4,y4), got ${points.length} numbers`);
  }
  return points as Quad;
}

/** Derives the axis-aligned bounding rect of a quad. Purely a convenience — `quad` itself stays the source of truth. */
export function axisAlignedRectFromQuad(quad: Quad): Rect {
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * One nested frame's offset: the translation (and optional scale, e.g. CSS zoom) of a child
 * frame's content-box origin within its parent frame's local coordinate space.
 */
export interface FrameOffset {
  dx: number;
  dy: number;
  /** Defaults to 1 (no scale) when omitted. */
  scaleX?: number;
  scaleY?: number;
}

export interface FrameTransform {
  dx: number;
  dy: number;
  scaleX: number;
  scaleY: number;
}

/**
 * Composes a chain of nested iframe offsets into one affine transform from the innermost
 * (target) frame's local coordinates to top-viewport coordinates. `chain` is ordered from the
 * outermost transition first (the top frame's offset into its direct child) to the innermost
 * transition last (the target's immediate parent frame's offset into the target frame).
 *
 * Shadow DOM does not need this — shadow-root content shares its host element's coordinate
 * space, so shadow-root traversal only affects which node a query resolves to, not its quad.
 */
export function composeFrameTransform(chain: FrameOffset[]): FrameTransform {
  let transform: FrameTransform = { dx: 0, dy: 0, scaleX: 1, scaleY: 1 };
  for (const offset of chain) {
    const scaleX = offset.scaleX ?? 1;
    const scaleY = offset.scaleY ?? 1;
    transform = {
      dx: transform.dx + offset.dx * transform.scaleX,
      dy: transform.dy + offset.dy * transform.scaleY,
      scaleX: transform.scaleX * scaleX,
      scaleY: transform.scaleY * scaleY,
    };
  }
  return transform;
}

/** Applies a composed `FrameTransform` to every point of a quad, mapping it into top-viewport space. */
export function toTopViewportQuad(quad: Quad, transform: FrameTransform): Quad {
  return [
    quad[0] * transform.scaleX + transform.dx,
    quad[1] * transform.scaleY + transform.dy,
    quad[2] * transform.scaleX + transform.dx,
    quad[3] * transform.scaleY + transform.dy,
    quad[4] * transform.scaleX + transform.dx,
    quad[5] * transform.scaleY + transform.dy,
    quad[6] * transform.scaleX + transform.dx,
    quad[7] * transform.scaleY + transform.dy,
  ];
}
