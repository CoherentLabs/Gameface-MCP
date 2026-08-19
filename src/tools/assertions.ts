/**
 * UI Assertion Tools
 *
 * Read-only diagnostic checks for common UI layout defects: text overflowing its
 * box, elements overlapping each other, and elements spilling outside a container.
 * Each tool reports pass/fail plus measurements; it does not modify the page.
 * Callers (agents) are expected to act on the result using eval_js/interact_element/etc.
 */

import type { Client } from "chrome-remote-interface";
import { getConnectionManager } from "./connect-browser.js";
import {
  AssertTextFitsParams,
  AssertTextFitsResult,
  AssertNoOverlapParams,
  AssertNoOverlapResult,
  AssertWithinParentParams,
  AssertWithinParentResult,
  Rect,
} from "../types.js";
import { createLogger } from "../logger.js";

const log = createLogger("Assertions");

// Subpixel rendering can introduce ~fractions of a pixel of jitter; tolerate that
// much before flagging overflow/overlap so identical layouts don't flap between
// pass/fail on repeated checks.
const GEOMETRY_TOLERANCE = 0.5;
const TEXT_FIT_TOLERANCE = 1;

function requireConnectedClient(): Client {
  const manager = getConnectionManager();
  if (!manager.isConnected()) {
    throw new Error("Not connected to a browser. Please connect first using the connect_browser tool.");
  }
  const client = manager.getClient();
  if (!client) {
    throw new Error("Not connected to a browser. Please connect first using the connect_browser tool.");
  }
  return client;
}

interface ElementHandle {
  objectId: string;
  rect: Rect;
}

/**
 * How long to wait before retrying a mismatched resolution. Gameface runs layout
 * on a separate thread and settles geometry roughly one frame behind a mutation
 * (documented elsewhere in this engine, and confirmed for DOM.getBoxModel
 * specifically: reading it immediately after a resize can still report the
 * pre-mutation size for a frame). 50ms comfortably covers a few frames at 60Hz.
 */
const STALE_RETRY_DELAY_MS = 50;

/**
 * Resolves a CDP nodeId to a live JS object handle plus its rendered rect.
 *
 * DOM.resolveNode returns an empty `{}` (no error, just nothing usable) against
 * this Gameface build - verified, not a timing issue: DOM-domain WRITE commands
 * (DOM.setAttributeValue) silently no-op here too, while plain JS mutations via
 * Runtime.evaluate sync correctly and immediately in both directions. So there is
 * no reliable nodeId -> JS-object bridge through the DOM domain at all here.
 *
 * The fix: DOM.getBoxModel({nodeId}) DOES work (confirmed), so get the element's
 * rendered box that way, then pick it up on the JS side via
 * document.elementFromPoint at its center - the one confirmed-working bridge.
 * elementFromPoint returns whichever element is topmost at that point, which
 * could be a different, overlapping element (e.g. a child covering the target's
 * center) rather than the node getBoxModel described - so the resolved element's
 * own rect is verified against the expected one before it's trusted. A mismatch
 * is retried once after a short delay before being treated as a real "wrong
 * element" case, because DOM.getBoxModel itself can report stale (pre-mutation)
 * geometry for a frame or two right after a change - the same mismatch a genuine
 * overlapping element would produce, but one that resolves on its own shortly.
 */
