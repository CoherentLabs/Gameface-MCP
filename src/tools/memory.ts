/**
 * Memory Tools
 *
 * Gameface does not implement the CDP Memory domain - every command in it,
 * getDOMCounters and prepareForLeakDetection included, returns "wasn't found"
 * on Cohtml 3.2.0.2. Tracing.requestMemoryDump is accepted but returns nothing,
 * and the HeapProfiler allocation-tracking event stream never fires. What does
 * work, and what these tools are built on:
 *
 *  - Runtime.getHeapUsage           - used/total JS heap, cheap and reliable.
 *  - HeapProfiler.collectGarbage    - forces a collection, so a reading taken
 *                                     after it distinguishes retained memory
 *                                     from ordinary garbage.
 *  - CohtmlDebug.getSystemCacheStats - decoded image/texture memory, per image.
 *
 * The texture side matters more than the JS side for game UI, and it behaves in
 * a way worth knowing: removing an <img> from the DOM does NOT drop its texture.
 * The images stay in the alive set at full size until something calls
 * clearCachedUnusedImages, which moves them to the orphaned bucket. A screen
 * that swaps textures repeatedly therefore accumulates GPU memory silently.
 *
 * Sizes reported are decoded GPU cost, not file size: a 424-byte 128x128 PNG is
 * reported as 65536 bytes, which is its width * height * 4.
 *
 * Inline data: URI and SVG backgrounds are not tracked by this cache at all, so
 * an all-inline page reports zero. perf_lint already flags inline assets for a
 * separate reason (they break Instaload).
 */

import { getConnectionManager } from "./connect-browser.js";
import {
  CachedImage,
  CheckMemoryParams,
  CheckMemoryResult,
  GetImageCacheStatsParams,
  GetImageCacheStatsResult,
  MemoryReading,
} from "../types.js";
import { withTimeout } from "../utils/with-timeout.js";
import { createLogger } from "../logger.js";

const log = createLogger("Memory");

const DEFAULT_ITERATIONS = 3;
const DEFAULT_SETTLE_MS = 500;
const GC_SETTLE_MS = 400;

/** Heap growth below this after a forced collection is treated as noise. */
const HEAP_LEAK_THRESHOLD_BYTES = 256 * 1024;

interface CacheStats {
  aliveImagesCount: number;
  aliveTotalBytesUse: number;
  orphanedImagesCount: number;
  orphanedBytesUsed: number;
  aliveImages: CachedImage[];
  orphanedImages: CachedImage[];
}

const EMPTY_CACHE: CacheStats = {
  aliveImagesCount: 0,
  aliveTotalBytesUse: 0,
  orphanedImagesCount: 0,
  orphanedBytesUsed: 0,
  aliveImages: [],
  orphanedImages: [],
};

function requireConnection() {
  const manager = getConnectionManager();
  if (!manager.isConnected()) {
    throw new Error("Not connected to a browser. Please connect first using the connect_browser tool.");
  }
  return manager;
}

/**
 * CohtmlDebug has to be enabled before the cache commands answer. It is safe to
 * call repeatedly, so this just does it rather than tracking state.
 */
