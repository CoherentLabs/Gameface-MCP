import { statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { savePlayerPath } from "../config.js";
import { elicitPlayerPath } from "../elicitation.js";
import { SetPlayerPathParams, SetPlayerPathResult } from "../types.js";
import { createLogger } from "../logger.js";

const log = createLogger("SetPlayerPath");

// Shared by every "couldn't get a path from the user" outcome. Searching is
// allowed, but only on the user's say-so - a path found by the model gets
// saved and launched on every future session.
const ASK_OR_SEARCH =
  "Ask the user for the full path to their Player executable and call set_player_path again with playerPath. " +
  "Only search the machine for Player.exe yourself if the user explicitly allows it. If they do: look for files " +
  "named Player.exe under the user's home folder first, then other drives, skipping node_modules, .git, AppData " +
  "and Windows. Gameface Players sit in folders named like Cohtml-<version>-...-Player or <SDK>/Player/. Compare " +
  "versions numerically (3.2.0.64 is newer than 3.2.0.9). Show the user the candidates you found, then save the newest.";

// How many times a mistyped path re-opens the prompt before handing the
// problem back to the model.
const MAX_PROMPT_ATTEMPTS = 3;

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Turns what the user typed into the Player executable, or null if there is
 * none. A folder is accepted too: pointing at the SDK root instead of its
 * Player subfolder is the most common mistake, so both are checked.
 */
function findPlayerFile(input: string): { resolvedPath: string; playerFile: string | null } {
  // Windows Explorer's "Copy as path" wraps the path in quotes.
  const resolvedPath = resolve(input.trim().replace(/^"(.*)"$/, "$1"));

  if (isFile(resolvedPath)) {
    return { resolvedPath, playerFile: resolvedPath };
  }

  const candidates = [join(resolvedPath, "Player.exe"), join(resolvedPath, "Player", "Player.exe")];
  return { resolvedPath, playerFile: candidates.find(isFile) ?? null };
}

function save(playerFile: string, enteredPath: string): SetPlayerPathResult {
  // Not a hard failure: launch_browser verifies the Gameface identity anyway,
  // and a renamed Player is still a Player.
  const warning = /^player(\.exe)?$/i.test(basename(playerFile))
    ? undefined
    : `${basename(playerFile)} is not named Player.exe. launch_browser will refuse it if it is not a Gameface Player.`;

  const foundInFolder = playerFile !== enteredPath ? ` (found inside the folder ${enteredPath})` : "";

  try {
    const configFile = savePlayerPath(playerFile);
    log.info(`Saved Player path ${playerFile} to ${configFile}`);
    return {
      success: true,
      message: `Saved the Player path ${playerFile}${foundInFolder} to ${configFile}. launch_browser will use it from now on, in this and future sessions.`,
      playerPath: playerFile,
      configFile,
      warning,
    };
  } catch (error: any) {
    log.error(`Failed to save Player path: ${error.message}`);
    return {
      success: false,
      message: error.message,
    };
  }
}

/**
 * MCP tool implementation for saving the Gameface Player path to the user's
 * config file. With no playerPath the user is asked directly (elicitation),
 * and asked again if what they type doesn't lead to a Player; a client that
 * cannot ask falls back to the model asking in chat.
 */
export async function setPlayerPath(params: SetPlayerPathParams): Promise<SetPlayerPathResult> {
  if (params.playerPath?.trim()) {
    const { resolvedPath, playerFile } = findPlayerFile(params.playerPath);
    if (!playerFile) {
      return {
        success: false,
        message: `No Player.exe found at ${resolvedPath}, or in a Player subfolder of it. ${ASK_OR_SEARCH}`,
      };
    }
    return save(playerFile, resolvedPath);
  }

  let problem: string | undefined;
  for (let attempt = 1; attempt <= MAX_PROMPT_ATTEMPTS; attempt++) {
    const outcome = await elicitPlayerPath(problem);

    if (outcome.status === "declined") {
      return {
        success: false,
        message: `The user declined to enter a Player path. ${ASK_OR_SEARCH}`,
      };
    }
    if (outcome.status === "unavailable") {
      return {
        success: false,
        message: `${outcome.reason} ${ASK_OR_SEARCH}`,
      };
    }

    const { resolvedPath, playerFile } = findPlayerFile(outcome.path);
    if (playerFile) {
      return save(playerFile, resolvedPath);
    }
    log.info(`Prompt attempt ${attempt}: no Player found at ${resolvedPath}`);
    problem = `No Player.exe found at ${resolvedPath}, or in a Player subfolder of it. Check the path and try again.`;
  }

  return {
    success: false,
    message: `The user entered a path with no Player.exe ${MAX_PROMPT_ATTEMPTS} times in a row. ${ASK_OR_SEARCH}`,
  };
}
