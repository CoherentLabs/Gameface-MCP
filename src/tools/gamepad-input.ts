/**
 * Gamepad Input Tool
 *
 * CDP has no gamepad domain, so - like the Gameface E2E framework - this drives
 * a virtual gamepad: navigator.getGamepads is replaced with a function returning
 * window._gamepads, and button/axis state is written straight into those
 * objects. The globals and their shape match the E2E framework's, so pages and
 * helpers written against one work with the other.
 *
 * Gamepad input is polled, and a fixed press length can't suit every page: the
 * Interaction Manager polls on a setInterval (200 ms by default, often set
 * lower) and fires "hold" actions - D-pad navigation among them - on every poll
 * the button is down, so a 210 ms press moves focus twice at 100 ms polling.
 * Since the shim *is* getGamepads(), it sees every read instead. Each reader is
 * told apart by its call site, and one that reads on a regular interval counts
 * as a poller. A press then stays down until every active poller has read it
 * (once by default), and the call returns once each has read the release. An
 * explicit durationMs still gives a plain timed hold, which is also the
 * fallback when the page isn't polling at all.
 *
 * The page is the only source of truth for gamepad state. A reload drops the
 * shim and every virtual gamepad with it; the next call reconnects one.
 */

import { getConnectionManager } from "./connect-browser.js";
import type { ConnectionManager } from "../connection-manager.js";
import {
  beginInputObservation,
  endInputObservation,
  evaluate,
  InputObservation,
  PAGE_WAIT_TIMEOUT_MS,
  readSettledFocus,
  sleep,
} from "../utils/input-observer.js";
import { createLogger } from "../logger.js";

const log = createLogger("GamepadInput");

export const DEFAULT_GAMEPAD_ID = "mcp-gamepad";

/** The E2E framework's press length, used when the page isn't polling. */
const DEFAULT_PRESS_MS = 210;
const DEFAULT_STEP_DELAY_MS = 100;
const DEFAULT_POLLS = 1;

/**
 * How long a synced press waits for the pollers at least; it gets longer when
 * more reads are asked for (see SYNCED_PRESS).
 */
const POLL_WAIT_TIMEOUT_MS = 1000;

/** Slowest polling interval the press timeouts allow for. */
const MAX_POLL_INTERVAL_MS = 1000;

/** Reads from one caller closer together than this belong to the same poll. */
const SAME_POLL_MS = 4;

/**
 * After installing the shim, how long to watch reads to learn the page's
 * pollers: at least the minimum, and until every reader has read twice (which
 * gives its interval), up to the maximum. The Interaction Manager's default
 * interval is 200 ms, so the maximum leaves room for a couple of its polls.
 */
const LEARN_MIN_MS = 300;
const LEARN_MAX_MS = 1000;

export type GamepadButton = string | number;

export type GamepadStep =
  | GamepadButton
  | { buttons: GamepadButton | GamepadButton[]; durationMs?: number; polls?: number }
  | { stick: "left" | "right"; x: number; y: number; durationMs?: number; polls?: number }
  | { waitMs: number };

export interface GamepadInputParams {
  action: "connect" | "disconnect" | "press" | "hold" | "release" | "moveStick" | "resetSticks" | "sequence" | "state";
  gamepadId?: string;
  buttons?: GamepadButton | GamepadButton[];
  durationMs?: number;
  polls?: number;
  stick?: "left" | "right";
  x?: number;
  y?: number;
  steps?: GamepadStep[];
  delayMs?: number;
}

export interface GamepadState {
  id: string;
  pressedButtons: string[];
  axes: number[];
}

/** How a press was timed, so a surprising result can be traced to it. */
export interface PressTiming {
  /** "polls": held until every poller read it. "time": held for a fixed duration. */
  mode: "polls" | "time";
  heldMs: number;
  /** Polling intervals of the pollers the press was synced to, in ms. */
  pollerIntervalsMs?: number[];
  /** Pollers that stopped polling during the press - often deliberate, e.g. a device-detection poll. */
  stoppedPollers?: number;
  /** Set when a poller didn't read the press or its release within the timeout. */
  warning?: string;
}

