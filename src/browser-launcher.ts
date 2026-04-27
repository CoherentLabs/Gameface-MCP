import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { createLogger } from "./logger.js";

const log = createLogger("BrowserLauncher");

export interface BrowserLaunchOptions {
  executablePath: string;
  args?: string[];
  url?: string;
  port?: number;
}

export interface BrowserInstance {
  process: ChildProcess;
  port: number;
  pid: number | undefined;
}

/**
 * Manages browser process lifecycle for Chrome DevTools Protocol access
 */
export class BrowserLauncher extends EventEmitter {
  private browserProcess: ChildProcess | null = null;
  private debuggingPort: number = 9444;

  /**
   * Launches a Chromium-based browser with remote debugging enabled
   * @param options - Launch configuration
   * @returns Browser instance information
   */
  async launch(options: BrowserLaunchOptions): Promise<BrowserInstance> {
    if (this.browserProcess) {
      throw new Error("Browser is already running. Close it before launching a new instance.");
    }

    const { executablePath, args = [], url, port = 9444 } = options;
    this.debuggingPort = port;

    // Build arguments for remote debugging
    const browserArgs = [
      `--remote-debugging-port=${port}`,
      "--no-first-run",
      "--no-default-browser-check",
      ...args,
    ];

    // Add URL if provided
    if (url) {
      browserArgs.push(url);
    }

    // Log launch details
    log.info(`Launching browser: ${executablePath}`);
    log.info(`Args: ${browserArgs.join(" ")}`);

    // Spawn the browser process
    this.browserProcess = spawn(executablePath, browserArgs, {
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const pid = this.browserProcess.pid;

    // Handle process events
    this.browserProcess.on("error", (error) => {
      log.error(`Browser process error: ${error.message}`);
      this.emit("error", error);
    });

    this.browserProcess.on("exit", (code, signal) => {
      log.info(`Browser process exited with code ${code}, signal ${signal}`);
      this.browserProcess = null;
      this.emit("exit", code, signal);
    });

    // Capture stdout/stderr for debugging
    if (this.browserProcess.stdout) {
      this.browserProcess.stdout.on("data", (data) => {
        log.debug(`[stdout] ${data.toString().trim()}`);
      });
    }

    if (this.browserProcess.stderr) {
      this.browserProcess.stderr.on("data", (data) => {
        // Browser stderr can be noisy, only log errors
        const message = data.toString().trim();
        if (message.toLowerCase().includes("error")) {
          log.warn(`[stderr] ${message}`);
        }
      });
    }

    // Give browser time to start
    await this.waitForDebuggerReady(port);

    log.info(`Browser launched successfully with PID ${pid} on port ${port}`);

    return {
      process: this.browserProcess,
      port,
      pid,
    };
  }

  /**
   * Waits for the browser's debugging port to be ready
   */
  private async waitForDebuggerReady(port: number, timeout: number = 10000): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        // Try to fetch the version endpoint
        const response = await fetch(`http://localhost:${port}/json/version`);
        if (response.ok) {
          return;
        }
      } catch (error) {
        // Expected to fail while browser is starting up
      }
      
      // Wait 100ms before retrying
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    throw new Error(`Browser debugging port ${port} did not become ready within ${timeout}ms`);
  }

  /**
   * Terminates the browser process
   */
  async close(): Promise<void> {
    if (!this.browserProcess) {
      log.warn("No browser process to close");
      return;
    }

    log.info("Closing browser process");

    return new Promise((resolve) => {
      const process = this.browserProcess!;
      
      const onExit = () => {
        log.info("Browser process closed successfully");
        this.browserProcess = null;
        resolve();
      };

      process.once("exit", onExit);

      // Try graceful shutdown first
      process.kill("SIGTERM");

      // Force kill after 5 seconds if still running
      setTimeout(() => {
        if (this.browserProcess) {
          log.warn("Force killing browser process");
          process.kill("SIGKILL");
        }
      }, 5000);
    });
  }

  /**
   * Returns whether a browser process is currently running
   */
  isRunning(): boolean {
    return this.browserProcess !== null && !this.browserProcess.killed;
  }

  /**
   * Gets the current debugging port
   */
  getPort(): number {
    return this.debuggingPort;
  }
}
