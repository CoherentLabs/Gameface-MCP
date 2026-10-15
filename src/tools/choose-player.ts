import { savePlayerPath } from "../config.js";
import { canElicit, elicitPlayerChoice } from "../elicitation.js";
import { existingPlayers, resolveDefaultPlayer } from "../player-paths.js";
import { toCandidates } from "../player-search.js";
import { getBrowserLauncher } from "./launch-browser.js";

type ChooseOutcome = { status: "chosen"; path: string } | { status: "error"; message: string };

const NO_PLAYER_PATH =
  "No Gameface Player path is configured. Call set_player_path without arguments so the user is asked for it, then call launch_browser again.";

/**
 * Lets the user pick which Player launch_browser starts, from the default
 * Player plus the config's `players` list.
 */
export async function choosePlayer(): Promise<ChooseOutcome> {
  // Checked here as well as in launchBrowser, so the user isn't asked to pick
  // a Player only to be told one is already running.
  if (getBrowserLauncher().isRunning()) {
    return { status: "error", message: "A Player is already running. Close it first before launching a new instance." };
  }

  const paths = existingPlayers(true);
  if (paths.length === 0) {
    return { status: "error", message: NO_PLAYER_PATH };
  }
  if (paths.length === 1) {
    return { status: "chosen", path: paths[0] };
  }

  const candidates = toCandidates(paths);
  const list = candidates.map((c) => c.path).join("; ");
  if (!canElicit()) {
    return {
      status: "error",
      message: `This client can't show a choice to the user. Ask them which of these Players to launch, then call launch_browser with that executablePath: ${list}`,
    };
  }

  const choice = await elicitPlayerChoice(candidates, "Pick the Gameface Player to launch.", resolveDefaultPlayer().path);
  if (choice.status === "accepted") {
    return { status: "chosen", path: choice.path };
  }
  return {
    status: "error",
    message:
      choice.status === "declined"
        ? "The user cancelled the launch."
        : `${choice.reason} Ask the user which of these Players to launch, then call launch_browser with that executablePath: ${list}`,
  };
}

/**
 * For a launch with no default Player set: if the players list has some, offer
 * them (newest preselected) and save the pick as the default. With an empty
 * list, set_player_path is the way forward.
 */
export async function chooseDefaultFromPlayers(): Promise<ChooseOutcome> {
  const paths = existingPlayers(false);
  if (paths.length === 0) {
    return { status: "error", message: NO_PLAYER_PATH };
  }

  const candidates = toCandidates(paths);
  if (!canElicit()) {
    return {
      status: "error",
      message: `No default Player is set, but these are in the players list: ${candidates.map((c) => c.path).join("; ")}. Ask the user which to make the default, then call set_player_path with that playerPath.`,
    };
  }

  const choice = await elicitPlayerChoice(candidates, "No default Player is set yet.\nPick one from your list to make it the default and launch it.");
  if (choice.status !== "accepted") {
    return {
      status: "error",
      message:
        choice.status === "declined"
          ? "No default Player is set, and the user declined to pick one from their list."
          : `${choice.reason} ${NO_PLAYER_PATH}`,
    };
  }

  try {
    savePlayerPath(choice.path);
  } catch (error: any) {
    return { status: "error", message: error.message };
  }
  return { status: "chosen", path: choice.path };
}