async function resolveElementHandle(client: Client, nodeId: number, isRetry = false): Promise<ElementHandle> {
  const boxModel = await client.DOM.getBoxModel({ nodeId });
  if (!boxModel || !boxModel.model) {
    throw new Error(`Failed to get box model for node ${nodeId}. Element may not exist or may not be rendered.`);
  }

  const quad = boxModel.model.border;
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;

  const evalResult = await client.Runtime.evaluate({
    expression: `document.elementFromPoint(${cx}, ${cy})`,
    returnByValue: false,
  });

  if (evalResult.exceptionDetails) {
    const text = evalResult.exceptionDetails.exception?.description || evalResult.exceptionDetails.text || "Unknown exception";
    throw new Error(`Failed to resolve node ${nodeId} via elementFromPoint: ${text}`);
  }

  const objectId = evalResult.result.objectId;
  if (!objectId) {
    throw new Error(
      `document.elementFromPoint found nothing at node ${nodeId}'s center (${cx.toFixed(1)}, ${cy.toFixed(1)}). It may be zero-size, hidden, or offscreen.`
    );
  }

  const rect = await getBoundingRect(client, objectId);
  const widthDiff = Math.abs(rect.width - (right - left));
  const heightDiff = Math.abs(rect.height - (bottom - top));
  if (widthDiff > GEOMETRY_TOLERANCE || heightDiff > GEOMETRY_TOLERANCE) {
    if (!isRetry) {
      await new Promise((resolve) => setTimeout(resolve, STALE_RETRY_DELAY_MS));
      return resolveElementHandle(client, nodeId, true);
    }
    throw new Error(
      `Node ${nodeId}'s center point (${cx.toFixed(1)}, ${cy.toFixed(1)}) resolved to a differently-sized element ` +
        `(expected ${(right - left).toFixed(1)}x${(bottom - top).toFixed(1)}, got ${rect.width.toFixed(1)}x${rect.height.toFixed(1)}), ` +
        `even after a retry - likely a child or overlapping element sits at that exact point instead of node ${nodeId} itself.`
    );
  }

  return { objectId, rect };
}

async function getBoundingRect(client: Client, objectId: string): Promise<Rect> {
  const result = await (client as any).Runtime.callFunctionOn({
    objectId,
    functionDeclaration: `function() {
      const r = this.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, right: r.right, bottom: r.bottom, left: r.left };
    }`,
    returnByValue: true,
  });

  if (result.exceptionDetails) {
    const text = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Unknown exception";
    throw new Error(`Failed to read bounding rect: ${text}`);
  }

  return result.result.value as Rect;
}

async function getParentObjectId(client: Client, objectId: string): Promise<string | null> {
  const result = await (client as any).Runtime.callFunctionOn({
    objectId,
    functionDeclaration: `function() { return this.parentElement; }`,
    returnByValue: false,
  });

  if (result.exceptionDetails) {
    const text = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Unknown exception";
    throw new Error(`Failed to read parentElement: ${text}`);
  }

  return result.result.objectId || null;
}

async function getViewportRect(client: Client): Promise<Rect> {
  const result = await client.Runtime.evaluate({
    expression: `({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight, top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight })`,
    returnByValue: true,
  });

  if (result.exceptionDetails) {
    const text = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Unknown exception";
    throw new Error(`Failed to read viewport size: ${text}`);
  }

  return result.result.value as Rect;
}

function rectsOverlap(a: Rect, b: Rect): { overlaps: boolean; overlapRect?: Rect } {
  const x1 = Math.max(a.left, b.left);
  const y1 = Math.max(a.top, b.top);
  const x2 = Math.min(a.right, b.right);
  const y2 = Math.min(a.bottom, b.bottom);

  if (x2 - x1 > GEOMETRY_TOLERANCE && y2 - y1 > GEOMETRY_TOLERANCE) {
    return {
      overlaps: true,
      overlapRect: { x: x1, y: y1, width: x2 - x1, height: y2 - y1, top: y1, left: x1, right: x2, bottom: y2 },
    };
  }
  return { overlaps: false };
}

/**
 * Checks whether an element's rendered content overflows its own box, i.e.
 * scrollWidth/scrollHeight exceed clientWidth/clientHeight (text clipped or
 * pushed outside its container).
 */
export async function assertTextFits(params: AssertTextFitsParams): Promise<AssertTextFitsResult> {
  const client = requireConnectedClient();
  const { nodeId } = params;

  log.info(`Checking text fit for node ${nodeId}`);

  const { objectId } = await resolveElementHandle(client, nodeId);

  const result = await (client as any).Runtime.callFunctionOn({
    objectId,
    functionDeclaration: `function() {
      return {
        scrollWidth: this.scrollWidth,
        scrollHeight: this.scrollHeight,
        clientWidth: this.clientWidth,
        clientHeight: this.clientHeight,
      };
    }`,
    returnByValue: true,
  });

  if (result.exceptionDetails) {
    const text = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Unknown exception";
    throw new Error(`Failed to read scroll/client dimensions for node ${nodeId}: ${text}`);
  }

  const measurements = result.result.value as AssertTextFitsResult["measurements"];
  const overflowX = Math.max(0, measurements.scrollWidth - measurements.clientWidth);
  const overflowY = Math.max(0, measurements.scrollHeight - measurements.clientHeight);
  const fits = overflowX <= TEXT_FIT_TOLERANCE && overflowY <= TEXT_FIT_TOLERANCE;

  log.info(`Node ${nodeId}: fits=${fits} overflowX=${overflowX.toFixed(1)} overflowY=${overflowY.toFixed(1)}`);

  return {
    success: true,
    fits,
    overflowX,
    overflowY,
    measurements,
    message: fits
      ? `Content fits within node ${nodeId}'s box.`
      : `Content overflows node ${nodeId}'s box by ${overflowX.toFixed(1)}px horizontally and ${overflowY.toFixed(1)}px vertically.`,
  };
}

