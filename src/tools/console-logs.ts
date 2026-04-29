import { GetConsoleLogsParams, GetConsoleLogsResult } from "../types.js";
import { getConnectionManager } from "./connect-browser.js";
import { createLogger } from "../logger.js";

const log = createLogger("ConsoleLogsTool");

/**
 * Gets buffered console logs from the active browser connection
 */
export async function getConsoleLogs(params: GetConsoleLogsParams): Promise<GetConsoleLogsResult> {
  const connectionManager = getConnectionManager();
  
  if (!connectionManager.isConnected()) {
    throw new Error("No active browser connection. Use connect_browser tool first.");
  }

  const clear = params.clear ?? false;
  const filterLevel = params.filterLevel;

  log.info(`Getting console logs (clear: ${clear}, filterLevel: ${filterLevel || "none"})`);

  try {
    // Get messages from connection manager
    const messages = connectionManager.getConsoleMessages(clear, filterLevel);

    log.info(`Retrieved ${messages.length} console message(s)`);

    return {
      logs: messages,
    };
  } catch (error) {
    log.error(`Failed to get console logs: ${error}`);
    throw new Error(`Failed to get console logs: ${error}`);
  }
}
