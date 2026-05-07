import { GetConsoleLogsParams, GetConsoleLogsResult, ConsoleMessage, LogEntry } from "../types.js";
import { getConnectionManager } from "./connect-browser.js";
import { createLogger } from "../logger.js";

const log = createLogger("ConsoleLogsTool");

// Module-level buffer for console messages and log entries
let consoleBuffer: Array<ConsoleMessage | LogEntry> = [];

// Set up event listeners on the connection manager singleton
const connectionManager = getConnectionManager();

// Listen for console messages
connectionManager.on("console", (message: ConsoleMessage) => {
  consoleBuffer.push(message);
});

// Listen for exceptions
connectionManager.on("exception", (message: ConsoleMessage) => {
  consoleBuffer.push(message);
});

// Listen for Log domain entries
connectionManager.on("logEntry", (entry: LogEntry) => {
  consoleBuffer.push(entry);
});

// Clear buffer on disconnect
connectionManager.on("disconnected", () => {
  log.info("Connection disconnected, clearing console buffer");
  consoleBuffer = [];
});

/**
 * Gets buffered console logs from the active browser connection
 */
export async function getConsoleLogs(params: GetConsoleLogsParams): Promise<GetConsoleLogsResult> {
  if (!connectionManager.isConnected()) {
    throw new Error("No active browser connection. Use connect_browser tool first.");
  }

  const clear = params.clear ?? false;
  const filterLevel = params.filterLevel;

  log.info(`Getting console logs (clear: ${clear}, filterLevel: ${filterLevel || "none"})`);

  try {
    // Filter messages if filterLevel is specified
    let messages = consoleBuffer;
    if (filterLevel) {
      messages = messages.filter((msg) => {
        // Check ConsoleMessage.type or LogEntry.level
        if ('type' in msg) {
          return msg.type === filterLevel;
        } else if ('level' in msg) {
          return msg.level === filterLevel;
        }
        return false;
      });
    }

    // Create a copy to return
    const result = [...messages];

    // Clear buffer if requested
    if (clear) {
      consoleBuffer = [];
      log.info("Console buffer cleared");
    }

    log.info(`Retrieved ${result.length} console message(s)`);

    return {
      logs: result,
    };
  } catch (error) {
    log.error(`Failed to get console logs: ${error}`);
    throw new Error(`Failed to get console logs: ${error}`);
  }
}