export interface GamepadInputResult extends InputObservation {
  success: boolean;
  action: string;
  gamepadId: string;
  /** True when this call had to connect the gamepad first. */
  autoConnected: boolean;
  /** State after the call; null once disconnected. */
  gamepad: GamepadState | null;
  /** For press and moveStick with polls. */
  timing?: PressTiming;
  /** For sequences: the timing of and focused element after each step. */
  trail?: { step: string; focused: string | null; timing?: PressTiming }[];
}

/**
 * Standard Gamepad mapping (W3C), the same indices as the E2E framework's
 * gf.GAMEPAD_BUTTONS. Names are the E2E ones, so they are what results report.
 */
const BUTTON_NAMES = [
  "FACE_BUTTON_DOWN",
  "FACE_BUTTON_RIGHT",
  "FACE_BUTTON_LEFT",
  "FACE_BUTTON_TOP",
  "LEFT_SHOULDER",
  "RIGHT_SHOULDER",
  "LEFT_SHOULDER_BOTTOM",
  "RIGHT_SHOULDER_BOTTOM",
  "SELECT",
  "START",
  "LEFT_ANALOGUE_STICK",
  "RIGHT_ANALOGUE_STICK",
  "PAD_UP",
  "PAD_DOWN",
  "PAD_LEFT",
  "PAD_RIGHT",
  "CENTER_BUTTON",
];

/**
 * Aliases, keyed by a normalized name (uppercase, letters and digits only).
 * Xbox face-button names win where they clash with PlayStation ones, so "X" is
 * the left face button and PlayStation's X is "CROSS".
 */
const BUTTON_ALIASES: Record<string, number> = {
  A: 0, CROSS: 0,
  B: 1, CIRCLE: 1,
  X: 2, SQUARE: 2,
  Y: 3, TRIANGLE: 3,
  LB: 4, L1: 4,
  RB: 5, R1: 5,
  LT: 6, L2: 6,
  RT: 7, R2: 7,
  BACK: 8, VIEW: 8, SHARE: 8,
  MENU: 9, OPTIONS: 9,
  LS: 10, L3: 10,
  RS: 11, R3: 11,
  DPADUP: 12, UP: 12,
  DPADDOWN: 13, DOWN: 13,
  DPADLEFT: 14, LEFT: 14,
  DPADRIGHT: 15, RIGHT: 15,
  HOME: 16, GUIDE: 16, PS: 16,
};
BUTTON_NAMES.forEach((name, index) => {
  BUTTON_ALIASES[name.replace(/[^A-Z0-9]/g, "")] = index;
});

function resolveButton(button: GamepadButton): number {
  if (typeof button === "number") {
    if (Number.isInteger(button) && button >= 0 && button < BUTTON_NAMES.length) return button;
    throw new Error(`Gamepad button index ${button} is out of range (0-${BUTTON_NAMES.length - 1}).`);
  }
  const index = BUTTON_ALIASES[button.toUpperCase().replace(/[^A-Z0-9]/g, "")];
  if (index === undefined) {
    throw new Error(
      `Unknown gamepad button "${button}". Use A/B/X/Y, LB/RB/LT/RT, BACK/START, LS/RS, DPAD_UP/DOWN/LEFT/RIGHT, HOME, an E2E name like FACE_BUTTON_DOWN, or an index 0-16.`
    );
  }
  return index;
}

function resolveButtons(buttons: GamepadButton | GamepadButton[] | undefined): number[] {
  const list = Array.isArray(buttons) ? buttons : buttons === undefined ? [] : [buttons];
  if (list.length === 0) {
    throw new Error("'buttons' is required for this action.");
  }
  return list.map(resolveButton);
}

function stickAxes(stick: "left" | "right"): [number, number] {
  return stick === "left" ? [0, 1] : [2, 3];
}

function checkStickValue(name: string, value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value) || value < -1 || value > 1) {
    throw new Error(`'${name}' must be a number between -1 and 1. Received: ${value}`);
  }
  return value;
}

