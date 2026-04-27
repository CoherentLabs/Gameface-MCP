#!/usr/bin/env node

/**
 * Simple test client to verify the MCP server responds to ListTools request
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, "build", "index.js");

console.log("Starting MCP server test...");

const server = spawn("node", [serverPath], {
  stdio: ["pipe", "pipe", "pipe"],
});

let stdoutData = "";
let stderrData = "";

server.stdout.on("data", (data) => {
  stdoutData += data.toString();
});

server.stderr.on("data", (data) => {
  stderrData += data.toString();
  console.log("Server stderr:", data.toString());
});

// Wait for server to initialize
setTimeout(() => {
  console.log("\nSending initialize request...");
  
  const initRequest = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "test-client",
        version: "1.0.0",
      },
    },
  };
  
  server.stdin.write(JSON.stringify(initRequest) + "\n");
  
  // Wait for initialization response, then send ListTools request
  setTimeout(() => {
    console.log("\nSending ListTools request...");
    
    const listToolsRequest = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    };
    
    server.stdin.write(JSON.stringify(listToolsRequest) + "\n");
    
    // Wait for response
    setTimeout(() => {
      console.log("\n=== Test Results ===");
      console.log("\nServer stdout (MCP protocol responses):");
      console.log(stdoutData);
      
      // Try to parse the responses
      const lines = stdoutData.trim().split("\n");
      let success = false;
      
      for (const line of lines) {
        try {
          const response = JSON.parse(line);
          if (response.id === 2 && response.result && "tools" in response.result) {
            console.log("\n✅ SUCCESS: Server responded to ListTools request");
            console.log("Tools:", response.result.tools);
            success = true;
            break;
          }
        } catch (e) {
          // Ignore parse errors, might be partial data
        }
      }
      
      if (!success) {
        console.log("\n❌ FAILED: Server did not respond correctly to ListTools request");
      }
      
      // Clean shutdown
      server.kill();
      process.exit(success ? 0 : 1);
    }, 1000);
  }, 500);
}, 1000);

server.on("error", (error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

server.on("exit", (code) => {
  console.log(`\nServer exited with code: ${code}`);
});
