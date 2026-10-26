/**
 * Input Observer
 *
 * Shared by the keyboard and gamepad tools. Records the input events the page
 * actually receives and reports where focus ended up afterwards, so a single
 * press_key / gamepad_input call can answer "did the UI react, and how?"
 * without a follow-up eval_js.
 */

import type { ConnectionManager } from "../connection-manager.js";
import { withTimeout } from "./with-timeout.js";

/** How many recorded events are kept in the page before the oldest are dropped. */
const MAX_RECORDED_EVENTS = 200;

/**
 * Default cap on evaluations that wait on the page (animation frames, timers).
 * Those only advance while the view does, so a paused or hidden view would
 * otherwise hang the tool call forever.
 */
export const PAGE_WAIT_TIMEOUT_MS = 5000;

/** Short CSS-like description of an element, for results. Page-side. */
const DESCRIBE_FN = `(t) => {
  if (!t || t.nodeType !== 1) return t === window ? "window" : t === document ? "document" : null;
  let s = t.tagName.toLowerCase();
  if (t.id) s += "#" + t.id;
  if (typeof t.className === "string" && t.className.trim()) s += "." + t.className.trim().split(/\\s+/).join(".");
  return s;
}`;

/**
 * Installs the recorder once per document. Capture-phase listeners on window see
 * events before page handlers can stopPropagation() them. A reload wipes the
 * recorder along with the rest of the page, so every tool call re-runs this.
 */
const INSTALL_RECORDER = `(() => {
  if (window.__gfMcpInput) return;
  const describe = ${DESCRIBE_FN};
  const rec = { events: [] };
  const push = (entry) => {
    rec.events.push(entry);
    if (rec.events.length > ${MAX_RECORDED_EVENTS}) rec.events.shift();
  };
  for (const type of ["keydown", "keypress", "keyup"]) {
    window.addEventListener(type, (e) => push({
      type, key: e.key, code: e.code, keyCode: e.keyCode, repeat: e.repeat,
      altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey,
      defaultPrevented: e.defaultPrevented, target: describe(e.target),
    }), true);
  }
  for (const type of ["gamepadconnected", "gamepaddisconnected"]) {
    window.addEventListener(type, (e) => push({ type, gamepadId: e.gamepad ? e.gamepad.id : null }), true);
  }
  window.addEventListener("focusin", (e) => push({ type: "focusin", target: describe(e.target) }), true);
  window.__gfMcpInput = rec;
})()`;

/**
 * Upper bound on frames to wait for focus to land. UIs often move focus a frame
 * or two after the input that caused it (a tab switch blurs the old tab, then
 * focuses the new one later), and reading in between reports nothing focused.
 */
const MAX_SETTLE_FRAMES = 15;
const DEFAULT_SETTLE_FRAMES = 2;

/**
 * Waits a couple of animation frames so rAF-driven handlers have run - and up
 * to MAX_SETTLE_FRAMES while nothing is focused - then reports the focused
 * element with its element-child-index path from documentElement. With drain,
 * it also takes the recorded events. A missing recorder means the input
 * reloaded or navigated the page, which is reported rather than thrown.
 */
const SETTLE = (settleFrames: number, drain: boolean) => `new Promise((resolve) => {
  const describe = ${DESCRIBE_FN};
  let frame = 0;
  const tick = () => {
    const el = document.activeElement;
    const unfocused = !el || el === document.body || el === document.documentElement;
    if (frame < ${settleFrames} || (unfocused && frame < ${MAX_SETTLE_FRAMES})) {
      frame++;
      requestAnimationFrame(tick);
      return;
    }
    let focused = null;
    if (!unfocused) {
      const path = [];
      let cur = el;
      while (cur && cur !== document.documentElement) {
        const parent = cur.parentElement;
        if (!parent) break;
        let i = 0;
        while (i < parent.children.length && parent.children[i] !== cur) i++;
        path.unshift(i);
        cur = parent;
      }
      focused = {
        selector: describe(el),
        tagName: el.tagName,
        text: (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 80),
        path: cur === document.documentElement ? path : null,
      };
    }
    const rec = window.__gfMcpInput;
    resolve({ events: rec && ${drain} ? rec.events.splice(0) : [], focused, pageReloaded: !rec });
  };
  tick();
})`;