function checkPolls(polls: number | undefined): number {
  if (polls === undefined) return DEFAULT_POLLS;
  if (!Number.isInteger(polls) || polls < 1) {
    throw new Error(`'polls' must be a positive integer. Received: ${polls}`);
  }
  return polls;
}

/** What one press sets while down: some buttons, or a stick's two axes. */
type PressInput = { buttons: number[] } | { axes: Record<number, number> };

// --- Page-side scripts --------------------------------------------------------

/**
 * Installs the shim if needed and connects the gamepad unless it already is.
 * Returns whether it installed the shim (so the pollers are still unknown) and
 * whether it connected the gamepad.
 *
 * The replacement getGamepads() records every read against its caller's stack
 * frame. A caller with a steady interval that has read within about two of them
 * counts as an active poller; one-off reads (a component checking for a pad on
 * mount) and pollers that stopped never do. It is installed over the E2E
 * framework's version too, returning the same window._gamepads array.
 */
const ENSURE_GAMEPAD = (id: string) => `((id) => {
  let installed = false;
  if (!window._gamepads) window._gamepads = [];
  if (!window._getGamepad) window._getGamepad = (gid) => window._gamepads.find((g) => g.id === gid);
  if (!window.__gfMcpPolls) {
    installed = true;
    const polls = { callers: {}, waiters: [] };
    const live = (c, now) => now - c.last <= 2 * c.interval + 50;
    polls.active = (now) => Object.keys(polls.callers).filter((k) => {
      const c = polls.callers[k];
      return c.reads >= 2 && live(c, now);
    });
    // Resolves once every poller has read n more times. A poller that goes
    // quiet meanwhile is dropped rather than waited on: pages stop polling on
    // purpose, e.g. a "last used device" poll that only runs until it sees
    // gamepad input - which this very press provides.
    polls.waitReads = (keys, n, timeoutMs) => new Promise((resolve) => {
      const start = {};
      for (const k of keys) start[k] = polls.callers[k].reads;
      const unread = (k) => polls.callers[k].reads - start[k] < n;
      const t0 = performance.now();
      let settled = false;
      const check = () => {
        if (settled) return true;
        const now = performance.now();
        const waiting = keys.filter((k) => unread(k) && live(polls.callers[k], now));
        if (waiting.length === 0 || now - t0 >= timeoutMs) {
          settled = true;
          clearInterval(timer);
          resolve({
            waitedMs: now - t0,
            missing: waiting.length,
            stopped: keys.filter((k) => unread(k) && !live(polls.callers[k], now)).length,
          });
        }
        return settled;
      };
      polls.waiters.push(check);
      const timer = setInterval(check, 25);
    });
    navigator.getGamepads = () => {
      const now = performance.now();
      const key = ((new Error().stack || "").split("\\n")[2] || "unknown").trim();
      const c = polls.callers[key] || (polls.callers[key] = { reads: 0, last: 0, interval: 0 });
      // Several reads in one go (a loop calling getGamepads() per pad) are one
      // poll; counting each would make the interval look like ~0 ms.
      if (c.reads === 0 || now - c.last >= ${SAME_POLL_MS}) {
        if (c.reads > 0) c.interval = now - c.last;
        c.reads++;
        c.last = now;
        if (polls.waiters.length) polls.waiters = polls.waiters.filter((w) => !w());
      }
      // Laid out by index with null gaps, as browsers do, so
      // getGamepads()[e.gamepad.index] finds the pad.
      const out = [];
      for (const pad of window._gamepads) out[pad.index] = pad;
      for (let i = 0; i < out.length; i++) if (!out[i]) out[i] = null;
      return out;
    };
    window.__gfMcpPolls = polls;
  }
  let connected = false;
  if (!window._getGamepad(id)) {
    // The lowest free index, so a disconnect never leaves two pads sharing one.
    let index = 0;
    while (window._gamepads.some((g) => g.index === index)) index++;
    const pad = {
      id, index, connected: true, mapping: "standard", timestamp: performance.now(),
      axes: [0, 0, 0, 0],
      buttons: Array(${BUTTON_NAMES.length}).fill(null).map(() => ({ pressed: false, touched: false, value: 0 })),
    };
    window._gamepads.push(pad);
    const e = new Event("gamepadconnected");
    e.gamepad = pad;
    window.dispatchEvent(e);
    connected = true;
  }
  return { installed, connected };
})(${JSON.stringify(id)})`;

