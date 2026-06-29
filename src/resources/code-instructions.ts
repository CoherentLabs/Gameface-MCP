import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RESOURCE_URI = "gameface://code-instructions";
const RESOURCE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../prompts/negative-rules/negative-rules-injection.md"
);

/**
 * MCP resource that exposes the Gameface negative rules injection prompt.
 */
export async function getCodeInstructionsResource() {
  const content = await readFile(RESOURCE_PATH, "utf8");

  return {
    contents: [
      {
        uri: RESOURCE_URI,
        mimeType: "text/markdown",
        text: content,
      },
    ],
  };
}
