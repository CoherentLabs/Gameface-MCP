#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

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

// Log to stderr only (stdout is reserved for MCP protocol)
// TODO: Log not only error logs
function log(message: string, level: "info" | "error" = "info") {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
}

// For Phase 1: Set up basic handlers using the underlying server
// Note: In later phases, tools will be registered using mcpServer.registerTool()
// which automatically handles ListTools and CallTool
mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => {
  log("Received ListTools request");
  return {
    tools: [],
  };
});

mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
  log(`Received CallTool request for tool: ${request.params.name}`);
  throw new Error(`Unknown tool: ${request.params.name}`);
});

// Start server with stdio transport
async function main() {
  log("Starting Chrome CDP MCP Server");
  
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  
  log("Server started successfully");
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
  log("Received SIGINT, shutting down gracefully");
  await mcpServer.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  log("Received SIGTERM, shutting down gracefully");
  await mcpServer.close();
  process.exit(0);
});

// Run the server
main().catch((error) => {
  log(`Fatal error: ${error.message}`, "error");
  console.error(error);
  process.exit(1);
});
