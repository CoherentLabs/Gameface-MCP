/**
 * Centralized logging utility that writes to stderr
 * (stdout is reserved for MCP protocol)
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LoggerOptions {
  prefix?: string;
  level?: LogLevel;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private minLevel: LogLevel = "info";

  /**
   * Sets the minimum log level
   */
  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /**
   * Checks if a log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.minLevel];
  }

  /**
   * Formats a log message with timestamp and level
   */
  private format(level: LogLevel, prefix: string, message: string): string {
    const timestamp = new Date().toISOString();
    const levelStr = level.toUpperCase().padEnd(5);
    const prefixStr = prefix ? `[${prefix}] ` : "";
    return `[${timestamp}] [${levelStr}] ${prefixStr}${message}`;
  }

  /**
   * Writes a log message to stderr
   */
  private write(level: LogLevel, prefix: string, message: string): void {
    if (!this.shouldLog(level)) {
      return;
    }
    const formatted = this.format(level, prefix, message);
    process.stderr.write(formatted + "\n");
  }

  /**
   * Log a debug message
   */
  debug(message: string, prefix = ""): void {
    this.write("debug", prefix, message);
  }

  /**
   * Log an info message
   */
  info(message: string, prefix = ""): void {
    this.write("info", prefix, message);
  }

  /**
   * Log a warning message
   */
  warn(message: string, prefix = ""): void {
    this.write("warn", prefix, message);
  }

  /**
   * Log an error message
   */
  error(message: string, prefix = ""): void {
    this.write("error", prefix, message);
  }

  /**
   * Creates a child logger with a prefix
   */
  child(prefix: string): ChildLogger {
    return new ChildLogger(this, prefix);
  }
}

/**
 * Child logger with a fixed prefix
 */
class ChildLogger {
  constructor(
    private parent: Logger,
    private prefix: string
  ) {}

  debug(message: string): void {
    this.parent.debug(message, this.prefix);
  }

  info(message: string): void {
    this.parent.info(message, this.prefix);
  }

  warn(message: string): void {
    this.parent.warn(message, this.prefix);
  }

  error(message: string): void {
    this.parent.error(message, this.prefix);
  }
}

// Export singleton logger instance
export const logger = new Logger();

// Export factory function for child loggers
export function createLogger(prefix: string): ChildLogger {
  return logger.child(prefix);
}
