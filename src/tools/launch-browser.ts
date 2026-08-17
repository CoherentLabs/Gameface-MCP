import { BrowserLauncher } from "../browser-launcher.js";
import { LaunchBrowserParams, LaunchBrowserResult } from "../types.js";

// Singleton browser launcher instance
let browserLauncher: BrowserLauncher | null = null;

// Store last launch parameters for restart functionality
let lastLaunchParams: LaunchBrowserParams | null = null;

/**
 * Gets or creates the browser launcher instance
 */
export function getBrowserLauncher(): BrowserLauncher {
  if (!browserLauncher) {
    browserLauncher = new BrowserLauncher();
  }
  return browserLauncher;
}

/**
 * MCP tool implementation for launching a browser
 */
export async function launchBrowser(params: LaunchBrowserParams): Promise<LaunchBrowserResult> {
  const launcher = getBrowserLauncher();

  // Check if browser is already running
  if (launcher.isRunning()) {
    return {
      success: false,
      port: launcher.getPort(),
      message: "Browser is already running. Close it first before launching a new instance.",
    };
  }

  try {
    const instance = await launcher.launch({
      executablePath: params.executablePath,
      args: params.args,
      url: params.url,
      port: params.port || 9444,
    });

    // Store launch parameters for restart functionality
    lastLaunchParams = params;

    return {
      success: true,
      port: instance.port,
      pid: instance.pid,
      message: `Browser launched successfully on port ${instance.port} with PID ${instance.pid}`,
      cohtmlVersion: instance.cohtmlVersion,
      versionWarning: instance.versionWarning,
    };
  } catch (error: any) {
    return {
      success: false,
      port: params.port || 9444,
      message: `Failed to launch browser: ${error.message}`,
    };
  }
}

/**
 * Closes the running browser
 */
export async function closeBrowser(): Promise<void> {
  if (browserLauncher) {
    await browserLauncher.close();
  }
}

/**
 * Gets the last launch parameters (for restart functionality)
 */
export function getLastLaunchParams(): LaunchBrowserParams | null {
  return lastLaunchParams;
}