/** Watches reads until the page's pollers are known; see LEARN_MIN_MS. Returns how many were found. */
const LEARN_POLLERS = `new Promise((resolve) => {
  const polls = window.__gfMcpPolls;
  const t0 = performance.now();
  const check = () => {
    const elapsed = performance.now() - t0;
    const callers = Object.values(polls.callers);
    const known = callers.length > 0 && callers.every((c) => c.reads >= 2);
    if ((elapsed >= ${LEARN_MIN_MS} && known) || elapsed >= ${LEARN_MAX_MS}) {
      resolve(polls.active(performance.now()).length);
    } else {
      setTimeout(check, 50);
    }
  };
  check();
})`;

/** Writes the input into the pad; down=false puts buttons up and sticks back to center. */
const APPLY_INPUT_FN = `(pad, input, down) => {
  if (input.buttons) {
    for (const i of input.buttons) {
      pad.buttons[i].pressed = down;
      pad.buttons[i].touched = down;
      pad.buttons[i].value = down ? 1 : 0;
    }
  } else {
    for (const [axis, value] of Object.entries(input.axes)) pad.axes[axis] = down ? value : 0;
  }
  pad.timestamp = performance.now();
}`;

/**
 * One synced press: snapshot the active pollers, put the input down, wait until
 * each has read it n times, put it up, wait until each has read that. Done in
 * one evaluation so no poll slips in between the steps. With no active pollers
 * it changes nothing and returns null, and the caller falls back to a timed press.
 */
const SYNCED_PRESS = (id: string, input: PressInput, polls: number) => `(async (id, input, n) => {
  const P = window.__gfMcpPolls;
  const pad = window._getGamepad(id);
  if (!pad) throw new Error("Gamepad " + JSON.stringify(id) + " is not connected.");
  const keys = P.active(performance.now());
  if (keys.length === 0) return null;
  // Give each wait two intervals of the slowest poller per read it needs, so
  // polls: 10 at 200 ms isn't cut off at the base timeout.
  const slowest = Math.min(Math.max(...keys.map((k) => P.callers[k].interval)), ${MAX_POLL_INTERVAL_MS});
  const timeoutFor = (reads) => Math.max(${POLL_WAIT_TIMEOUT_MS}, (reads + 1) * 2 * slowest);
  const apply = ${APPLY_INPUT_FN};
  apply(pad, input, true);
  const down = await P.waitReads(keys, n, timeoutFor(n));
  apply(pad, input, false);
  const up = await P.waitReads(keys, 1, timeoutFor(1));
  return {
    heldMs: down.waitedMs,
    intervals: keys.map((k) => Math.round(P.callers[k].interval)),
    missedDown: down.missing,
    missedUp: up.missing,
    stopped: down.stopped + up.stopped,
  };
})(${JSON.stringify(id)}, ${JSON.stringify(input)}, ${polls})`;

/**
 * Upper bound on a synced press's evaluation: both of its waits at their
 * longest (see timeoutFor above), plus slack.
 */
function syncedPressTimeoutMs(polls: number): number {
  const wait = (reads: number) => Math.max(POLL_WAIT_TIMEOUT_MS, (reads + 1) * 2 * MAX_POLL_INTERVAL_MS);
  return wait(polls) + wait(1) + PAGE_WAIT_TIMEOUT_MS;
}

const SET_INPUT = (id: string, input: PressInput, down: boolean) => `((id, input, down) => {
  const pad = window._getGamepad && window._getGamepad(id);
  if (!pad) throw new Error("Gamepad " + JSON.stringify(id) + " is not connected.");
  (${APPLY_INPUT_FN})(pad, input, down);
})(${JSON.stringify(id)}, ${JSON.stringify(input)}, ${down})`;

