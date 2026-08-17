import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { createLogger } from "./logger.js";
import { compareCohtmlVersions, extractCohtmlVersion, MIN_RECOMMENDED_COHTML_VERSION } from "./connection-manager.js";

const log = createLogger("BrowserLauncher");

export interface BrowserLaunchOptions {
  executablePath: string;
  args?: string[];
  url?: string;
  port?: number;
  timeout?: number; // Timeout in milliseconds to wait for debugger ready (default: 20000)
}

export interface BrowserInstance {
  process: ChildProcess;
  port: number;
  pid: number | undefined;
  cohtmlVersion?: string;
  versionWarning?: string;
}

/**
 * Manages browser process lifecycle for Chrome DevTools Protocol access
 */
export class BrowserLauncher extends EventEmitter {
  private browserProcess: ChildProcess | null = null;
  private debuggingPort: number = 9444;

  constructor() {
    super();
    // EventEmitter throws (crashing the whole process) if "error" is ever
    // emitted with zero listeners attached. Without this, any spawn failure -
    // bad/missing executablePath, permission error, anything child_process
    // reports as an "error" event - takes down the entire MCP server instead
    // of surfacing as a normal failed tool call.
    this.on("error", (error: Error) => {
      log.error(`Unhandled browser process error: ${error.message}`);
    });
  }

  /**
   * Launches a Chromium-based browser with remote debugging enabled
   * @param options - Launch configuration
   * @returns Browser instance information
   */
  async launch(options: BrowserLaunchOptions): Promise<BrowserInstance> {
    if (this.browserProcess) {
      // Don't trust the tracked handle blindly - if Player was closed
      // manually (task manager, clicking X) rather than via close()/
      // gameface_restart, the "exit" event should normally still fire and
      // null this out, but if anything ever leaves it stale, verify against
      // the actual debug port before refusing to launch a fresh instance.
      const alive = await this.verifyAlive();
      if (alive) {
        throw new Error("Browser is already running. Close it before launching a new instance.");
      }
      log.warn("Tracked browser process appears stale (debug port unresponsive) - cleaning up and relaunching");
      this.browserProcess = null;
    }

    const { executablePath, args = [], url, port = 9444, timeout = 20000 } = options;
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
        // Log all stderr output for debugging
        const message = data.toString().trim();
        log.debug(`[stderr] ${message}`);
      });
    }

    // Race debugger-readiness against an immediate spawn failure, so a bad
    // executablePath (ENOENT, EACCES, etc.) fails fast with a specific
    // message instead of silently waiting out the full timeout only to
    // report the generic "port never became ready".
    const spawnErrorPromise = new Promise<never>((_, reject) => {
      this.browserProcess!.once("error", (error) => {
        reject(new Error(`Failed to spawn browser process: ${error.message}`));
      });
    });

    // Give browser time to start
    const versionInfo = await Promise.race([this.waitForDebuggerReady(port, timeout), spawnErrorPromise]);

    // Only Gameface Player is allowed here - refuse (and kill) anything else,
    // e.g. a plain Chrome/Chromium binary passed as executablePath. Gameface's
    // CDP /json/version reports "Cohtml/<version> (Windows; Native) cohtml/..."
    // in the Browser field.
    const browserId = `${versionInfo.Browser || ""} ${versionInfo["User-Agent"] || ""}`;
    if (!browserId.toLowerCase().includes("cohtml")) {
      log.error(`Refusing to use non-Gameface browser at ${executablePath} (CDP identified as: "${browserId.trim()}")`);
      await this.close();
      throw new Error(
        `${executablePath} does not appear to be Gameface Player (CDP reported "${browserId.trim()}", expected it to mention "cohtml"). Killed the process.`
      );
    }

    log.info(`Browser launched successfully with PID ${pid} on port ${port}`);

    const cohtmlVersion = extractCohtmlVersion(browserId) ?? undefined;
    const versionWarning =
      cohtmlVersion && compareCohtmlVersions(cohtmlVersion, MIN_RECOMMENDED_COHTML_VERSION) < 0
        ? `Cohtml ${cohtmlVersion} is below the recommended floor ${MIN_RECOMMENDED_COHTML_VERSION} - some CDP commands this server depends on may behave differently or be unavailable.`
        : undefined;

    if (versionWarning) {
      log.warn(versionWarning);
    }

    return {
      process: this.browserProcess,
      port,
      pid,
      cohtmlVersion,
      versionWarning,
    };
  }

  /**
   * One-shot check (short timeout, no retries) that the tracked debug port
   * is still responsive - used to tell a genuinely-running browser apart
   * from a stale process handle before refusing to relaunch.
   */
  private async verifyAlive(): Promise<boolean> {
    try {
      const response = await fetch(`http://localhost:${this.debuggingPort}/json/version`, {
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Waits for the browser's debugging port to be ready, returning the
   * /json/version payload once it responds.
   */
  private async waitForDebuggerReady(port: number, timeout: number = 20000): Promise<any> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        // Try to fetch the version endpoint
        const response = await fetch(`http://localhost:${port}/json/version`);
        if (response.ok) {
          return await response.json();
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

      // Cleared in onExit so a clean shutdown can never leave this pending -
      // an uncleared timer would otherwise fire 5s later and misfire against
      // whatever this.browserProcess points to by then (e.g. a subsequent,
      // unrelated launch on this same singleton), even though its actual kill
      // target (the captured `process` local) is by then just a stale,
      // already-exited handle.
      let forceKillTimer: ReturnType<typeof setTimeout>;

      const onExit = () => {
        log.info("Browser process closed successfully");
        clearTimeout(forceKillTimer);
        this.browserProcess = null;
        resolve();
      };

      process.once("exit", onExit);

      // Try graceful shutdown first
      process.kill("SIGTERM");

      // Force kill after 5 seconds if still running
      forceKillTimer = setTimeout(() => {
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
