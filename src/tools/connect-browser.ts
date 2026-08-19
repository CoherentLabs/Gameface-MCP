import { ConnectionManager, compareCohtmlVersions, MIN_RECOMMENDED_COHTML_VERSION } from "../connection-manager.js";
import { ConnectBrowserParams, ConnectBrowserResult } from "../types.js";
import { createLogger } from "../logger.js";

const log = createLogger("ConnectBrowser");

// Singleton connection manager instance
let connectionManager: ConnectionManager | null = null;

// Store last connection parameters for restart functionality
let lastConnectParams: ConnectBrowserParams | null = null;

/**
 * Gets or creates the connection manager instance
 */
export function getConnectionManager(): ConnectionManager {
  if (!connectionManager) {
    connectionManager = new ConnectionManager();
  }
  return connectionManager;
}

/**
 * MCP tool implementation for connecting to a browser via CDP
 */
export async function connectBrowser(params: ConnectBrowserParams): Promise<ConnectBrowserResult> {
  const manager = getConnectionManager();

  // Check if already connected - but don't trust the cached flag blindly.
  // If Player was closed manually (not via disconnect_browser/gameface_restart),
  // the underlying WebSocket may not report a clean "disconnect" for a long
  // time (or ever, if nothing was actively using it), leaving `connected`
  // stuck true against a connection that's actually dead. Actively verify
  // before refusing to reconnect, and self-heal if it's stale.
  if (manager.isConnected()) {
    const alive = await manager.healthCheck();
    if (alive) {
      return {
        success: false,
        message: "Already connected to a browser. Disconnect first before connecting again.",
      };
    }
    log.warn("Cached connection state was stale (health check failed) - resetting and reconnecting");
    await manager.disconnect();
  }

  try {
    // Set up target selection
    let target: any = undefined;
    if (params.targetId) {
      // Connect to specific target by ID
      target = (targets: any[]) => {
        const found = targets.find((t) => t.id === params.targetId);
        if (!found) {
          throw new Error(`Target with ID ${params.targetId} not found`);
        }
        return found;
      };
    } else {
      // Connect to first page target (default behavior)
      target = (targets: any[]) => {
        const pageTarget = targets.find((t) => t.type === "page");
        if (!pageTarget) {
          throw new Error("No page targets found");
        }
        return pageTarget;
      };
    }

    await manager.connect({
      host: params.host || "localhost",
      port: params.port,
      target,
    });

    // Store connection parameters for restart functionality
    lastConnectParams = params;

    const cohtmlVersion = manager.getCohtmlVersion();
    const versionWarning =
      cohtmlVersion && compareCohtmlVersions(cohtmlVersion, MIN_RECOMMENDED_COHTML_VERSION) < 0
        ? `Cohtml ${cohtmlVersion} is below the recommended floor ${MIN_RECOMMENDED_COHTML_VERSION} - some CDP commands this server depends on may behave differently or be unavailable.`
        : undefined;

    return {
      success: true,
      message: `Connected to browser at ${params.host || "localhost"}:${params.port}`,
      cohtmlVersion: cohtmlVersion ?? undefined,
      versionWarning,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Failed to connect to browser: ${error.message}`,
    };
  }
}

/**
 * Disconnects from the current browser
 */
export async function disconnectBrowser(): Promise<void> {
  if (connectionManager) {
    await connectionManager.disconnect();
  }
}

/**
 * Gets the last connection parameters (for restart functionality)
 */
export function getLastConnectParams(): ConnectBrowserParams | null {
  return lastConnectParams;
}