const DISCONNECT = (id: string) => `((id) => {
  const pads = window._gamepads || [];
  const index = pads.findIndex((g) => g.id === id);
  if (index === -1) return false;
  const [pad] = pads.splice(index, 1);
  pad.connected = false;
  const e = new Event("gamepaddisconnected");
  e.gamepad = pad;
  window.dispatchEvent(e);
  return true;
})(${JSON.stringify(id)})`;

const READ_STATE = (id: string) => `((id) => {
  const pad = window._getGamepad && window._getGamepad(id);
  if (!pad) return null;
  return { pressed: pad.buttons.map((b, i) => (b.pressed ? i : -1)).filter((i) => i >= 0), axes: pad.axes.slice() };
})(${JSON.stringify(id)})`;

/**
 * Installs the shim and connects the gamepad if either is missing. Right after
 * installing, waits to learn the page's pollers - which also gives the page
 * time to react to gamepadconnected before input arrives.
 */
async function ensureGamepad(manager: ConnectionManager, id: string): Promise<{ installed: boolean; connected: boolean }> {
  const ensured = await evaluate(manager, ENSURE_GAMEPAD(id));
  if (ensured.installed) {
    const found = await evaluate(manager, LEARN_POLLERS, true);
    log.info(`Gamepad shim installed; found ${found} poller(s)`);
  }
  return ensured;
}

async function readState(manager: ConnectionManager, id: string): Promise<GamepadState | null> {
  const raw = await evaluate(manager, READ_STATE(id));
  if (!raw) return null;
  return { id, pressedButtons: raw.pressed.map((i: number) => BUTTON_NAMES[i]), axes: raw.axes };
}

/**
 * Presses and releases an input: for a fixed time when durationMs is given,
 * otherwise synced to the page's pollers, falling back to the default time when
 * the page isn't polling.
 */
async function press(
  manager: ConnectionManager,
  id: string,
  input: PressInput,
  durationMs: number | undefined,
  polls: number
): Promise<PressTiming> {
  if (durationMs === undefined) {
    const synced = await evaluate(manager, SYNCED_PRESS(id, input, polls), true, syncedPressTimeoutMs(polls));
    if (synced) {
      const timing: PressTiming = {
        mode: "polls",
        heldMs: Math.round(synced.heldMs),
        pollerIntervalsMs: synced.intervals,
      };
      const missed = [
        synced.missedDown ? `${synced.missedDown} poller(s) didn't read the press` : "",
        synced.missedUp ? `${synced.missedUp} poller(s) didn't read the release` : "",
      ].filter(Boolean);
      if (missed.length) {
        timing.warning =
          `${missed.join(" and ")} in time` +
          (synced.missedUp ? "; the page may still think the input is held." : "; the page may have missed it.");
      }
      if (synced.stopped) {
        timing.stoppedPollers = synced.stopped;
      }
      return timing;
    }
  }

  const heldMs = durationMs ?? DEFAULT_PRESS_MS;
  await evaluate(manager, SET_INPUT(id, input, true));
  await sleep(heldMs);
  await evaluate(manager, SET_INPUT(id, input, false));
  return durationMs === undefined
    ? { mode: "time", heldMs, warning: "The page isn't polling getGamepads(), so the press was held for a fixed time." }
    : { mode: "time", heldMs };
}

function stickInput(stick: "left" | "right", x: number, y: number): PressInput {
  const [ax, ay] = stickAxes(stick);
  return { axes: { [ax]: x, [ay]: y } };
}

function describeStep(step: GamepadStep): string {
  if (typeof step !== "object") return BUTTON_NAMES[resolveButton(step)];
  if ("waitMs" in step) return `wait ${step.waitMs}ms`;
  checkPolls(step.polls);
  if ("stick" in step) {
    return `${step.stick} stick (${checkStickValue("x", step.x)}, ${checkStickValue("y", step.y)})`;
  }
  return resolveButtons(step.buttons).map((i) => BUTTON_NAMES[i]).join("+");
}

