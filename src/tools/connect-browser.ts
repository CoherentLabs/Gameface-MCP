import { ConnectionManager } from "../connection-manager.js";
import { ConnectBrowserParams, ConnectBrowserResult } from "../types.js";

// Singleton connection manager instance
let connectionManager: ConnectionManager | null = null;

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

  // Check if already connected
  if (manager.isConnected()) {
    return {
      success: false,
      message: "Already connected to a browser. Disconnect first before connecting again.",
    };
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

    return {
      success: true,
      message: `Connected to browser at ${params.host || "localhost"}:${params.port}`,
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