/**
 * Checks whether two elements' rendered boxes (getBoundingClientRect) intersect.
 */
export async function assertNoOverlap(params: AssertNoOverlapParams): Promise<AssertNoOverlapResult> {
  const client = requireConnectedClient();
  const { nodeIdA, nodeIdB } = params;

  log.info(`Checking overlap between node ${nodeIdA} and node ${nodeIdB}`);

  const [handleA, handleB] = await Promise.all([
    resolveElementHandle(client, nodeIdA),
    resolveElementHandle(client, nodeIdB),
  ]);
  const rectA = handleA.rect;
  const rectB = handleB.rect;

  const { overlaps, overlapRect } = rectsOverlap(rectA, rectB);

  log.info(`Node ${nodeIdA} vs node ${nodeIdB}: overlaps=${overlaps}`);

  return {
    success: true,
    overlaps,
    rectA,
    rectB,
    overlapRect,
    message: overlaps
      ? `Node ${nodeIdA} and node ${nodeIdB} overlap by ${overlapRect!.width.toFixed(1)}x${overlapRect!.height.toFixed(1)}px.`
      : `Node ${nodeIdA} and node ${nodeIdB} do not overlap.`,
  };
}

/**
 * Checks whether an element's rendered box is fully contained within a container's
 * box. The container defaults to the element's immediate parent, but an explicit
 * containerNodeId (any ancestor) or the viewport can be used instead.
 */
export async function assertWithinParent(params: AssertWithinParentParams): Promise<AssertWithinParentResult> {
  const client = requireConnectedClient();
  const { nodeId, containerNodeId, useViewport } = params;

  log.info(
    `Checking bounds for node ${nodeId} against ${useViewport ? "viewport" : containerNodeId !== undefined ? `node ${containerNodeId}` : "immediate parent"}`
  );

  const { objectId, rect: elementRect } = await resolveElementHandle(client, nodeId);

  let containerRect: Rect;
  if (useViewport) {
    containerRect = await getViewportRect(client);
  } else if (containerNodeId !== undefined) {
    const containerHandle = await resolveElementHandle(client, containerNodeId);
    containerRect = containerHandle.rect;
  } else {
    const parentObjectId = await getParentObjectId(client, objectId);
    if (!parentObjectId) {
      throw new Error(`Node ${nodeId} has no parent element to check against. Provide containerNodeId or useViewport instead.`);
    }
    containerRect = await getBoundingRect(client, parentObjectId);
  }

  const overflow = {
    left: containerRect.left - elementRect.left,
    right: elementRect.right - containerRect.right,
    top: containerRect.top - elementRect.top,
    bottom: elementRect.bottom - containerRect.bottom,
  };

  const within =
    overflow.left <= GEOMETRY_TOLERANCE &&
    overflow.right <= GEOMETRY_TOLERANCE &&
    overflow.top <= GEOMETRY_TOLERANCE &&
    overflow.bottom <= GEOMETRY_TOLERANCE;

  log.info(`Node ${nodeId}: within=${within}`);

  return {
    success: true,
    within,
    elementRect,
    containerRect,
    overflow,
    message: within
      ? `Node ${nodeId} is fully within its container's bounds.`
      : `Node ${nodeId} extends outside its container's bounds (left=${overflow.left.toFixed(1)}, right=${overflow.right.toFixed(1)}, top=${overflow.top.toFixed(1)}, bottom=${overflow.bottom.toFixed(1)}; positive = out of bounds).`,
  };
}