async function runSequence(
  manager: ConnectionManager,
  id: string,
  steps: GamepadStep[],
  defaultDurationMs: number | undefined,
  defaultPolls: number,
  delayMs: number
): Promise<NonNullable<GamepadInputResult["trail"]>> {
  // Validate every step before sending anything, so a typo at step 5 doesn't
  // leave the UI four steps into the flow.
  const labels = steps.map(describeStep);
  const trail: NonNullable<GamepadInputResult["trail"]> = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    let timing: PressTiming | undefined;
    if (i > 0) {
      // The previous step may have reloaded or navigated the page, taking the
      // shim and the gamepad with it.
      await ensureGamepad(manager, id);
    }
    if (typeof step !== "object") {
      timing = await press(manager, id, { buttons: [resolveButton(step)] }, defaultDurationMs, defaultPolls);
    } else if ("waitMs" in step) {
      await sleep(step.waitMs);
    } else {
      const input = "stick" in step ? stickInput(step.stick, step.x, step.y) : { buttons: resolveButtons(step.buttons) };
      timing = await press(manager, id, input, step.durationMs ?? defaultDurationMs, step.polls ?? defaultPolls);
    }
    if (delayMs > 0) {
      await sleep(delayMs);
    }
    trail.push({ step: labels[i], focused: await readSettledFocus(manager), ...(timing ? { timing } : {}) });
  }
  return trail;
}

/**
 * Drives a virtual gamepad in the connected page and reports the resulting
 * gamepad state, the events the page received, and where focus ended up.
 */
export async function gamepadInput(params: GamepadInputParams): Promise<GamepadInputResult> {
  const { action, gamepadId = DEFAULT_GAMEPAD_ID, durationMs, delayMs = DEFAULT_STEP_DELAY_MS } = params;
  const polls = checkPolls(params.polls);

  const manager = getConnectionManager();
  if (!manager.isConnected()) {
    throw new Error("Not connected to a browser. Please connect first using the connect_browser tool.");
  }

  log.info(`Gamepad ${gamepadId}: ${action}`);

  await beginInputObservation(manager);

  let autoConnected = false;
  let timing: PressTiming | undefined;
  let trail: GamepadInputResult["trail"];

  if (action === "disconnect") {
    const removed = await evaluate(manager, DISCONNECT(gamepadId));
    if (!removed) {
      throw new Error(`Gamepad "${gamepadId}" is not connected.`);
    }
  } else if (action !== "state") {
    const ensured = await ensureGamepad(manager, gamepadId);
    autoConnected = ensured.connected && action !== "connect";

    switch (action) {
      case "connect":
        break;
      case "press":
        timing = await press(manager, gamepadId, { buttons: resolveButtons(params.buttons) }, durationMs, polls);
        break;
      case "hold":
        await evaluate(manager, SET_INPUT(gamepadId, { buttons: resolveButtons(params.buttons) }, true));
        break;
      case "release":
        await evaluate(manager, SET_INPUT(gamepadId, { buttons: resolveButtons(params.buttons) }, false));
        break;
      case "moveStick": {
        if (!params.stick) {
          throw new Error("'stick' ('left' or 'right') is required for moveStick.");
        }
        const input = stickInput(params.stick, checkStickValue("x", params.x), checkStickValue("y", params.y));
        if (durationMs !== undefined || params.polls !== undefined) {
          // A flick: back to center once the page has seen it.
          timing = await press(manager, gamepadId, input, durationMs, polls);
        } else {
          await evaluate(manager, SET_INPUT(gamepadId, input, true));
        }
        break;
      }
      case "resetSticks":
        await evaluate(manager, SET_INPUT(gamepadId, { axes: { 0: 0, 1: 0, 2: 0, 3: 0 } }, true));
        break;
      case "sequence":
        if (!params.steps || params.steps.length === 0) {
          throw new Error("'steps' is required for sequence.");
        }
        trail = await runSequence(manager, gamepadId, params.steps, durationMs, polls, delayMs);
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  const observation = await endInputObservation(manager);
  const gamepad = await readState(manager, gamepadId);

  return {
    success: true,
    action,
    gamepadId,
    autoConnected,
    gamepad,
    ...(timing ? { timing } : {}),
    ...(trail ? { trail } : {}),
    ...observation,
  };
}