async function readCache(manager: ReturnType<typeof requireConnection>): Promise<CacheStats> {
  try {
    await manager.sendRaw("CohtmlDebug.enable");
    const response = await manager.sendRaw("CohtmlDebug.getSystemCacheStats");
    const stats = response?.stats;
    if (!stats) return EMPTY_CACHE;
    return {
      aliveImagesCount: stats.aliveImagesCount ?? 0,
      // Spelled without the trailing "d" by the engine; not a typo here.
      aliveTotalBytesUse: stats.aliveTotalBytesUse ?? 0,
      orphanedImagesCount: stats.orphanedImagesCount ?? 0,
      orphanedBytesUsed: stats.orphanedBytesUsed ?? 0,
      aliveImages: stats.aliveImages || [],
      orphanedImages: stats.orphanedImages || [],
    };
  } catch (error: any) {
    log.warn(`Image cache stats unavailable: ${error.message}`);
    return EMPTY_CACHE;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Reports what the engine's image cache is holding, largest first.
 */
export async function getImageCacheStats(params: GetImageCacheStatsParams): Promise<GetImageCacheStatsResult> {
  const manager = requireConnection();
  const { topN = 20, releaseUnused = false } = params;

  if (releaseUnused) {
    log.info("Releasing unreferenced cached images");
    await manager.sendRaw("CohtmlDebug.enable");
    await manager.sendRaw("CohtmlDebug.clearCachedUnusedImages");
    await new Promise((resolve) => setTimeout(resolve, GC_SETTLE_MS));
  }

  const stats = await readCache(manager);
  const totalBytes = stats.aliveTotalBytesUse + stats.orphanedBytesUsed;

  const largestImages = [...stats.aliveImages].sort((a, b) => b.sizeBytes - a.sizeBytes).slice(0, topN);

  let message: string;
  if (stats.aliveImagesCount === 0 && stats.orphanedImagesCount === 0) {
    message =
      "The image cache is empty. Note that inline data: URI and SVG assets are not tracked here, so a page using only inline art reports zero even though it is using memory.";
  } else {
    message = `${stats.aliveImagesCount} image(s) resident using ${formatBytes(stats.aliveTotalBytesUse)}; ${stats.orphanedImagesCount} orphaned using ${formatBytes(stats.orphanedBytesUsed)}. Sizes are decoded GPU cost, not file size.`;
    if (!releaseUnused && stats.aliveImagesCount > 0) {
      message +=
        " Textures stay resident after their elements are removed from the DOM, so run again with releaseUnused to see how much of this is actually reclaimable.";
    }
  }

  return {
    success: true,
    aliveCount: stats.aliveImagesCount,
    aliveBytes: stats.aliveTotalBytesUse,
    orphanedCount: stats.orphanedImagesCount,
    orphanedBytes: stats.orphanedBytesUsed,
    totalBytes,
    largestImages,
    orphanedImages: [...stats.orphanedImages].sort((a, b) => b.sizeBytes - a.sizeBytes).slice(0, topN),
    released: releaseUnused,
    message,
  };
}

/** Forces a collection, then reads JS heap and texture memory together. */
async function takeReading(manager: ReturnType<typeof requireConnection>, collect: boolean): Promise<MemoryReading> {
  if (collect) {
    try {
      await manager.sendRaw("HeapProfiler.enable");
      await manager.sendRaw("HeapProfiler.collectGarbage");
      await new Promise((resolve) => setTimeout(resolve, GC_SETTLE_MS));
    } catch (error: any) {
      log.warn(`Could not force garbage collection: ${error.message}`);
    }
  }

  const heap = await manager.sendRaw("Runtime.getHeapUsage");
  const cache = await readCache(manager);

  // The node count comes from the page rather than Memory.getDOMCounters,
  // which this engine does not implement.
  let domNodes: number | undefined;
  try {
    const counted = await manager.sendCommand("Runtime", "evaluate", {
      expression: "document.querySelectorAll('*').length",
      returnByValue: true,
    });
    domNodes = counted?.result?.value;
  } catch {
    domNodes = undefined;
  }

  return {
    jsHeapUsedBytes: heap?.usedSize ?? 0,
    jsHeapTotalBytes: heap?.totalSize ?? 0,
    imageCacheAliveBytes: cache.aliveTotalBytesUse,
    imageCacheAliveCount: cache.aliveImagesCount,
    imageCacheOrphanedBytes: cache.orphanedBytesUsed,
    imageCacheOrphanedCount: cache.orphanedImagesCount,
    domNodes,
  };
}

/**
 * Checks memory, optionally as a before/after leak test.
 *
 * Without a trigger this is a single reading. With one, it establishes a
 * baseline after a forced collection, runs the trigger a few times, forces
 * another collection and reports what did not come back - which is the standard
 * way to separate a leak from ordinary garbage.
 */
export async function checkMemory(params: CheckMemoryParams): Promise<CheckMemoryResult> {
  const manager = requireConnection();
  const { trigger, iterations = DEFAULT_ITERATIONS, settleMs = DEFAULT_SETTLE_MS } = params;

  log.info(`Checking memory${trigger ? ` with ${iterations} trigger iteration(s)` : " (single reading)"}`);

  const baseline = await takeReading(manager, true);

  if (!trigger) {
    return {
      success: true,
      baseline,
      iterations: 0,
      suspectedLeak: false,
      findings: [],
      message: `JS heap ${formatBytes(baseline.jsHeapUsedBytes)} used of ${formatBytes(
        baseline.jsHeapTotalBytes
      )}; textures ${formatBytes(baseline.imageCacheAliveBytes)} across ${baseline.imageCacheAliveCount} image(s). Pass a trigger to turn this into a leak test.`,
    };
  }

  for (let i = 0; i < iterations; i++) {
    const result = await withTimeout(
      manager.sendCommand("Runtime", "evaluate", { expression: trigger, returnByValue: true, awaitPromise: true }),
      10000,
      `The trigger expression did not finish within 10s on iteration ${i + 1}`
    );

    if (result?.exceptionDetails) {
      const text = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "unknown error";
      return {
        success: false,
        baseline,
        iterations: i,
        suspectedLeak: false,
        findings: [],
        message: `The trigger threw on iteration ${i + 1}, so no comparison was made.`,
        error: text,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, settleMs));
  }

  const after = await takeReading(manager, true);

  const delta: Partial<MemoryReading> = {
    jsHeapUsedBytes: after.jsHeapUsedBytes - baseline.jsHeapUsedBytes,
    jsHeapTotalBytes: after.jsHeapTotalBytes - baseline.jsHeapTotalBytes,
    imageCacheAliveBytes: after.imageCacheAliveBytes - baseline.imageCacheAliveBytes,
    imageCacheAliveCount: after.imageCacheAliveCount - baseline.imageCacheAliveCount,
    imageCacheOrphanedBytes: after.imageCacheOrphanedBytes - baseline.imageCacheOrphanedBytes,
    imageCacheOrphanedCount: after.imageCacheOrphanedCount - baseline.imageCacheOrphanedCount,
  };

  if (baseline.domNodes !== undefined && after.domNodes !== undefined) {
    delta.domNodes = after.domNodes - baseline.domNodes;
  }

  const findings: string[] = [];
  const heapGrowth = delta.jsHeapUsedBytes ?? 0;
  const textureGrowth = delta.imageCacheAliveBytes ?? 0;
  const nodeGrowth = delta.domNodes ?? 0;

  if (heapGrowth > HEAP_LEAK_THRESHOLD_BYTES) {
    findings.push(
      `JS heap grew by ${formatBytes(heapGrowth)} across ${iterations} iteration(s) and survived a forced collection, which is roughly ${formatBytes(
        heapGrowth / iterations
      )} retained per iteration.`
    );
  }

  if (textureGrowth > 0) {
    findings.push(
      `Texture memory grew by ${formatBytes(textureGrowth)} (${delta.imageCacheAliveCount} image(s)). Note that textures are not released when their elements leave the DOM, so this is expected unless the same art is being reloaded; check with get_image_cache_stats using releaseUnused.`
    );
  }

  if (nodeGrowth > 0) {
    findings.push(`DOM node count grew by ${nodeGrowth} and did not come back down, so the trigger is leaving elements behind.`);
  }

  const suspectedLeak = findings.length > 0;

  return {
    success: true,
    baseline,
    after,
    delta,
    iterations,
    suspectedLeak,
    findings,
    message: suspectedLeak
      ? `Memory did not return to baseline after ${iterations} iteration(s) and a forced collection.`
      : `No retained growth. JS heap moved by ${formatBytes(heapGrowth)} across ${iterations} iteration(s), within normal noise.`,
  };
}
