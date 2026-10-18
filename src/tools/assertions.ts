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
 * Finds the element-only child-index path from the document node to nodeId,
 * e.g. [0, 1, 3] = documentElement.children[1].children[3]. Returns null if the
 * node isn't in the tree, or isn't an element.
 */
function findElementPath(node: any, nodeId: number): { path: number[]; nodeName: string } | null {
  const elementChildren = (node.children || []).filter((c: any) => c.nodeType === 1);
  for (let i = 0; i < elementChildren.length; i++) {
    const child = elementChildren[i];
    if (child.nodeId === nodeId) {
      return { path: [i], nodeName: child.nodeName };
    }
    const found = findElementPath(child, nodeId);
    if (found) {
      return { path: [i, ...found.path], nodeName: found.nodeName };
    }
  }
  return null;
}

/**
 * Resolves a CDP nodeId to a live JS object handle plus its rendered rect.
 *
 * DOM.resolveNode (and DOM.requestNode in the other direction) return an empty
 * `{}` against Gameface - no error, just nothing usable - so there is no direct
 * nodeId -> JS-object bridge through the DOM domain.
 *
 * The bridge used instead: read the CDP tree with DOM.getDocument (nodeIds are
 * stable across repeated calls here, so the caller's nodeId stays valid), record
 * the element's position as a path of element-child indices, and walk the same
 * path in JS via `.children`. CDP drops whitespace-only text nodes that JS
 * `childNodes` keeps, but element children line up one-to-one, so the walk lands
 * on exactly the node the caller named - unlike hit-testing (elementFromPoint),
 * which can't reach containers whose center is covered by a child, or anything
 * under an overlay. The tag name is checked at the end to catch a DOM that
 * changed between the two reads.
 */
async function resolveElementHandle(client: Client, root: any, nodeId: number): Promise<ElementHandle> {
  const found = findElementPath(root, nodeId);
  if (!found) {
    throw new Error(
      `Node ${nodeId} is not an element in the current document. It may have been removed, or it is a text/comment node - re-run get_dom_tree for fresh IDs.`
    );
  }

  // path[0] is the document's element child, i.e. documentElement.
  const [, ...rest] = found.path;
  const walk = rest.map((i) => `.children[${i}]`).join("");
  const evalResult = await client.Runtime.evaluate({
    expression: `(() => { const el = document.documentElement${walk}; return el && el.tagName === ${JSON.stringify(found.nodeName)} ? el : null; })()`,
    returnByValue: false,
  });

  if (evalResult.exceptionDetails) {
    const text = evalResult.exceptionDetails.exception?.description || evalResult.exceptionDetails.text || "Unknown exception";
    throw new Error(`Failed to resolve node ${nodeId} to a live element: ${text}`);
  }

  const objectId = evalResult.result.objectId;
  if (!objectId) {
    throw new Error(
      `Node ${nodeId} (${found.nodeName}) could not be found in the live DOM at its tree position - the DOM likely changed mid-call. Retry, or re-run get_dom_tree.`
    );
  }

  const rect = await getBoundingRect(client, objectId);
  return { objectId, rect };
}

async function readDocumentRoot(client: Client): Promise<any> {
  const doc = await client.DOM.getDocument({ depth: -1 });
  if (!doc?.root) {
    throw new Error("Failed to read the document - DOM.getDocument returned no root node.");
  }
  return doc.root;
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

  const root = await readDocumentRoot(client);
  const { objectId } = await resolveElementHandle(client, root, nodeId);

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

  const root = await readDocumentRoot(client);
  const [handleA, handleB] = await Promise.all([
    resolveElementHandle(client, root, nodeIdA),
    resolveElementHandle(client, root, nodeIdB),
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

  const root = await readDocumentRoot(client);
  const { objectId, rect: elementRect } = await resolveElementHandle(client, root, nodeId);

  let containerRect: Rect;
  if (useViewport) {
    containerRect = await getViewportRect(client);
  } else if (containerNodeId !== undefined) {
    const containerHandle = await resolveElementHandle(client, root, containerNodeId);
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
