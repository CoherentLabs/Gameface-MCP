#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { launchBrowser, closeBrowser } from "./tools/launch-browser.js";
import { connectBrowser, disconnectBrowser } from "./tools/connect-browser.js";
import { getConsoleLogs } from "./tools/console-logs.js";
import { logger } from "./logger.js";
import { parseArgs, setConfig, getConfig } from "./config.js";

// Create server instance
const mcpServer = new McpServer(
  {
    name: "chrome-cdp-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Use centralized logger (writes to stderr, stdout is reserved for MCP protocol)
const log = logger.child("Main");

// Register MCP tools
function registerTools() {
  const config = getConfig();

  // Launch Browser tool
  mcpServer.registerTool(
    "launch_browser",
    {
      description: "Launches a Chromium-based browser with remote debugging enabled",
      inputSchema: z.object({
        executablePath: z.string().optional().describe("Path to the browser executable (uses CLI --browser-executable if not specified)"),
        args: z.array(z.string()).optional().describe("Additional command-line arguments (merged with CLI --browser-args)"),
        url: z.string().optional().describe("Initial URL to navigate to"),
        port: z.number().optional().describe("Remote debugging port (uses CLI --port if not specified)"),
      }),
    },
    async (params) => {
      // Merge CLI config with tool parameters
      const executablePath = params.executablePath || config.browserExecutable;
      if (!executablePath) {
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify({
              success: false,
              message: "executablePath is required. Provide it in the tool call or via --browser-executable CLI option."
            }, null, 2)
          }],
          isError: true,
        };
      }

      const mergedParams = {
        executablePath,
        args: [...config.browserArgs, ...(params.args || [])],
        url: params.url,
        port: params.port || config.port,
      };

      log.info(`Launching browser: ${mergedParams.executablePath}`);
      const result = await launchBrowser(mergedParams);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: !result.success,
      };
    }
  );

  // Connect Browser tool
  mcpServer.registerTool(
    "connect_browser",
    {
      description: "Connects to a running browser via Chrome DevTools Protocol",
      inputSchema: z.object({
        port: z.number().optional().describe("Remote debugging port (uses CLI --port if not specified)"),
        host: z.string().optional().describe("Host address (uses CLI --cdp-host if not specified)"),
        targetId: z.string().optional().describe("Specific target ID to connect to (optional)"),
      }),
    },
    async (params) => {
      // Merge CLI config with tool parameters
      const mergedParams = {
        port: params.port || config.port,
        host: params.host || config.cdpHost,
        targetId: params.targetId,
      };

      log.info(`Connecting to browser at ${mergedParams.host}:${mergedParams.port}`);
      const result = await connectBrowser(mergedParams);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: !result.success,
      };
    }
  );

  // Get Console Logs tool
  mcpServer.registerTool(
    "get_console_logs",
    {
      description: "Retrieves buffered console messages from the connected browser",
      inputSchema: z.object({
        clear: z.boolean().optional().describe("Whether to clear the buffer after retrieving (default: false)"),
        filterLevel: z.string().optional().describe("Optional filter by message type (log, error, warning, info, debug, exception)"),
      }),
    },
    async (params) => {
      log.info(`Getting console logs (clear: ${params.clear ?? false}, filterLevel: ${params.filterLevel || "none"})`);
      try {
        const result = await getConsoleLogs(params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: error.message }, null, 2) }],
          isError: true,
        };
      }
    }
  );

  log.info("Tools registered successfully");
}

// Start server with stdio transport
async function main() {
  // Parse command-line arguments (skip first two: node and script path)
  const config = parseArgs(process.argv.slice(2));
  setConfig(config);

  // Log configuration
  log.info("Starting Chrome CDP MCP Server");
  if (config.browserExecutable) {
    log.info(`Default browser: ${config.browserExecutable}`);
  }
  if (config.browserArgs.length > 0) {
    log.info(`Default browser args: ${config.browserArgs.join(", ")}`);
  }
  log.info(`Default port: ${config.port}`);
  log.info(`Default host: ${config.cdpHost}`);
  
  // Register all tools
  registerTools();
  
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  
  log.info("Server started successfully");
}

// Cleanup function
async function cleanup() {
  log.info("Cleaning up resources");
  try {
    await disconnectBrowser();
    await closeBrowser();
  } catch (error: any) {
    log.error(`Error during cleanup: ${error.message}`);
  }
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
  log.info("Received SIGINT, shutting down gracefully");
  await cleanup();
  await mcpServer.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  log.info("Received SIGTERM, shutting down gracefully");
  await cleanup();
  await mcpServer.close();
  process.exit(0);
});

// Run the server
main().catch((error) => {
  log.error(`Fatal error: ${error.message}`);
  logger.error(error.stack || error.toString());
  process.exit(1);
});
