import { getConnectionManager } from "./connect-browser.js";
import { compareCohtmlVersions, MIN_RECOMMENDED_COHTML_VERSION } from "../connection-manager.js";
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

      const cohtmlVersion = manager.getCohtmlVersion();
      const versionWarning =
        cohtmlVersion && compareCohtmlVersions(cohtmlVersion, MIN_RECOMMENDED_COHTML_VERSION) < 0
          ? `Cohtml ${cohtmlVersion} is below the recommended floor ${MIN_RECOMMENDED_COHTML_VERSION} - some CDP commands this server depends on may behave differently or be unavailable. This is a floor, not a guarantee: even versions at or above it can still have quirks (see assertions.ts/search-dom.ts comments for known ones).`
          : undefined;

      return {
        connected: true,
        message: "Connected to browser",
        cohtmlVersion: cohtmlVersion ?? undefined,
        versionWarning,
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
