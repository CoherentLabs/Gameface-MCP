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
  transport: "stdio" | "http";
  mcpHost: string;
  mcpPort: number;
  mcpPath: string;
}

interface ConfigFileShape {
  browserExecutable?: string;
  browserArgs?: string[];
  port?: number;
  cdpHost?: string;
  transport?: "stdio" | "http";
  mcpHost?: string;
  mcpPort?: number;
  mcpPath?: string;
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
  transport: "stdio",
  mcpHost: "127.0.0.1",
  mcpPort: 8000,
  mcpPath: "/sse",
};

function parseNumberOption(name: string, value: string | undefined): number {
  if (!value) {
    console.error(`Missing value for ${name}`);
    process.exit(1);
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    console.error(`Invalid numeric value for ${name}: ${value}`);
    process.exit(1);
  }

  return parsed;
}

function normalizeMcpPath(value: string | undefined): string {
  if (!value) {
    console.error("Missing value for --mcp-path");
    process.exit(1);
  }

  if (!value.startsWith("/")) {
    console.error(`Invalid --mcp-path value: ${value}. It must start with '/'.`);
    process.exit(1);
  }

  return value;
}

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
    transport: fileConfig.transport || "stdio",
    mcpHost: fileConfig.mcpHost || "127.0.0.1",
    mcpPort: fileConfig.mcpPort ?? 8000,
    mcpPath: normalizeMcpPath(fileConfig.mcpPath || "/sse"),
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
        config.port = parseNumberOption(arg, args[++i]);
        break;

      case "--cdp-host":
      case "-h":
        config.cdpHost = args[++i];
        break;

      case "--transport": {
        const value = args[++i];
        if (value !== "stdio" && value !== "http") {
          console.error(`Invalid --transport value: ${value}. Expected 'stdio' or 'http'.`);
          process.exit(1);
        }
        config.transport = value;
        break;
      }

      case "--mcp-host":
        config.mcpHost = args[++i];
        if (!config.mcpHost) {
          console.error("Missing value for --mcp-host");
          process.exit(1);
        }
        break;

      case "--mcp-port": {
        const parsedPort = parseNumberOption(arg, args[++i]);
        if (parsedPort < 1 || parsedPort > 65535) {
          console.error(`Invalid --mcp-port value: ${parsedPort}. Expected 1-65535.`);
          process.exit(1);
        }
        config.mcpPort = parsedPort;
        break;
      }

      case "--mcp-path":
        config.mcpPath = normalizeMcpPath(args[++i]);
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
Gameface MCP Server - Command Line Options

Usage: gameface-mcp [options]

Options:
  --transport <stdio|http>          MCP transport mode
                                     Default: stdio

  --mcp-host <host>                 MCP HTTP listen host (only for --transport http)
                                     Default: 127.0.0.1

  --mcp-port <port>                 MCP HTTP listen port (only for --transport http)
                                     Default: 8000

  --mcp-path <path>                 MCP HTTP endpoint path (only for --transport http)
                                     Default: /sse

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
      "cdpHost": "localhost",
      "transport": "stdio",
      "mcpHost": "127.0.0.1",
      "mcpPort": 8000,
      "mcpPath": "/sse"
    }

  The file and every field in it are optional.

Examples:
  # Use default Chrome location
  gameface-mcp --browser-executable "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"

  # Launch with custom args and port
  gameface-mcp -b chrome.exe -a "--headless=new,--disable-gpu" -p 9223

  # Connect to existing browser on custom port
  gameface-mcp -p 9223

  # Run MCP server over HTTP
  gameface-mcp --transport http --mcp-host 127.0.0.1 --mcp-port 8000 --mcp-path /sse

  # Rely entirely on ~/.gameface-mcp/config.json - no CLI flags needed
  gameface-mcp

Notes:
  - stdout is reserved for MCP protocol communication
  - All logs are written to stderr
  - Default MCP transport is stdio; set --transport http to use an HTTP endpoint
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
