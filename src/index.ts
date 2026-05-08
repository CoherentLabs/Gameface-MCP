#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { launchBrowser, closeBrowser } from "./tools/launch-browser.js";
import { connectBrowser, disconnectBrowser } from "./tools/connect-browser.js";
import { getConsoleLogs } from "./tools/console-logs.js";
import { getDomSnapshot } from "./tools/dom-snapshot.js";
import { getComputedStyles } from "./tools/computed-styles.js";
import { interactElement } from "./tools/interact-element.js";
import { takeScreenshot } from "./tools/take-screenshot.js";
import { searchDom } from "./tools/search-dom.js";
import { navigate } from "./tools/navigate.js";
import { evalJs } from "./tools/eval-js.js";
import { gamefaceGetStatus } from "./tools/gameface-get-status.js";
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
      description: "Retrieves buffered console messages and Log domain entries from the connected browser. Includes Runtime console API calls (console.log, console.error, etc.) and browser Log entries (network errors, security warnings, deprecations, etc.)",
      inputSchema: z.object({
        clear: z.boolean().optional().describe("Whether to clear the buffer after retrieving (default: false)"),
        filterLevel: z.string().optional().describe("Optional filter by message type/level. For Runtime console messages: log, error, warning, info, debug, exception. For Log domain entries: verbose, info, warning, error"),
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

  // Get DOM Tree tool
  mcpServer.registerTool(
    "get_dom_tree",
    {
      description: "Retrieves a snapshot of the DOM tree with node IDs, names, attributes, and child relationships",
      inputSchema: z.object({
        depth: z.number().optional().describe("Depth of the tree to retrieve (-1 for full depth, default: -1)"),
        selector: z.string().optional().describe("CSS selector to filter the DOM tree to a specific subtree"),
      }),
    },
    async (params) => {
      log.info(`Getting DOM tree (depth: ${params.depth ?? -1}, selector: ${params.selector || "none"})`);
      try {
        const result = await getDomSnapshot(params);
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

  // Get Computed Styles tool
  mcpServer.registerTool(
    "get_computed_styles",
    {
      description: "Retrieves computed CSS styles for a specific element identified by its node ID",
      inputSchema: z.object({
        nodeId: z.number().describe("The node ID of the element (obtained from get_dom_tree)"),
        propertyNames: z.array(z.string()).optional().describe("Optional array of specific CSS property names to retrieve (e.g., ['color', 'font-size']). If omitted, returns all computed styles."),
      }),
    },
    async (params) => {
      log.info(`Getting computed styles for node ${params.nodeId} (properties: ${params.propertyNames?.length || "all"})`);
      try {
        const result = await getComputedStyles(params);
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

  // Interact Element tool
  mcpServer.registerTool(
    "interact_element",
    {
      description: "Interacts with a DOM element using various actions: click, type, hover, focus, scrollIntoView, or touch",
      inputSchema: z.object({
        nodeId: z.number().describe("The node ID of the element (obtained from get_dom_tree)"),
        action: z.enum(["click", "type", "hover", "focus", "scrollIntoView", "touch"]).describe("The interaction action to perform"),
        text: z.string().optional().describe("Text to type (required for 'type' action)"),
        button: z.enum(["left", "right", "middle"]).optional().describe("Mouse button for click action (default: 'left')"),
        clickCount: z.number().optional().describe("Number of clicks for click action (default: 1)"),
        modifiers: z.number().optional().describe("Keyboard modifiers as bit field: Alt=1, Ctrl=2, Meta=4, Shift=8 (default: 0)"),
        touchType: z.enum(["touchStart", "touchEnd", "touchMove", "touchCancel"]).optional().describe("Touch event type for touch action (default: 'touchStart')"),
      }),
    },
    async (params) => {
      log.info(`Interacting with element ${params.nodeId}: ${params.action}`);
      try {
        const result = await interactElement(params);
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

  // Take Screenshot tool
  mcpServer.registerTool(
    "take_screenshot",
    {
      description: "Captures a screenshot of the current page with support for full page, viewport, and custom clipping",
      inputSchema: z.object({
        fullPage: z.boolean().optional().describe("Whether to capture the entire page (default: true)"),
        clipArea: z.object({
          x: z.number().describe("X coordinate of the clip area"),
          y: z.number().describe("Y coordinate of the clip area"),
          width: z.number().describe("Width of the clip area"),
          height: z.number().describe("Height of the clip area"),
        }).optional().describe("Optional clipping rectangle for custom screenshot area"),
      }),
    },
    async (params) => {
      log.info(`Taking screenshot (fullPage: ${params.fullPage ?? true})`);
      try {
        const result = await takeScreenshot(params);
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

  // Search DOM tool
  mcpServer.registerTool(
    "search_dom",
    {
      description: "Searches the DOM for nodes matching a text query. Searches within text content, attributes, and element names. Supports plain text and XPath queries.",
      inputSchema: z.object({
        query: z.string().describe("Search query string (plain text or XPath expression)"),
        includeUserAgentShadowDOM: z.boolean().optional().describe("Whether to search within user-agent shadow DOM (default: false)"),
        maxResults: z.number().optional().describe("Maximum number of results to return (default: 100)"),
      }),
    },
    async (params) => {
      log.info(`Searching DOM for query: "${params.query}"`);
      try {
        const result = await searchDom(params);
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

  // Navigate tool
  mcpServer.registerTool(
    "navigate",
    {
      description: "Navigates to a different URL in the browser using Page.navigate",
      inputSchema: z.object({
        url: z.string().describe("The URL to navigate to"),
        waitUntil: z.enum(["documentUpdated"]).optional().describe("Optional wait condition: documentUpdated (wait for document update)"),
      }),
    },
    async (params) => {
      log.info(`Navigating to: ${params.url}`);
      try {
        const result = await navigate(params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: error.message }, null, 2) }],
          isError: true,
        };
      }
    }
  );

  // Eval JS tool
  mcpServer.registerTool(
    "eval_js",
    {
      description: "Executes arbitrary JavaScript code in the browser context using Runtime.evaluate. Returns the result value, type, and handles exceptions.",
      inputSchema: z.object({
        expression: z.string().describe("JavaScript expression or code to evaluate"),
        awaitPromise: z.boolean().optional().describe("Whether to await promises (default: false)"),
        returnByValue: z.boolean().optional().describe("Whether to return the result by value rather than by reference (default: true)"),
        timeout: z.number().optional().describe("Optional timeout in milliseconds for long-running scripts"),
      }),
    },
    async (params) => {
      log.info(`Evaluating JavaScript expression`);
      try {
        const result = await evalJs(params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: error.message }, null, 2) }],
          isError: true,
        };
      }
    }
  );

  // Gameface Get Status tool
  mcpServer.registerTool(
    "gameface_get_status",
    {
      description: "Returns the current browser connection status. Checks if there is an active connection to a browser.",
      inputSchema: z.object({}),
    },
    async (params) => {
      log.info(`Getting browser connection status`);
      try {
        const result = await gamefaceGetStatus(params);
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
