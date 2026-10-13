/**
 * Asking the user directly, where the client allows it.
 *
 * The performance budget must not be a number the model chose, so the strongest
 * available mechanism is MCP elicitation: the server asks the client, the client
 * asks the human, and the agent has no way to answer on their behalf.
 *
 * Client support for elicitation is uneven, and this server is meant to run
 * under whichever agent a team happens to use. So nothing here is load-bearing:
 * if the capability is absent, the request fails, or the client is slow to
 * answer, the caller falls back to reporting the measurement and stopping.
 * Falling back must never mean proceeding without a budget.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PerfBudget } from "./perf-budget.js";
import { createLogger } from "./logger.js";

const log = createLogger("Elicitation");

const ELICIT_TIMEOUT_MS = 120000;

let mcpServer: McpServer | null = null;

export function setElicitationServer(server: McpServer): void {
  mcpServer = server;
}

/** Whether the connected client said it can put a question to the user. */
export function canElicit(): boolean {
  if (!mcpServer) return false;
  try {
    return Boolean(mcpServer.server.getClientCapabilities()?.elicitation);
  } catch {
    return false;
  }
}

export type ElicitOutcome =
  | { status: "accepted"; budget: PerfBudget }
  | { status: "declined" }
  | { status: "unavailable"; reason: string };

/**
 * Puts the budget question to the user. Returns "unavailable" whenever the
 * answer did not come from a human, which the caller must treat exactly like a
 * decline rather than as licence to pick a number.
 */
export async function elicitBudget(measuredMs: number, spreadPct: number): Promise<ElicitOutcome> {
  if (!mcpServer) {
    return { status: "unavailable", reason: "No MCP server reference available." };
  }
  if (!canElicit()) {
    return { status: "unavailable", reason: "This client does not support elicitation, so the user cannot be asked directly." };
  }

  try {
    const result = await mcpServer.server.elicitInput(
      {
        message:
          `This UI costs ${measuredMs.toFixed(2)}ms of engine time per frame, repeatable to within ${spreadPct.toFixed(0)}%. ` +
          `Whether that is acceptable depends on what else your frame has to do, so it is your call.\n\n` +
          `Set a budget in milliseconds per frame to have performance work done against it, or decline to leave this alone.`,
        requestedSchema: {
          type: "object",
          properties: {
            uiFrameBudgetMs: {
              type: "number",
              title: "UI frame budget (ms)",
              description: "How many milliseconds of engine time this UI is allowed per frame.",
              minimum: 0.01,
            },
            note: {
              type: "string",
              title: "Note (optional)",
              description: "Why this number, for whoever reads the budget file later.",
            },
          },
          required: ["uiFrameBudgetMs"],
        },
      },
      { timeout: ELICIT_TIMEOUT_MS }
    );

    if (result.action !== "accept") {
      log.info(`User ${result.action}ed the budget request`);
      return { status: "declined" };
    }

    const value = (result.content as any)?.uiFrameBudgetMs;
    if (typeof value !== "number" || !isFinite(value) || value <= 0) {
      return { status: "unavailable", reason: "The client returned an unusable budget value." };
    }

    const note = (result.content as any)?.note;
    return {
      status: "accepted",
      budget: {
        uiFrameBudgetMs: value,
        note: typeof note === "string" && note.trim() ? note.trim() : undefined,
      },
    };
  } catch (error: any) {
    log.warn(`Elicitation failed: ${error.message}`);
    return { status: "unavailable", reason: `The elicitation request failed: ${error.message}` };
  }
}

export type ElicitPathOutcome =
  | { status: "accepted"; path: string }
  | { status: "declined" }
  | { status: "unavailable"; reason: string };

/**
 * Asks the user for the Player executable path. Same reasoning as the budget:
 * the path gets saved to the user's config and launched on every session, so
 * it should come from the user rather than from a model's guess.
 */
export async function elicitPlayerPath(): Promise<ElicitPathOutcome> {
  if (!mcpServer) {
    return { status: "unavailable", reason: "No MCP server reference available." };
  }
  if (!canElicit()) {
    return { status: "unavailable", reason: "This client does not support elicitation, so the user cannot be asked directly." };
  }

  try {
    const result = await mcpServer.server.elicitInput(
      {
        message:
          `No Gameface Player path is configured yet. Enter the full path to your Player executable ` +
          `(e.g. D:/GamefaceSDK/Player/Player.exe). It is saved to your gameface-mcp config, so you only need to do this once.`,
        requestedSchema: {
          type: "object",
          properties: {
            playerPath: {
              type: "string",
              title: "Player executable path",
              description: "Full path to Player.exe - usually in a Player subfolder of your Gameface SDK, not the SDK root.",
            },
          },
          required: ["playerPath"],
        },
      },
      { timeout: ELICIT_TIMEOUT_MS }
    );

    if (result.action !== "accept") {
      log.info(`User ${result.action}ed the Player path request`);
      return { status: "declined" };
    }

    const value = (result.content as any)?.playerPath;
    if (typeof value !== "string" || !value.trim()) {
      return { status: "unavailable", reason: "The client returned an empty Player path." };
    }

    return { status: "accepted", path: value.trim() };
  } catch (error: any) {
    log.warn(`Elicitation failed: ${error.message}`);
    return { status: "unavailable", reason: `The elicitation request failed: ${error.message}` };
  }
}
