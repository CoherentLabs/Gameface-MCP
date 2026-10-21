import { getConnectionManager } from "./connect-browser.js";
import { TakeScreenshotParams, TakeScreenshotResult } from "../types.js";
import { createLogger } from "../logger.js";

const log = createLogger("TakeScreenshot");

/**
 * MCP tool implementation for taking screenshots
 * Captures a screenshot of the current page using Page.captureScreenshot,
 * either the whole viewport or a custom clip area inside it.
 *
 * Gameface only captures what is inside the viewport (verified on 3.2.0.2):
 * a clip larger than the viewport comes back cropped to it, a clip entirely
 * outside it is rejected, captureBeyondViewport is "not supported", and
 * Page.getLayoutMetrics returns an empty {} - so a Chrome-style full-page
 * capture isn't possible. fullPage is kept so callers that pass it still work;
 * when the page is larger than the viewport, the result says what was left out.
 */
export async function takeScreenshot(params: TakeScreenshotParams): Promise<TakeScreenshotResult> {
  const manager = getConnectionManager();

  // Check if connected
  if (!manager.isConnected()) {
    throw new Error("Not connected to a browser. Please connect first using the connect_browser tool.");
  }

  const { fullPage = false, clipArea } = params;

  try {
    log.info(`Taking screenshot (${clipArea ? `clip: ${JSON.stringify(clipArea)}` : "viewport"}${fullPage ? ", fullPage requested" : ""})`);

    // Prepare the capture options
    const captureOptions: any = {
      format: "png",
    };

    if (clipArea) {
      captureOptions.clip = {
        x: clipArea.x,
        y: clipArea.y,
        width: clipArea.width,
        height: clipArea.height,
        scale: 1,
      };
    }

    let note: string | undefined;
    if (fullPage && !clipArea) {
      const sizes = await manager.sendCommand("Runtime", "evaluate", {
        expression: `[window.innerWidth, window.innerHeight, document.documentElement.scrollWidth, document.documentElement.scrollHeight]`,
        returnByValue: true,
      });
      const [viewW, viewH, pageW, pageH] = (sizes?.result?.value as number[] | undefined) ?? [];
      if (pageW > viewW || pageH > viewH) {
        note =
          `Gameface can only capture the viewport (${viewW}x${viewH}); the page is ${pageW}x${pageH}, so the part outside the viewport is not in this screenshot. ` +
          `Scroll the content into view (e.g. with eval_js) and take another screenshot to see it.`;
      }
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
      note,
    };
  } catch (error: any) {
    log.error(`Failed to take screenshot: ${error.message}`);
    throw error;
  }
}
