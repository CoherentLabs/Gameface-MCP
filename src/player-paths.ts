/**
 * Player path handling shared by set_player_path, add_players and
 * launch_browser: turning what the user typed into a Player executable,
 * listing the configured Players, and the search that fills that list.
 */

import { statSync } from "node:fs";
import { join, resolve } from "node:path";
import { addPlayers, getConfig } from "./config.js";
import { PlayerSearchResult, searchForPlayers } from "./player-search.js";
import { createLogger } from "./logger.js";

const log = createLogger("PlayerPaths");

export const SEARCH_TIMEOUT_MS = 60_000;

export function isFile(path: string): boolean {
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
export function findPlayerFile(input: string): { resolvedPath: string; playerFile: string | null } {
  // Windows Explorer's "Copy as path" wraps the path in quotes.
  const resolvedPath = resolve(input.trim().replace(/^"(.*)"$/, "$1"));

  if (isFile(resolvedPath)) {
    return { resolvedPath, playerFile: resolvedPath };
  }

  const candidates = [join(resolvedPath, "Player.exe"), join(resolvedPath, "Player", "Player.exe")];
  return { resolvedPath, playerFile: candidates.find(isFile) ?? null };
}

// A folder of Players is usually <folder>/<Player build>/[Player/]Player.exe;
// the extra levels allow for one more layer of grouping, e.g. by version.
const FOLDER_SEARCH_DEPTH = 4;
const FOLDER_SEARCH_TIMEOUT_MS = 10_000;

/**
 * Like findPlayerFile, but a folder that isn't itself a Player's is searched
 * for every Player.exe inside it - so "here's my Players folder" adds them all.
 */
export async function findPlayersIn(input: string): Promise<{ resolvedPath: string; players: string[]; fromFolder: boolean }> {
  const { resolvedPath, playerFile } = findPlayerFile(input);
  if (playerFile) {
    return { resolvedPath, players: [playerFile], fromFolder: false };
  }

  let isDirectory = false;
  try {
    isDirectory = statSync(resolvedPath).isDirectory();
  } catch {
    // Missing path - no Players, same as a file that isn't one.
  }
  if (!isDirectory) {
    return { resolvedPath, players: [], fromFolder: false };
  }

  const result = await searchForPlayers(FOLDER_SEARCH_TIMEOUT_MS, [resolvedPath], FOLDER_SEARCH_DEPTH);
  return { resolvedPath, players: result.candidates.map((c) => c.path), fromFolder: true };
}

/**
 * The configured Players that still exist, without duplicates - optionally
 * with the default Player first. Paths that are gone are left out rather than
 * offered and failing at launch.
 */
export function existingPlayers(includeDefault: boolean): string[] {
  const { browserExecutable, players } = getConfig();
  const key = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);
  const seen = new Set<string>();
  return [includeDefault ? browserExecutable : undefined, ...players]
    .filter((p): p is string => !!p && isFile(p))
    .filter((p) => !seen.has(key(p)) && !!seen.add(key(p)));
}

/**
 * Runs the search and adds every Player found to the config's players list.
 * `note` says how that went, for the tool result; `added` is what was new.
 */
export async function searchAndAddPlayers(): Promise<{ result: PlayerSearchResult; note: string; added: string[] }> {
  const result = await searchForPlayers(SEARCH_TIMEOUT_MS);
  const seconds = Math.round(result.elapsedMs / 1000);
  let note = `Searched ${result.foldersScanned} folders in ${seconds}s.`;
  if (result.candidates.length === 0) {
    return { result, note, added: [] };
  }

  // A failure here (e.g. an unreadable config file) is only logged: the
  // caller's own config write hits the same problem and reports it in full.
  let added: string[] = [];
  try {
    added = addPlayers(result.candidates.map((c) => c.path));
    note += ` Found ${result.candidates.length} Players; ${added.length} were new and added to the players list.`;
  } catch (error: any) {
    log.warn(`Could not add found Players to the config: ${error.message}`);
    note += ` Found ${result.candidates.length} Players, but could not add them to the players list: ${error.message}`;
  }
  return { result, note, added };
}
