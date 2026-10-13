import { statSync } from "node:fs";
import { basename, resolve } from "node:path";
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

/**
 * MCP tool implementation for saving the Gameface Player path to the user's
 * config file. With no playerPath the user is asked directly (elicitation);
 * a client that cannot ask falls back to the model asking in chat.
 */
export async function setPlayerPath(params: SetPlayerPathParams): Promise<SetPlayerPathResult> {
  let playerPath = params.playerPath;

  if (!playerPath?.trim()) {
    const outcome = await elicitPlayerPath();

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
    playerPath = outcome.path;
  }

  // Windows Explorer's "Copy as path" wraps the path in quotes.
  const resolvedPath = resolve(playerPath.trim().replace(/^"(.*)"$/, "$1"));

  let isFile = false;
  try {
    isFile = statSync(resolvedPath).isFile();
  } catch {
    // Missing path - reported below, same as a directory.
  }
  if (!isFile) {
    return {
      success: false,
      message: `No file found at ${resolvedPath}. Player.exe usually lives in a Player subfolder of the Gameface SDK, not the SDK root. ${ASK_OR_SEARCH}`,
    };
  }

  // Not a hard failure: launch_browser verifies the Gameface identity anyway,
  // and a renamed Player is still a Player.
  const warning = /^player(\.exe)?$/i.test(basename(resolvedPath))
    ? undefined
    : `${basename(resolvedPath)} is not named Player.exe. launch_browser will refuse it if it is not a Gameface Player.`;

  try {
    const configFile = savePlayerPath(resolvedPath);
    log.info(`Saved Player path ${resolvedPath} to ${configFile}`);
    return {
      success: true,
      message: `Saved the Player path to ${configFile}. launch_browser will use it from now on, in this and future sessions.`,
      playerPath: resolvedPath,
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
