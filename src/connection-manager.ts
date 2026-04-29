import CDP from "chrome-remote-interface";
import { EventEmitter } from "events";
import { createLogger } from "./logger.js";

const log = createLogger("ConnectionManager");

export interface ConnectionOptions {
  host?: string;
  port: number;
  target?: string | ((targets: CDP.Target[]) => CDP.Target);
}

export interface ConsoleMessage {
  type: string;
  args: any[];
  timestamp: number;
  stackTrace?: any;
}

/**
 * Manages persistent Chrome DevTools Protocol connection
 */
export class ConnectionManager extends EventEmitter {
  private client: CDP.Client | null = null;
  private connected: boolean = false;
  private consoleBuffer: ConsoleMessage[] = [];
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

    log.info(`Connecting to Chrome DevTools Protocol at ${options.host || "localhost"}:${options.port}`);

    try {
      // Connect to CDP
      this.client = await CDP({
        host: options.host || "localhost",
        port: options.port,
        local: true,
        target: options.target,
      });

      this.connected = true;
      log.info("Connected successfully");

      // Enable required domains
      await this.enableDomains();

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

    const { Page, Runtime, DOM, CSS } = this.client;

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

    const { Runtime } = this.client;

    // Console API called (console.log, console.error, etc.)
    Runtime.consoleAPICalled((params: any) => {
      const message: ConsoleMessage = {
        type: params.type,
        args: params.args,
        timestamp: params.timestamp,
        stackTrace: params.stackTrace,
      };
      this.consoleBuffer.push(message);
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
      this.consoleBuffer.push(message);
      this.emit("exception", message);
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
   * Gets buffered console messages
   * @param clear - Whether to clear the buffer after retrieving
   * @param filterLevel - Optional filter by message type
   */
  getConsoleMessages(clear: boolean = false, filterLevel?: string): ConsoleMessage[] {
    let messages = this.consoleBuffer;

    if (filterLevel) {
      messages = messages.filter((msg) => msg.type === filterLevel);
    }

    if (clear) {
      this.consoleBuffer = [];
    }

    return messages;
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
      this.consoleBuffer = [];
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
