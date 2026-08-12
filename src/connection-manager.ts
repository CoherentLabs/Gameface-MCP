import CDP from "chrome-remote-interface";
import { EventEmitter } from "events";
import { createLogger } from "./logger.js";
import { ConsoleMessage, LogEntry } from "./types.js";

const log = createLogger("ConnectionManager");

export interface ConnectionOptions {
  host?: string;
  port: number;
  target?: string | ((targets: CDP.Target[]) => CDP.Target);
}

/**
 * Manages persistent Chrome DevTools Protocol connection
 */
export class ConnectionManager extends EventEmitter {
  private client: CDP.Client | null = null;
  private connected: boolean = false;
  private connectionOptions: ConnectionOptions | null = null;

  /**
   * Establishes a connection to Chrome DevTools Protocol
   * @param options - Connection configuration
   */
  async connect(options: ConnectionOptions): Promise<void> {
    if (this.connected) {
      throw new Error("Already connected. Disconnect before connecting again.");
    }

    this.connectionOptions = options;

    const host = options.host || "localhost";
    const port = options.port;

    log.info(`Connecting to Chrome DevTools Protocol at ${host}:${port}`);

    try {
      // Gameface's CDP HTTP endpoint (/json, /json/list) echoes the request
      // path into webSocketDebuggerUrl (e.g. "ws://host:port/json/list/devtools/page/0"
      // instead of ".../devtools/page/0"). chrome-remote-interface's target
      // resolution trusts that field verbatim for string-id, object, and
      // function targets, so it picks a broken URL against a real Gameface
      // Player. Resolve the target ourselves and pass a relative path
      // ("/devtools/page/<id>") instead - chrome-remote-interface turns that
      // into a raw WS URL without re-fetching/trusting the broken field.
      let target: string | undefined = typeof options.target === "string" ? options.target : undefined;

      if (typeof options.target === "function") {
        const res = await fetch(`http://${host}:${port}/json/list`);
        const targets: CDP.Target[] = await res.json();
        const chosen = options.target(targets);
        target = `/devtools/page/${chosen.id}`;
      }

      // Connect to CDP
      this.client = await CDP({
        host,
        port,
        local: true,
        target,
      });

      log.info("Connected successfully");

      // Enable required domains (Runtime is needed for the identity check below)
      await this.enableDomains();

      // Only Gameface Player is allowed here - refuse anything else, e.g. a
      // plain Chrome/Chromium tab someone started outside launch_browser and
      // pointed this at directly. Gameface's navigator.userAgent reports
      // "Cohtml/<version> (Windows; Native) cohtml/...".
      const uaResult = await this.client.Runtime.evaluate({ expression: "navigator.userAgent", returnByValue: true });
      const userAgent = String(uaResult.result?.value || "");
      if (!userAgent.toLowerCase().includes("cohtml")) {
        log.error(`Refusing non-Gameface target (navigator.userAgent: "${userAgent}")`);
        await this.client.close();
        this.client = null;
        throw new Error(
          `Target at ${host}:${port} does not appear to be Gameface Player (navigator.userAgent: "${userAgent}", expected it to mention "cohtml").`
        );
      }

      this.connected = true;

      // Set up event handlers
      this.setupEventHandlers();

      this.emit("connected");
    } catch (error) {
      log.error(`Connection failed: ${error}`);
      this.connected = false;
      throw new Error(`Connection failed: ${error}`);
    }
  }

  /**
   * Enables required CDP domains
   */
  private async enableDomains(): Promise<void> {
    if (!this.client) {
      throw new Error("Not connected");
    }

    log.info("Enabling CDP domains");

    const { Page, Runtime, DOM, CSS, Log } = this.client;

    try {
      // Enable domains in sequence
      await Page.enable();
      log.info("Page domain enabled");

      await Runtime.enable();
      log.info("Runtime domain enabled");

      await DOM.enable();
      log.info("DOM domain enabled");

      await CSS.enable();
      log.info("CSS domain enabled");

      await Log.enable();
      log.info("Log domain enabled");
    } catch (error) {
      log.error(`Failed to enable domains: ${error}`);
      throw error;
    }
  }

  /**
   * Sets up event handlers for CDP events
   */
  private setupEventHandlers(): void {
    if (!this.client) {
      return;
    }

    const { Runtime, Log, DOM } = this.client;

    DOM.documentUpdated(() => {
      log.debug("Document updated");
      this.emit("documentUpdated");
    });

    // Console API called (console.log, console.error, etc.)
    Runtime.consoleAPICalled((params: any) => {
      const message: ConsoleMessage = {
        type: params.type,
        args: params.args,
        timestamp: params.timestamp,
        stackTrace: params.stackTrace,
      };
      this.emit("console", message);
    });

    // Exception thrown
    Runtime.exceptionThrown((params: any) => {
      const message: ConsoleMessage = {
        type: "exception",
        args: [params.exceptionDetails],
        timestamp: params.timestamp,
        stackTrace: params.exceptionDetails.stackTrace,
      };
      this.emit("exception", message);
    });

    // Log domain entries (browser warnings, network errors, security issues, etc.)
    Log.entryAdded((params: any) => {
      const entry: LogEntry = params.entry;
      this.emit("logEntry", entry);
    });

    // Handle disconnection
    this.client.on("disconnect", () => {
      log.warn("Disconnected from CDP");
      this.connected = false;
      this.client = null;
      this.emit("disconnected");
    });
  }

  /**
   * Executes a CDP command
   */
  async sendCommand(domain: string, method: string, params?: any): Promise<any> {
    if (!this.client) {
      throw new Error("Not connected");
    }

    const fullMethod = `${domain}.${method}`;
    log.debug(`Executing CDP command: ${fullMethod}`);

    try {
      // Access the domain dynamically
      const domainObj = (this.client as any)[domain];
      if (!domainObj || typeof domainObj[method] !== "function") {
        throw new Error(`Unknown CDP command: ${fullMethod}`);
      }

      const result = await domainObj[method](params);
      return result;
    } catch (error) {
      log.error(`Command failed: ${fullMethod} - ${error}`);
      throw error;
    }
  }

  /**
   * Disconnects from CDP
   */
  async disconnect(): Promise<void> {
    if (!this.client) {
      log.warn("Not connected");
      return;
    }

    log.info("Disconnecting from CDP");

    try {
      await this.client.close();
    } catch (error) {
      log.error(`Error during disconnect: ${error}`);
    } finally {
      this.client = null;
      this.connected = false;
    }
  }

  /**
   * Performs a connection health check
   */
  async healthCheck(): Promise<boolean> {
    if (!this.connected || !this.client) {
      return false;
    }

    try {
      // Try a simple CDP command
      await this.client.Runtime.evaluate({ expression: "1+1" });
      return true;
    } catch (error) {
      log.error(`Health check failed: ${error}`);
      return false;
    }
  }

  /**
   * Attempts to reconnect using the previous connection options
   */
  async reconnect(): Promise<void> {
    if (!this.connectionOptions) {
      throw new Error("No previous connection options available");
    }

    log.info("Attempting to reconnect");

    // Disconnect if still connected
    if (this.connected) {
      await this.disconnect();
    }

    // Wait a bit before reconnecting
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Reconnect with same options
    await this.connect(this.connectionOptions);
  }

  /**
   * Returns connection status
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Gets the CDP client instance (for advanced operations)
   */
  getClient(): CDP.Client | null {
    return this.client;
  }
}
