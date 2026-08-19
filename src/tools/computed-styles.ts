import { getConnectionManager } from "./connect-browser.js";
import { GetComputedStylesParams, GetComputedStylesResult } from "../types.js";
import { createLogger } from "../logger.js";

const log = createLogger("ComputedStyles");

/**
 * MCP tool implementation for getting computed styles of an element
 * Returns CSS computed styles for a specific node identified by its nodeId
 */
export async function getComputedStyles(params: GetComputedStylesParams): Promise<GetComputedStylesResult> {
  const manager = getConnectionManager();

  // Check if connected
  if (!manager.isConnected()) {
    throw new Error("Not connected to a browser. Please connect first using the connect_browser tool.");
  }

  const { nodeId, propertyNames } = params;

  try {
    log.info(`Getting computed styles for node ${nodeId} (properties: ${propertyNames?.length || "all"})`);

    // Call CSS.getComputedStyleForNode to get all computed styles
    const result = await manager.sendCommand("CSS", "getComputedStyleForNode", { nodeId });

    if (!result || !result.computedStyle) {
      throw new Error(`Failed to get computed styles for node ${nodeId}`);
    }

    log.debug(`Retrieved ${result.computedStyle.length} computed style properties`);

    // Convert the array of style properties to a key-value object
    const allStyles: Record<string, string> = {};
    for (const prop of result.computedStyle) {
      allStyles[prop.name] = prop.value;
    }

    // If specific property names are requested, filter to only those
    if (propertyNames && propertyNames.length > 0) {
      const filteredStyles: Record<string, string> = {};
      for (const propName of propertyNames) {
        if (propName in allStyles) {
          filteredStyles[propName] = allStyles[propName];
        } else {
          log.warn(`Requested property '${propName}' not found in computed styles`);
          // Still include it in the result, but with undefined or empty value
          filteredStyles[propName] = "";
        }
      }
      log.info(`Filtered to ${Object.keys(filteredStyles).length} requested properties`);
      return { styles: filteredStyles };
    }

    // Return all styles
    log.info(`Returning all ${Object.keys(allStyles).length} computed styles`);
    return { styles: allStyles };
  } catch (error: any) {
    log.error(`Failed to get computed styles: ${error.message}`);
    throw error;
  }
}
