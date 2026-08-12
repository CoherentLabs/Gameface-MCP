import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Server configuration, resolved from (lowest to highest precedence):
 * built-in defaults -> user-level config file -> CLI arguments.
 */

export interface ServerConfig {
  browserExecutable?: string;
  browserArgs: string[];
  port: number;
  cdpHost: string;
}

interface ConfigFileShape {
  browserExecutable?: string;
  browserArgs?: string[];
  port?: number;
  cdpHost?: string;
}

// One config file per developer machine, not per-project - this server is
// meant to be reused across multiple game repos, so the Player path (which
// differs per machine, not per project) shouldn't have to be re-entered into
// every project's committed mcp.json.
const DEFAULT_CONFIG_PATH = join(homedir(), ".gameface-mcp", "config.json");

// Default configuration
let config: ServerConfig = {
  browserExecutable: undefined,
  browserArgs: [],
  port: 9444,
  cdpHost: "localhost",
};

function findConfigFlag(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--config" || args[i] === "-c") {
      return args[i + 1];
    }
  }
  return undefined;
}

function loadConfigFile(configPath: string): ConfigFileShape {
  try {
    const raw = readFileSync(configPath, "utf8");
    return JSON.parse(raw);
  } catch (error: any) {
    if (error.code === "ENOENT") {
      // Optional file - not finding one at the default location is normal,
      // not an error (most CLI-only setups will never have one).
      return {};
    }
    console.error(`Warning: failed to read/parse config file at ${configPath}: ${error.message}`);
    return {};
  }
}

/**
 * Parses command-line arguments and returns configuration, seeded from the
 * user-level config file (--config to override its location) and then
 * overridden by any CLI flags actually passed.
 */
export function parseArgs(args: string[]): ServerConfig {
  const configPath = findConfigFlag(args) || DEFAULT_CONFIG_PATH;
  const fileConfig = loadConfigFile(configPath);

  const config: ServerConfig = {
    browserExecutable: fileConfig.browserExecutable,
    browserArgs: fileConfig.browserArgs || [],
    port: fileConfig.port ?? 9444,
    cdpHost: fileConfig.cdpHost || "localhost",
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

      case "--config":
      case "-c":
        i++; // value already consumed by findConfigFlag() above
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

  -c, --config <path>               Path to a JSON config file (see below)
                                     Default: ~/.gameface-mcp/config.json

  --help                            Show this help message

Config file:
  Any of the above (except --config itself) can instead be set once in a
  JSON file at ~/.gameface-mcp/config.json (one per developer machine, not
  per project - useful since this server is typically reused across
  multiple game repos, so a project's own mcp.json never needs to hardcode
  a machine-specific path). CLI flags always override the config file.

    {
      "browserExecutable": "D:/path/to/Player.exe",
      "browserArgs": ["--enable-gui=false"],
      "port": 9444,
      "cdpHost": "localhost"
    }

  The file and every field in it are optional.

Examples:
  # Use default Chrome location
  chrome-cdp-mcp --browser-executable "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"

  # Launch with custom args and port
  chrome-cdp-mcp -b chrome.exe -a "--headless=new,--disable-gpu" -p 9223

  # Connect to existing browser on custom port
  chrome-cdp-mcp -p 9223

  # Rely entirely on ~/.gameface-mcp/config.json - no CLI flags needed
  chrome-cdp-mcp

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
