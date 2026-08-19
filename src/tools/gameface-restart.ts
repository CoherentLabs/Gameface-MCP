import { launchBrowser, closeBrowser, getLastLaunchParams } from "./launch-browser.js";
import { connectBrowser, disconnectBrowser, getLastConnectParams } from "./connect-browser.js";
import { GamefaceRestartParams, GamefaceRestartResult } from "../types.js";
import { createLogger } from "../logger.js";

const log = createLogger("GamefaceRestart");

/**
 * MCP tool implementation for restarting the browser
 * Closes the current browser, disconnects, relaunches with the same parameters, and reconnects
 */
export async function gamefaceRestart(params: GamefaceRestartParams): Promise<GamefaceRestartResult> {
  try {
    log.info("Starting browser restart process");

    // Get stored launch and connection parameters
    const launchParams = getLastLaunchParams();
    const connectParams = getLastConnectParams();

    if (!launchParams) {
      throw new Error("No previous browser launch detected. Launch a browser first before restarting.");
    }

    if (!connectParams) {
      throw new Error("No previous browser connection detected. Connect to a browser first before restarting.");
    }

    // Step 1: Disconnect from the current browser
    log.info("Disconnecting from current browser");
    await disconnectBrowser();

    // Step 2: Close the current browser
    log.info("Closing current browser");
    await closeBrowser();

    // Wait a moment for cleanup
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Step 3: Relaunch the browser with the same parameters
    log.info("Relaunching browser");
    const launchResult = await launchBrowser(launchParams);

    if (!launchResult.success) {
      throw new Error(`Failed to relaunch browser: ${launchResult.message}`);
    }

    // Wait a moment for browser to stabilize
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Step 4: Reconnect to the browser
    log.info("Reconnecting to browser");
    const connectResult = await connectBrowser(connectParams);

    if (!connectResult.success) {
      throw new Error(`Failed to reconnect to browser: ${connectResult.message}`);
    }

    log.info("Browser restart completed successfully");

    return {
      success: true,
      message: `Browser restarted successfully on port ${launchResult.port}`,
      port: launchResult.port,
      pid: launchResult.pid,
    };
  } catch (error: any) {
    log.error(`Failed to restart browser: ${error.message}`);
    return {
      success: false,
      message: `Failed to restart browser: ${error.message}`,
    };
  }
}
