import { getConnectionManager } from "./connect-browser.js";
import { SearchDomParams, SearchDomResult, SearchDomNode } from "../types.js";
import { createLogger } from "../logger.js";

const log = createLogger("SearchDom");

/**
 * MCP tool implementation for searching DOM nodes by text content
 * Uses CDP DOM.performSearch and DOM.getSearchResults to find nodes matching a query
 * The search looks for matches in text content, attributes, and element names
 */
export async function searchDom(params: SearchDomParams): Promise<SearchDomResult> {
  const manager = getConnectionManager();

  // Check if connected
  if (!manager.isConnected()) {
    throw new Error("Not connected to a browser. Please connect first using the connect_browser tool.");
  }

  // Validate required parameters
  const { query, includeUserAgentShadowDOM = false, maxResults = 100 } = params;
  
  if (!query || query.trim() === "") {
    throw new Error("'query' parameter is required and cannot be empty");
  }

  let searchId: string | undefined;

  try {
    log.info(`Performing DOM search for query: "${query}" (includeUserAgentShadowDOM: ${includeUserAgentShadowDOM}, maxResults: ${maxResults})`);

    // Step 1: Perform the search to get searchId and result count
    const performSearchResult = await manager.sendCommand("DOM", "performSearch", {
      query,
      includeUserAgentShadowDOM,
    });

    if (!performSearchResult || !performSearchResult.searchId) {
      throw new Error("Failed to perform DOM search - no searchId returned");
    }

    searchId = performSearchResult.searchId;
    const resultCount = performSearchResult.resultCount || 0;

    log.debug(`Search completed: searchId=${searchId}, resultCount=${resultCount}`);

    // If no results found, return early
    if (resultCount === 0) {
      log.info("No results found");
      return {
        resultCount: 0,
        nodes: [],
      };
    }

    // Step 2: Get the search results (nodeIds) - limit to maxResults
    const toIndex = Math.min(resultCount, maxResults);
    const getResultsResponse = await manager.sendCommand("DOM", "getSearchResults", {
      searchId,
      fromIndex: 0,
      toIndex,
    });

    if (!getResultsResponse || !getResultsResponse.nodeIds) {
      throw new Error("Failed to get search results - no nodeIds returned");
    }

    const nodeIds = getResultsResponse.nodeIds;
    log.info(`Retrieved ${nodeIds} nodes`);

    // Step 3: Get details for each matched node
    const nodes: SearchDomNode[] = [];
    
    for (const nodeId of nodeIds) {
      try {
        // Use DOM.describeNode to get node details
        const describeResult = await manager.sendCommand("DOM", "describeNode", {
          'nodeId': nodeId,
        });

        if (describeResult && describeResult.node) {
          const node = describeResult.node;
          
          // Extract attributes if present
          const attributes: Record<string, string> = {};
          if (node.attributes && node.attributes.length > 0) {
            for (let i = 0; i < node.attributes.length; i += 2) {
              const key = node.attributes[i];
              const value = node.attributes[i + 1];
              attributes[key] = value;
            }
          }

          nodes.push({
            nodeId: node.nodeId,
            nodeName: node.nodeName,
            nodeType: node.nodeType,
            attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
          });
        }
      } catch (error: any) {
        log.warn(`Failed to describe node ${nodeId}: ${error.message}`);
        // Continue with other nodes even if one fails
      }
    }

    log.info(`Successfully retrieved details for ${nodes.length} nodes out of ${resultCount} total results`);

    return {
      resultCount,
      nodes,
    };

  } catch (error: any) {
    log.error(`Failed to search DOM: ${error.message}`);
    throw error;
  } finally {
    // Step 4: Always clean up the search results
    if (searchId) {
      try {
        await manager.sendCommand("DOM", "discardSearchResults", { searchId });
        log.debug(`Discarded search results for searchId=${searchId}`);
      } catch (error: any) {
        log.warn(`Failed to discard search results: ${error.message}`);
      }
    }
  }
}