export interface RecordedInputEvent {
  type: string;
  [key: string]: any;
}

export interface FocusedElementInfo {
  /** CDP node ID, usable with the other tools. Absent if it couldn't be mapped. */
  nodeId?: number;
  selector: string;
  tagName: string;
  text: string;
}

export interface InputObservation {
  /** Input events the page received during the call, in order. */
  events: RecordedInputEvent[];
  /** The element focused once input settled, or null when nothing (or body) is. */
  focused: FocusedElementInfo | null;
  /** Set when the input reloaded or navigated the page; events from before that are lost. */
  pageReloaded?: boolean;
}

/**
 * Runs a Runtime.evaluate and unwraps its value, turning an exception in the
 * page into a thrown Error. Evaluations that await a promise get a timeout.
 */
export async function evaluate(
  manager: ConnectionManager,
  expression: string,
  awaitPromise = false,
  timeoutMs = PAGE_WAIT_TIMEOUT_MS
): Promise<any> {
  const command = manager.sendCommand("Runtime", "evaluate", { expression, returnByValue: true, awaitPromise });
  const result = awaitPromise
    ? await withTimeout(
        command,
        timeoutMs,
        `The page did not respond within ${timeoutMs} ms. Its animation frames and timers may not be advancing - is the view paused or hidden?`
      )
    : await command;
  if (result?.exceptionDetails) {
    const text = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Unknown exception";
    throw new Error(text);
  }
  return result?.result?.value;
}

/**
 * Installs the recorder if needed and drops anything it recorded before this
 * call, so the observation only covers the input about to be sent.
 */
export async function beginInputObservation(manager: ConnectionManager): Promise<void> {
  await evaluate(manager, INSTALL_RECORDER);
  await evaluate(manager, "window.__gfMcpInput.events.length = 0");
}

/** Lets the page settle and returns a short description of the focused element, or null. */
export async function readSettledFocus(manager: ConnectionManager): Promise<string | null> {
  const settled = await evaluate(manager, SETTLE(DEFAULT_SETTLE_FRAMES, false), true);
  return settled?.focused?.selector ?? null;
}

/**
 * Lets the page settle, then returns what it received and where focus is.
 *
 * DOM.requestNode returns nothing usable against Gameface (see assertions.ts),
 * so the focused element is mapped to a nodeId the other way round: its
 * element-child-index path is read in JS and walked through DOM.getDocument.
 */
export async function endInputObservation(
  manager: ConnectionManager,
  settleFrames = DEFAULT_SETTLE_FRAMES
): Promise<InputObservation> {
  const collected = await evaluate(manager, SETTLE(settleFrames, true), true);
  const events: RecordedInputEvent[] = collected?.events ?? [];
  const pageReloaded = collected?.pageReloaded ? { pageReloaded: true } : {};
  const raw = collected?.focused;
  if (!raw) {
    return { events, focused: null, ...pageReloaded };
  }

  const focused: FocusedElementInfo = { selector: raw.selector, tagName: raw.tagName, text: raw.text };
  if (Array.isArray(raw.path)) {
    const doc = await manager.sendCommand("DOM", "getDocument", { depth: -1 });
    let node = (doc?.root?.children || []).find((c: any) => c.nodeType === 1);
    for (const index of raw.path) {
      node = (node?.children || []).filter((c: any) => c.nodeType === 1)[index];
    }
    if (node && node.nodeName === raw.tagName) {
      focused.nodeId = node.nodeId;
    }
  }
  return { events, focused, ...pageReloaded };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
