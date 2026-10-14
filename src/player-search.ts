/**
 * Looking for Gameface Player executables on the user's machine.
 *
 * Players get unzipped wherever people happen to put them, so there is no
 * fixed list of locations to check. Instead this walks the disk breadth-first
 * - shallow folders before deep ones - starting with the home folder and only
 * moving on to the other drives if nothing turned up there, and gives up at a
 * deadline rather than running for however long a full disk takes.
 *
 * Only ever runs because the user asked for it (set_player_path's or
 * add_players' search), or inside a folder the user pointed at (add_players).
 */

import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { compareCohtmlVersions } from "./connection-manager.js";
import { createLogger } from "./logger.js";

const log = createLogger("PlayerSearch");

const PLAYER_FILE = /^player(\.exe)?$/i;

// Folders that are huge, system-owned, or never hold an unzipped Player.
// Anything starting with "." or "$" (.git, .cache, $Recycle.Bin) is skipped too.
const SKIP_DIRS = new Set(
  ["node_modules", "appdata", "windows", "programdata", "windowsapps", "system volume information", "recovery", "perflogs"]
);

const MAX_DEPTH = 8;
const CONCURRENCY = 16;

export interface PlayerCandidate {
  path: string;
  /** Last version-looking part of the path, e.g. 3.2.0.64 from Cohtml-3.2.0.64-Public-Player. */
  version: string | null;
}

export interface PlayerSearchResult {
  /** Newest version first; candidates without a version in their path last. */
  candidates: PlayerCandidate[];
  timedOut: boolean;
  foldersScanned: number;
  elapsedMs: number;
}

function searchRoots(): string[] {
  const roots = [homedir()];
  if (process.platform === "win32") {
    for (const letter of "CDEFGHIJKLMNOPQRSTUVWXYZ") {
      if (existsSync(`${letter}:\\`)) roots.push(`${letter}:\\`);
    }
  } else {
    roots.push("/");
  }
  return roots;
}

function shouldSkip(name: string): boolean {
  return name.startsWith(".") || name.startsWith("$") || SKIP_DIRS.has(name.toLowerCase());
}

function versionFromPath(path: string): string | null {
  const matches = path.match(/\d+\.\d+\.\d+(?:\.\d+)*/g);
  return matches ? matches[matches.length - 1] : null;
}

/**
 * Labels Player paths with the version in their folder name, newest first;
 * paths without one go last, in their original order.
 */
export function toCandidates(paths: string[]): PlayerCandidate[] {
  return paths
    .map((path) => ({ path, version: versionFromPath(path) }))
    .sort((a, b) => {
      if (a.version && b.version) return compareCohtmlVersions(b.version, a.version);
      return a.version ? -1 : b.version ? 1 : 0;
    });
}

async function forEachWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      await fn(items[next++]);
    }
  });
  await Promise.all(workers);
}

/**
 * Walks `roots` in order (by default the home folder, then every drive),
 * stopping after the first root that turns up any Players.
 */
export async function searchForPlayers(
  timeoutMs: number,
  roots: string[] = searchRoots(),
  maxDepth: number = MAX_DEPTH
): Promise<PlayerSearchResult> {
  const start = Date.now();
  const deadline = start + timeoutMs;
  const found = new Map<string, string>();
  // Walking C:\ reaches the home folder again; this keeps it from being walked twice.
  const visited = new Set<string>();
  const key = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);
  let foldersScanned = 0;

  for (const root of roots) {
    let level = [root];
    for (let depth = 0; depth <= maxDepth && level.length > 0 && Date.now() < deadline; depth++) {
      const nextLevel: string[] = [];
      await forEachWithConcurrency(level, CONCURRENCY, async (dir) => {
        if (Date.now() >= deadline || visited.has(key(dir))) return;
        visited.add(key(dir));

        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          return; // No permission, vanished, etc. - not worth reporting.
        }
        foldersScanned++;

        for (const entry of entries) {
          // Symlinks and junctions report as neither file nor directory here,
          // so they are never followed - no loops, no double counting.
          if (entry.isFile() && PLAYER_FILE.test(entry.name)) {
            const path = join(dir, entry.name);
            found.set(key(path), path);
          } else if (entry.isDirectory() && !shouldSkip(entry.name)) {
            nextLevel.push(join(dir, entry.name));
          }
        }
      });
      level = nextLevel;
    }

    if (found.size > 0 || Date.now() >= deadline) break;
  }

  const candidates = toCandidates([...found.values()]);

  const result = { candidates, timedOut: Date.now() >= deadline, foldersScanned, elapsedMs: Date.now() - start };
  log.info(`Found ${candidates.length} Player(s) in ${foldersScanned} folders, ${result.elapsedMs}ms${result.timedOut ? " (hit the time limit)" : ""}`);
  return result;
}
