import { getConnectionManager } from "./connect-browser.js";
import { NavigateParams, NavigateResult } from "../types.js";
import { createLogger } from "../logger.js";

const log = createLogger("Navigate");

/**
 * MCP tool implementation for navigating to a different URL
 * Uses Page.navigate to load a new URL in the browser
 * Supports optional waitUntil parameter for different load states
 */
export async function navigate(params: NavigateParams): Promise<NavigateResult> {
  const manager = getConnectionManager();

  // Check if connected
  if (!manager.isConnected()) {
    throw new Error("Not connected to a browser. Please connect first using the connect_browser tool.");
  }

  const { url, waitUntil } = params;

  // Validate URL parameter
  if (!url || url.trim() === "") {
    throw new Error("'url' parameter is required and cannot be empty");
  }

  try {
    log.info(`Navigating to: ${url}${waitUntil ? ` (waitUntil: ${waitUntil})` : ""}`);
    
    // If waitUntil is specified, wait for the appropriate event
    let waitPromise: Promise<void> | null = null;
    if (waitUntil) {
      log.debug(`Waiting for ${waitUntil} event`);
      
      if (waitUntil === "documentUpdated") {
        waitPromise = new Promise((resolve) => {
          manager.once("documentUpdated", () => {
            log.debug("Received documentUpdated event");
            resolve();
          });
        }); 
      }
    }
    // Prepare navigation options
    const navigateOptions: any = { url: url };

    // Execute navigation
    const result = await manager.getClient()?.Page.navigate(navigateOptions);

    if (!result) {
      throw new Error("Failed to navigate - no response returned");
    }

    // Check for navigation errors
    if (result.errorText) {
      log.error(`Navigation failed: ${result.errorText}`);
      return {
        success: false,
        url,
        frameId: result.frameId || "",
        loaderId: result.loaderId,
        errorText: result.errorText,
      };
    }

    // Wait for the specified event if waitUntil is provided
    if (waitPromise) {
      await waitPromise;
    }

    log.info(`Successfully navigated to: ${url} (frameId: ${result.frameId})`);

    return {
      success: true,
      url,
      frameId: result.frameId,
      loaderId: result.loaderId,
    };
  } catch (error: any) {
    log.error(`Failed to navigate: ${error.message}`);
    throw error;
  }
}
