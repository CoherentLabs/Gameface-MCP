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
import type { ElicitRequestFormParams } from "@modelcontextprotocol/sdk/types.js";
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

// Shown wherever the user is offered the Player search, so they know what
// they're agreeing to - see player-search.ts for why each part holds.
//
// Terminal clients cut every line at the window width and fold anything past
// a few lines, so these prompts keep the message to a line or two and put
// the detail in field descriptions, which are shown in full under each field.
const SEARCH_DISCLAIMER = "Runs locally in the MCP server, not the AI. Reads folder names only; the AI sees just the Players found.";

// The Player path questions below share this: put one form to the user and
// hand back its content, or the reason there is none.
type NotAnswered = { status: "declined" } | { status: "unavailable"; reason: string };

async function ask(
  what: string,
  message: string,
  requestedSchema: ElicitRequestFormParams["requestedSchema"]
): Promise<{ status: "answered"; content: Record<string, unknown> } | NotAnswered> {
  if (!mcpServer) {
    return { status: "unavailable", reason: "No MCP server reference available." };
  }
  if (!canElicit()) {
    return { status: "unavailable", reason: "This client does not support elicitation, so the user cannot be asked directly." };
  }

  try {
    const result = await mcpServer.server.elicitInput({ message, requestedSchema }, { timeout: ELICIT_TIMEOUT_MS });
    if (result.action !== "accept") {
      log.info(`User ${result.action}ed the ${what} request`);
      return { status: "declined" };
    }
    return { status: "answered", content: (result.content ?? {}) as Record<string, unknown> };
  } catch (error: any) {
    log.warn(`Elicitation failed: ${error.message}`);
    return { status: "unavailable", reason: `The elicitation request failed: ${error.message}` };
  }
}

export type ElicitPathOutcome =
  | { status: "accepted"; path: string }
  | { status: "search" }
  | { status: "empty" }
  | NotAnswered;

/**
 * Asks the user for the Player executable path. Same reasoning as the budget:
 * the path gets saved to the user's config and launched on every session, so
 * it should come from the user rather than from a model's guess. `problem`
 * replaces the opening message when asking again after a bad path, and
 * `offerSearch` adds the option of letting the server look for it instead.
 */
export async function elicitPlayerPath(problem?: string, offerSearch = false): Promise<ElicitPathOutcome> {
  const answer = await ask(
    "Player path",
    problem ?? "No Gameface Player path is configured yet.\nIt's saved to your gameface-mcp config, so you only do this once.",
    {
      type: "object",
      properties: {
        playerPath: {
          type: "string",
          title: "Player executable path",
          description: "Player.exe or the folder containing it, e.g. D:/GamefaceSDK/Player/Player.exe",
        },
        ...(offerSearch && {
          searchForMe: {
            type: "boolean",
            title: "Search my machine for Player.exe instead (leave the path empty)",
            description: SEARCH_DISCLAIMER,
            default: false,
          },
        }),
      },
      // With the search box on offer, an empty path is a valid answer.
      required: offerSearch ? [] : ["playerPath"],
    }
  );
  if (answer.status !== "answered") return answer;

  if (answer.content.searchForMe === true) return { status: "search" };
  const value = answer.content.playerPath;
  if (typeof value !== "string" || !value.trim()) return { status: "empty" };
  return { status: "accepted", path: value.trim() };
}

/**
 * The last question after repeated bad paths: only whether to search.
 */
export async function elicitSearchConsent(problem: string): Promise<{ status: "accepted" } | NotAnswered> {
  const answer = await ask(
    "Player search",
    `${problem}\nSearch your machine for Player.exe instead? Takes up to a minute.`,
    {
      type: "object",
      properties: {
        search: { type: "boolean", title: "Search my machine for Player.exe", description: SEARCH_DISCLAIMER, default: true },
      },
      required: [],
    }
  );
  if (answer.status !== "answered") return answer;
  return answer.content.search === false ? { status: "declined" } : { status: "accepted" };
}

/**
 * Lets the user pick between several Players a search found, newest first and
 * preselected.
 */
export async function elicitPlayerChoice(
  candidates: { path: string; version: string | null }[]
): Promise<{ status: "accepted"; path: string } | NotAnswered> {
  const answer = await ask(
    "Player choice",
    `Found ${candidates.length} Gameface Players on your machine. Pick the one to use - the newest is selected.`,
    {
      type: "object",
      properties: {
        playerPath: {
          type: "string",
          title: "Player",
          oneOf: candidates.map((c) => ({ const: c.path, title: c.version ? `${c.version} - ${c.path}` : c.path })),
          default: candidates[0].path,
        },
      },
      required: ["playerPath"],
    }
  );
  if (answer.status !== "answered") return answer;

  const value = answer.content.playerPath;
  if (typeof value !== "string" || !candidates.some((c) => c.path === value)) {
    return { status: "unavailable", reason: "The client returned a Player that wasn't one of the choices." };
  }
  return { status: "accepted", path: value };
}
