import { getConnectionManager } from "./connect-browser.js";
import { TakeScreenshotParams, TakeScreenshotResult } from "../types.js";
import { createLogger } from "../logger.js";

const log = createLogger("TakeScreenshot");

/**
 * MCP tool implementation for taking screenshots
 * Captures a screenshot of the current page using Page.captureScreenshot
 * Supports viewport screenshots, full page screenshots, and custom clipping areas
 */
export async function takeScreenshot(params: TakeScreenshotParams): Promise<TakeScreenshotResult> {
  const manager = getConnectionManager();

  // Check if connected
  if (!manager.isConnected()) {
    throw new Error("Not connected to a browser. Please connect first using the connect_browser tool.");
  }

  const { fullPage = true, clipArea } = params;

  try {
    log.info(`Taking screenshot (fullPage: ${fullPage})`);

    // Prepare the capture options
    const captureOptions: any = {
      format: "png",
    };

    // Handle full page screenshot
    if (fullPage) {
      log.debug("Getting layout metrics for full page screenshot");
      const metricsResult = await manager.sendCommand("Page", "getLayoutMetrics", {});
      
      if (!metricsResult || !metricsResult.contentSize) {
        throw new Error("Failed to get page layout metrics");
      }

      const { width, height } = metricsResult.contentSize;
      log.debug(`Full page dimensions: ${width}x${height}`);

      captureOptions.clip = {
        x: 0,
        y: 0,
        width,
        height,
        scale: 1,
      };
    }
    // Handle custom clip area
    else if (clipArea) {
      log.debug(`Using custom clip area: ${JSON.stringify(clipArea)}`);
      captureOptions.clip = {
        x: clipArea.x,
        y: clipArea.y,
        width: clipArea.width,
        height: clipArea.height,
        scale: 1,
      };
    }

    // Capture the screenshot
    log.debug(`Capturing screenshot with options: ${JSON.stringify(captureOptions)}`);
    const result = await manager.sendCommand("Page", "captureScreenshot", captureOptions);

    if (!result || !result.data) {
      throw new Error("Failed to capture screenshot - no data returned");
    }

    log.info(`Screenshot captured successfully (size: ${result.data.length} bytes)`);

    return {
      type: "image",
      data: result.data,
      mimeType: "image/png",
    };
  } catch (error: any) {
    log.error(`Failed to take screenshot: ${error.message}`);
    throw error;
  }
}
