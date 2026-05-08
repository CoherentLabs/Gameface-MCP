import { getConnectionManager } from "./connect-browser.js";
import { GamefaceGetStatusParams, GamefaceGetStatusResult } from "../types.js";
import { createLogger } from "../logger.js";

const log = createLogger("GamefaceGetStatus");

/**
 * MCP tool implementation for checking browser connection status
 * Returns whether there is an active connection to a browser
 */
export async function gamefaceGetStatus(params: GamefaceGetStatusParams): Promise<GamefaceGetStatusResult> {
  const manager = getConnectionManager();

  try {
    const connected = manager.isConnected();
    
    if (connected) {
      log.info("Browser connection active");
      
      // Try to get connection details if available
      // Note: connectionOptions is private, so we can only report connected status
      return {
        connected: true,
        message: "Connected to browser",
      };
    } else {
      log.info("No browser connection");
      return {
        connected: false,
        message: "Not connected to any browser",
      };
    }
  } catch (error: any) {
    log.error(`Failed to get status: ${error.message}`);
    throw error;
  }
}
