import { addPlayers } from "../config.js";
import { elicitPlayerPaths } from "../elicitation.js";
import { findPlayersIn, searchAndAddPlayers } from "../player-paths.js";
import { AddPlayersParams, AddPlayersResult } from "../types.js";
import { MAX_PROMPT_ATTEMPTS } from "./set-player-path.js";
import { createLogger } from "../logger.js";

const log = createLogger("AddPlayers");

const ASK_IN_CHAT =
  "Ask the user for the paths of the Players to add and call add_players with paths, " +
  "or - if they agree to an automatic search of their machine - with search: true.";

type Resolved = Awaited<ReturnType<typeof findPlayersIn>>;

const resolveAll = (inputs: string[]): Promise<Resolved[]> => Promise.all(inputs.map(findPlayersIn));

/**
 * Adds every Player the inputs led to - directly, or from inside a folder of
 * Players - to the players list, and reports the inputs that led to none.
 * The default Player is never touched here.
 */
function addResolved(resolved: Resolved[]): AddPlayersResult {
  const valid = resolved.flatMap((r) => r.players);
  const invalid = resolved.filter((r) => r.players.length === 0).map((r) => r.resolvedPath);
  const fromFolders = resolved.filter((r) => r.fromFolder && r.players.length > 0).map((r) => `${r.players.length} in ${r.resolvedPath}`);

  if (valid.length === 0) {
    return { success: false, message: `No Player.exe found at or inside: ${invalid.join("; ")}. ${ASK_IN_CHAT}`, invalid };
  }

  try {
    const added = addPlayers(valid);
    log.info(`Added ${added.length} Player(s) to the list`);
    const message = [
      fromFolders.length > 0 && `Found ${fromFolders.join(", ")}.`,
      `Added ${added.length} Player(s) to the players list.`,
      valid.length > added.length && `${valid.length - added.length} were already in it.`,
      invalid.length > 0 && `No Player.exe found at or inside: ${invalid.join("; ")}.`,
      "The default Player was not changed.",
    ]
      .filter(Boolean)
      .join(" ");
    return { success: true, message, added, invalid: invalid.length > 0 ? invalid : undefined };
  } catch (error: any) {
    log.error(`Failed to add Players: ${error.message}`);
    return { success: false, message: error.message };
  }
}

/**
 * MCP tool implementation for adding Players to the config's players list,
 * for launch_browser's choosePlayer: by search (only with the user's consent),
 * from given paths, or - with no arguments - by asking the user directly.
 */
export async function addPlayersToList(params: AddPlayersParams): Promise<AddPlayersResult> {
  if (params.search) {
    const { result, note, added } = await searchAndAddPlayers();
    if (result.candidates.length === 0) {
      return {
        success: false,
        message: `${note} The search found no Player.exe${result.timedOut ? " within the time limit" : ""}. Ask the user for the paths and call add_players with paths.`,
      };
    }
    return { success: true, message: `${note} The default Player was not changed.`, added };
  }

  if (params.paths?.length) {
    return addResolved(await resolveAll(params.paths));
  }

  let problem: string | undefined;
  for (let attempt = 1; attempt <= MAX_PROMPT_ATTEMPTS; attempt++) {
    const outcome = await elicitPlayerPaths(problem);

    if (outcome.status === "declined") {
      return { success: false, message: "The user declined to add Players." };
    }
    if (outcome.status === "unavailable") {
      return { success: false, message: `${outcome.reason} ${ASK_IN_CHAT}` };
    }
    if (outcome.status === "empty") {
      problem = "No path was entered.\nPaste a Player, or a folder of Players; separate several with ;";
      continue;
    }

    // Any valid path is enough to save; the bad ones are reported alongside.
    const resolved = await resolveAll(outcome.paths);
    if (resolved.some((r) => r.players.length > 0)) {
      return addResolved(resolved);
    }
    problem = `No Player.exe found at or inside: ${resolved.map((r) => r.resolvedPath).join("; ")}\nCheck the paths and try again.`;
  }

  return { success: false, message: `The user entered paths with no Player.exe ${MAX_PROMPT_ATTEMPTS} times. ${ASK_IN_CHAT}` };
}
