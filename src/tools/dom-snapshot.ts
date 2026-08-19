import { getConnectionManager } from "./connect-browser.js";
import { GetDomSnapshotParams, GetDomSnapshotResult, DomNode } from "../types.js";
import { createLogger } from "../logger.js";

const log = createLogger("DomSnapshot");

/**
 * Recursively flattens a DOM node tree
 * @param node - The CDP DOM node
 * @param nodes - Array to accumulate flattened nodes
 */
function flattenNode(node: any, nodes: DomNode[]): void {
  // Create flattened node entry
  const flatNode: DomNode = {
    nodeId: node.nodeId,
    nodeName: node.nodeName,
    nodeType: node.nodeType,
    nodeValue: node.nodeValue,
    childNodeIds: node.children ? node.children.map((c: any) => c.nodeId) : undefined,
  };

  // Extract attributes if present
  if (node.attributes && node.attributes.length > 0) {
    flatNode.attributes = {};
    for (let i = 0; i < node.attributes.length; i += 2) {
      const key = node.attributes[i];
      const value = node.attributes[i + 1];
      flatNode.attributes[key] = value;
    }
  }

  nodes.push(flatNode);

  // Recursively process children
  if (node.children) {
    for (const child of node.children) {
      flattenNode(child, nodes);
    }
  }
}

/**
 * MCP tool implementation for getting a DOM snapshot
 * Returns a flattened node tree with node IDs, names, attributes, and child relationships
 */
export async function getDomSnapshot(params: GetDomSnapshotParams): Promise<GetDomSnapshotResult> {
  const manager = getConnectionManager();

  // Check if connected
  if (!manager.isConnected()) {
    throw new Error("Not connected to a browser. Please connect first using the connect_browser tool.");
  }

  try {
    log.info(`Getting DOM snapshot (depth: ${params.depth ?? -1}, selector: ${params.selector || "none"})`);

    // Get the document root
    const depth = params.depth ?? -1; // -1 means full depth
    const result = await manager.sendCommand("DOM", "getDocument", { depth, pierce: true });

    if (!result || !result.root) {
      throw new Error("Failed to get DOM document");
    }

    log.debug(`Got DOM root: ${result.root.nodeName}`);

    // Flatten the node tree
    const nodes: DomNode[] = [];
    flattenNode(result.root, nodes);

    log.info(`Flattened ${nodes.length} nodes`);

    // If selector is provided, filter nodes
    if (params.selector) {
      log.info(`Filtering by selector: ${params.selector}`);
      
      // Use querySelector to find matching nodes
      try {
        // Query from the document root
        const queryResult = await manager.sendCommand("DOM", "querySelector", {
          nodeId: result.root.nodeId,
          selector: params.selector,
        });

        if (queryResult && queryResult.nodeId) {
          // Find the matched node and its descendants in our flattened list
          const matchedNodeId = queryResult.nodeId;
          const matchedNode = nodes.find(n => n.nodeId === matchedNodeId);
          
          if (matchedNode) {
            // Filter to include the matched node and all its descendants
            const descendantIds = new Set<number>([matchedNodeId]);
            
            // Recursively collect all descendant IDs
            function collectDescendants(nodeId: number): void {
              const node = nodes.find(n => n.nodeId === nodeId);
              if (node && node.childNodeIds) {
                for (const childId of node.childNodeIds) {
                  descendantIds.add(childId);
                  collectDescendants(childId);
                }
              }
            }
            
            collectDescendants(matchedNodeId);
            
            // Filter nodes to only include the matched subtree
            const filteredNodes = nodes.filter(n => descendantIds.has(n.nodeId));
            log.info(`Filtered to ${filteredNodes.length} nodes matching selector`);
            
            return { nodes: filteredNodes };
          } else {
            log.warn(`Node with ID ${matchedNodeId} not found in flattened tree`);
          }
        } else {
          log.warn(`No nodes found matching selector: ${params.selector}`);
          return { nodes: [] };
        }
      } catch (error: any) {
        log.error(`Error querying selector: ${error.message}`);
        throw new Error(`Failed to query selector "${params.selector}": ${error.message}`);
      }
    }

    return { nodes };
  } catch (error: any) {
    log.error(`Failed to get DOM snapshot: ${error.message}`);
    throw error;
  }
}
