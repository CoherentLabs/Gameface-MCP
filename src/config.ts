import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

/**
 * Server configuration, resolved from (lowest to highest precedence):
 * built-in defaults -> user-level config file -> CLI arguments.
 */

export interface ServerConfig {
  browserExecutable?: string;
  browserArgs: string[];
  port: number;
  cdpHost: string;
  /**
   * Where the user's performance budget lives. Unlike the settings above this
   * one is per-project rather than per-machine (a budget describes a UI, not a
   * developer's box), so it defaults to the working directory the server was
   * launched in rather than the home-directory config folder.
   */
  perfBudgetFile?: string;
  /**
   * Other Players the user can pick from at launch (launch_browser's
   * choosePlayer). browserExecutable stays the default for every plain launch.
   */
  players: string[];
}

interface ConfigFileShape {
  browserExecutable?: string;
  browserArgs?: string[];
  port?: number;
  cdpHost?: string;
  perfBudgetFile?: string;
  players?: string[];
}

// One config file per developer machine, not per-project - this server is
// meant to be reused across multiple game repos, so the Player path (which
// differs per machine, not per project) shouldn't have to be re-entered into
// every project's committed mcp.json.
const DEFAULT_CONFIG_PATH = join(homedir(), ".gameface-mcp", "config.json");

// The config file actually in use (--config can point elsewhere), so that
// savePlayerPath() writes back to the same file the settings were read from.
let configPath = DEFAULT_CONFIG_PATH;

// What savePlayerPath() seeds a brand-new config file with - the recommended
// setup from the README, so first-run users get --enable-gui=false without
// having to know about it.
const NEW_CONFIG_FILE_DEFAULTS: ConfigFileShape = {
  browserArgs: ["--enable-gui=false"],
  port: 9444,
  cdpHost: "localhost",
};

// Default configuration
let config: ServerConfig = {
  browserExecutable: undefined,
  browserArgs: [],
  port: 9444,
  cdpHost: "localhost",
  players: [],
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
  configPath = findConfigFlag(args) || DEFAULT_CONFIG_PATH;
  const fileConfig = loadConfigFile(configPath);

  const config: ServerConfig = {
    browserExecutable: fileConfig.browserExecutable,
    browserArgs: fileConfig.browserArgs || [],
    port: fileConfig.port ?? 9444,
    cdpHost: fileConfig.cdpHost || "localhost",
    perfBudgetFile: fileConfig.perfBudgetFile,
    players: Array.isArray(fileConfig.players) ? fileConfig.players : [],
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

      case "--perf-budget":
        config.perfBudgetFile = args[++i];
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
  -b, --browser-executable <path>   Path to the Gameface Player executable
                                     If not specified, tools require explicit path

  -a, --browser-args <args>         Comma-separated Player arguments
                                     Example: "--enable-gui=false"
                                     Default: none
  
  -p, --port <port>                 Remote debugging port
                                     Default: 9444
  
  -h, --cdp-host <host>             Host for CDP connection
                                     Default: localhost

  -c, --config <path>               Path to a JSON config file (see below)
                                     Default: ~/.gameface-mcp/config.json

      --perf-budget <path>          Path to this project's performance budget
                                     Default: ./gameface-perf-budget.json

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
  # Point at a specific Player build
  gameface-mcp --browser-executable "D:\\path\\to\\sdk\\Player\\Player.exe"

  # Launch with custom args and port
  gameface-mcp -b Player.exe -a "--enable-gui=false" -p 9223

  # Connect to an already-running Player on a custom port
  gameface-mcp -p 9223

  # Rely entirely on ~/.gameface-mcp/config.json - no CLI flags needed
  gameface-mcp

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

/**
 * Gets the path of the config file in use
 */
export function getConfigPath(): string {
  return configPath;
}

/**
 * Read-modify-write of the config file in use, keeping every field `update`
 * doesn't touch. A missing file is created from NEW_CONFIG_FILE_DEFAULTS.
 */
function updateConfigFile(update: (fileConfig: ConfigFileShape) => void): void {
  let fileConfig: ConfigFileShape;
  let isNewFile = false;
  try {
    fileConfig = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error: any) {
    // A missing file is the normal first-run case. An unparseable one is not:
    // overwriting it would silently drop whatever the user had in it.
    if (error.code !== "ENOENT") {
      throw new Error(`Config file at ${configPath} exists but could not be read (${error.message}). Fix or remove it, then try again.`);
    }
    // browserExecutable first, so a new file reads like the README example.
    fileConfig = { browserExecutable: undefined, ...NEW_CONFIG_FILE_DEFAULTS };
    isNewFile = true;
  }

  update(fileConfig);
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(fileConfig, null, 2) + "\n", "utf8");

  // The server started without this file, so it never read the default args.
  // Apply them now, unless --browser-args already set some.
  if (isNewFile && config.browserArgs.length === 0) {
    config.browserArgs = [...NEW_CONFIG_FILE_DEFAULTS.browserArgs!];
  }
}

/**
 * Persists the Player path to the config file in use, keeping every other
 * field in it, and applies it to the running server. Returns the file written.
 */
export function savePlayerPath(playerPath: string): string {
  updateConfigFile((fileConfig) => {
    fileConfig.browserExecutable = playerPath;
  });
  // Mutate rather than replace: registerTools() holds on to this same object,
  // so launch_browser picks the new path up without a restart.
  config.browserExecutable = playerPath;
  return configPath;
}

/**
 * Adds Players to the `players` list in the config file (skipping ones already
 * there) and to the running server. Returns the ones that were new.
 */
export function addPlayers(paths: string[]): string[] {
  const key = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);
  const newOnes = (existing: string[]) => {
    const seen = new Set(existing.map(key));
    return paths.filter((p) => !seen.has(key(p)) && !!seen.add(key(p)));
  };

  let added: string[] = [];
  updateConfigFile((fileConfig) => {
    const existing = Array.isArray(fileConfig.players) ? fileConfig.players : [];
    added = newOnes(existing);
    fileConfig.players = [...existing, ...added];
  });
  config.players = [...config.players, ...newOnes(config.players)];
  return added;
}
