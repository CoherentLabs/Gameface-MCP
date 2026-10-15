import { basename } from "node:path";
import { getConfig, savePlayerPath } from "../config.js";
import { canElicit, elicitPlayerChoice, elicitPlayerPath, elicitSearchConsent } from "../elicitation.js";
import { findPlayerFile, isFile, resolveDefaultPlayer, searchAndAddPlayers, SEARCH_TIMEOUT_MS } from "../player-paths.js";
import { SetPlayerPathParams, SetPlayerPathResult } from "../types.js";
import { createLogger } from "../logger.js";

const log = createLogger("SetPlayerPath");

// When the user couldn't be asked, or didn't answer: the next step is the
// server's own search, but only with the user's go-ahead.
const OFFER_SEARCH =
  "Ask the user for the full path to their Player executable and call set_player_path again with playerPath, " +
  "or offer to search their machine for it automatically - if they agree, call set_player_path with search: true.";

// After the server's search came up empty, or the user turned it down. A path
// the model finds gets saved and launched on every future session, so its own
// search still needs the user's say-so.
const MANUAL_FALLBACK =
  "Ask the user for the full path to their Player executable and call set_player_path again with playerPath. " +
  "Only search the machine for Player.exe yourself if the user explicitly allows it. If they do: look for files " +
  "named Player.exe under the user's home folder first, then other drives, skipping node_modules, .git, AppData " +
  "and Windows. Gameface Players sit in folders named like Cohtml-<version>-...-Player or <SDK>/Player/. Compare " +
  "versions numerically (3.2.0.64 is newer than 3.2.0.9). Show the user the candidates you found, then save the newest.";

// How many times a mistyped path re-opens the prompt before only the search
// is offered.
export const MAX_PROMPT_ATTEMPTS = 3;

function save(playerFile: string, enteredPath: string): SetPlayerPathResult {
  // Not a hard failure: launch_browser verifies the Gameface identity anyway,
  // and a renamed Player is still a Player.
  const warning = /^player(\.exe)?$/i.test(basename(playerFile))
    ? undefined
    : `${basename(playerFile)} is not named Player.exe. launch_browser will refuse it if it is not a Gameface Player.`;

  const foundInFolder = playerFile !== enteredPath ? ` (found inside the folder ${enteredPath})` : "";

  // A working --browser-executable still wins over the saved path. A missing
  // one needs no warning: resolveDefaultPlayer() falls back to the saved path.
  const cli = getConfig().cliBrowserExecutable;
  const effect =
    cli && isFile(cli)
      ? `But --browser-executable ${cli} in your MCP client config (e.g. .mcp.json or ~/.claude.json) takes priority over this. Remove it there for the saved path to be used.`
      : "launch_browser will use it from now on, in this and future sessions.";

  try {
    const configFile = savePlayerPath(playerFile);
    log.info(`Saved Player path ${playerFile} to ${configFile}`);
    return {
      success: true,
      message: `Saved the Player path ${playerFile}${foundInFolder} to ${configFile}. ${effect}`,
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
 * Runs the search and saves what it found: the only hit directly, or the
 * user's pick when there are several (the newest, if they can't be asked).
 */
async function searchAndSave(): Promise<SetPlayerPathResult> {
  // Every Player found goes into the players list for launch_browser's
  // choosePlayer, whichever one ends up the default.
  const { result, note: searched } = await searchAndAddPlayers();

  if (result.candidates.length === 0) {
    const scope = result.timedOut
      ? `in the ${SEARCH_TIMEOUT_MS / 1000}s time limit (parts of the disk were not reached)`
      : "anywhere it looked";
    return {
      success: false,
      message: `${searched} The automatic search found no Player.exe ${scope}. ${MANUAL_FALLBACK}`,
    };
  }

  const paths = result.candidates.map((c) => c.path);

  if (result.candidates.length === 1) {
    const saved = save(paths[0], paths[0]);
    return saved.success ? { ...saved, message: `${searched} ${saved.message}`, candidates: paths } : saved;
  }

  if (canElicit()) {
    const choice = await elicitPlayerChoice(
      result.candidates,
      `Found ${paths.length} Gameface Players on your machine. Pick your default - the newest is selected.`
    );
    if (choice.status === "accepted") {
      return { ...save(choice.path, choice.path), candidates: paths };
    }
    if (choice.status === "declined") {
      return {
        success: false,
        message: `${searched} The user declined to pick a default. Show them the candidates and ask which to use, then call set_player_path with that playerPath.`,
        candidates: paths,
      };
    }
  }

  // No way to ask: the newest wins, and the model gets the rest to mention.
  const saved = save(paths[0], paths[0]);
  return saved.success
    ? { ...saved, message: `${searched} Saved the newest as the default. Tell the user which one was chosen and that they can switch to another candidate. ${saved.message}`, candidates: paths }
    : saved;
}

/**
 * MCP tool implementation for saving the Gameface Player path to the user's
 * config file. With no playerPath the user is asked directly (elicitation):
 * again with a "search for me" option if what they type doesn't lead to a
 * Player, and after repeated misses only whether to search. A client that
 * cannot ask falls back to the model asking in chat.
 */
export async function setPlayerPath(params: SetPlayerPathParams): Promise<SetPlayerPathResult> {
  if (params.search) {
    return searchAndSave();
  }

  if (params.playerPath?.trim()) {
    const { resolvedPath, playerFile } = findPlayerFile(params.playerPath);
    if (!playerFile) {
      return {
        success: false,
        message: `No Player.exe found at ${resolvedPath}, or in a Player subfolder of it. ${OFFER_SEARCH}`,
      };
    }
    return save(playerFile, resolvedPath);
  }

  let problem: string | undefined;
  for (let attempt = 1; attempt <= MAX_PROMPT_ATTEMPTS; attempt++) {
    // The search option only shows up once the first answer has missed.
    const outcome = await elicitPlayerPath(problem, attempt > 1, resolveDefaultPlayer().path);

    if (outcome.status === "declined") {
      return {
        success: false,
        message: `The user declined to enter a Player path. ${OFFER_SEARCH}`,
      };
    }
    if (outcome.status === "unavailable") {
      return {
        success: false,
        message: `${outcome.reason} ${OFFER_SEARCH}`,
      };
    }
    if (outcome.status === "search") {
      return searchAndSave();
    }
    if (outcome.status === "empty") {
      problem = "No path was entered.\nEnter one, or tick the box to have your machine searched.";
      continue;
    }

    const { resolvedPath, playerFile } = findPlayerFile(outcome.path);
    if (playerFile) {
      return save(playerFile, resolvedPath);
    }
    log.info(`Prompt attempt ${attempt}: no Player found at ${resolvedPath}`);
    problem = `No Player.exe found at ${resolvedPath}\nCheck the path and try again.`;
  }

  const consent = await elicitSearchConsent(`None of the ${MAX_PROMPT_ATTEMPTS} paths entered led to a Player.exe.`);
  if (consent.status === "accepted") {
    return searchAndSave();
  }
  return {
    success: false,
    message:
      consent.status === "declined"
        ? `The user entered a path with no Player.exe ${MAX_PROMPT_ATTEMPTS} times, then declined an automatic search. ${MANUAL_FALLBACK}`
        : `${consent.reason} ${MANUAL_FALLBACK}`,
  };
}
