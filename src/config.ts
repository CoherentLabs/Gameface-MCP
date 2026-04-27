/**
 * Server configuration from command-line arguments
 */

export interface ServerConfig {
  browserExecutable?: string;
  browserArgs: string[];
  port: number;
  cdpHost: string;
}

// Default configuration
let config: ServerConfig = {
  browserExecutable: undefined,
  browserArgs: [],
  port: 9444,
  cdpHost: "localhost",
};

/**
 * Parses command-line arguments and returns configuration
 */
export function parseArgs(args: string[]): ServerConfig {
  const config: ServerConfig = {
    browserExecutable: undefined,
    browserArgs: [],
    port: 9444,
    cdpHost: "localhost",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--browser-executable":
      case "-b":
        config.browserExecutable = args[++i];
        break;

      case "--browser-args":
      case "-a":
        // Parse comma-separated or space-separated args
        const argsStr = args[++i];
        config.browserArgs = argsStr.split(",").map((s) => s.trim());
        break;

      case "--port":
      case "-p":
        config.port = parseInt(args[++i], 10);
        break;

      case "--cdp-host":
      case "-h":
        config.cdpHost = args[++i];
        break;

      case "--help":
        printHelp();
        process.exit(0);
        break;

      default:
        if (arg.startsWith("-")) {
          console.error(`Unknown option: ${arg}`);
          printHelp();
          process.exit(1);
        }
        break;
    }
  }

  return config;
}

/**
 * Prints help message
 */
function printHelp(): void {
  console.error(`
Chrome CDP MCP Server - Command Line Options

Usage: chrome-cdp-mcp [options]

Options:
  -b, --browser-executable <path>   Path to browser executable (Chrome, Edge, Brave, etc.)
                                     If not specified, tools require explicit path
  
  -a, --browser-args <args>         Comma-separated browser arguments
                                     Example: "--headless=new,--disable-gpu"
                                     Default: none
  
  -p, --port <port>                 Remote debugging port
                                     Default: 9444
  
  -h, --cdp-host <host>             Host for CDP connection
                                     Default: localhost

  --help                            Show this help message

Examples:
  # Use default Chrome location
  chrome-cdp-mcp --browser-executable "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  
  # Launch with custom args and port
  chrome-cdp-mcp -b chrome.exe -a "--headless=new,--disable-gpu" -p 9223
  
  # Connect to existing browser on custom port
  chrome-cdp-mcp -p 9223

Notes:
  - stdout is reserved for MCP protocol communication
  - All logs are written to stderr
  - Server uses stdio transport for MCP communication
`);
}

/**
 * Sets the global configuration
 */
export function setConfig(newConfig: ServerConfig): void {
  config = newConfig;
}

/**
 * Gets the current configuration
 */
export function getConfig(): ServerConfig {
  return config;
}
