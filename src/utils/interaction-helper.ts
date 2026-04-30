/**
 * Interaction Helper
 * 
 * Utilities for resolving element coordinates and preparing for interactions
 * via Chrome DevTools Protocol Input domain.
 */

import type { Client } from "chrome-remote-interface";

export interface ElementCoordinates {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export interface BackendNode {
  backendNodeId: number;
  nodeType: number;
  nodeName: string;
}

/**
 * Resolves a DOM node ID to backend node and retrieves element box model
 * with coordinates for interaction.
 * 
 * @param client CDP client instance
 * @param nodeId DOM node ID from DOM.getDocument or querySelector
 * @returns Element coordinates and dimensions
 * @throws Error if node not found or element not visible
 */
export async function getElementCoordinates(
  client: Client,
  nodeId: number
): Promise<ElementCoordinates> {
  // Get the box model for the element
  // This returns the element's position and dimensions in the viewport
  const boxModelResult = await client.DOM.getBoxModel({ nodeId });

  if (!boxModelResult || !boxModelResult.model) {
    throw new Error(`Failed to get box model for node ${nodeId}. Element may not be visible or rendered.`);
  }

  // Box model returns quad arrays [x1,y1, x2,y2, x3,y3, x4,y4] for content, padding, border, margin
  // We use the content quad for interaction
  const contentQuad = boxModelResult.model.content;
  
  // Extract coordinates from quad (top-left, top-right, bottom-right, bottom-left)
  const x1 = contentQuad[0];
  const y1 = contentQuad[1];
  const x2 = contentQuad[2];
  const y2 = contentQuad[3];
  const x3 = contentQuad[4];
  const y3 = contentQuad[5];
  const x4 = contentQuad[6];
  const y4 = contentQuad[7];

  // Calculate bounding box
  const minX = Math.min(x1, x2, x3, x4);
  const maxX = Math.max(x1, x2, x3, x4);
  const minY = Math.min(y1, y2, y3, y4);
  const maxY = Math.max(y1, y2, y3, y4);

  const width = maxX - minX;
  const height = maxY - minY;

  // Center point for click/hover interactions
  const centerX = minX + width / 2;
  const centerY = minY + height / 2;

  return {
    x: minX,
    y: minY,
    width,
    height,
    centerX,
    centerY,
  };
}

/**
 * Resolves a DOM node ID to its backend node representation.
 * Backend node ID is used for some CDP operations.
 * 
 * @param client CDP client instance
 * @param nodeId DOM node ID
 * @returns Backend node information
 */
export async function resolveBackendNode(
  client: Client,
  nodeId: number
): Promise<BackendNode> {
  // Resolve the node to get backend node ID
  const resolveResult = await client.DOM.resolveNode({ nodeId });

  if (!resolveResult || !resolveResult.object) {
    throw new Error(`Failed to resolve node ${nodeId}`);
  }

  // Get node details via Runtime.getProperties if needed
  // For now, return basic backend node info
  return {
    backendNodeId: resolveResult.object.objectId ? 0 : nodeId, // Simplified
    nodeType: 1, // Element node
    nodeName: "UNKNOWN", // Would need additional query to get name
  };
}

/**
 * Scrolls an element into view if it's not currently visible in viewport.
 * 
 * @param client CDP client instance
 * @param nodeId DOM node ID to scroll into view
 */
export async function scrollIntoView(
  client: Client,
  nodeId: number
): Promise<void> {
  await client.DOM.scrollIntoViewIfNeeded({ nodeId });
}
