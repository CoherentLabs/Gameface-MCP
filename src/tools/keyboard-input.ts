/**
 * Keyboard Input Tool
 *
 * Sends key events through the CDP Input domain the same way the Gameface E2E
 * framework does: a keyDown, a separate char event for keys that produce text,
 * then a keyUp. Gameface's keyDown does not synthesize the char event on its
 * own the way Chrome's does, which is why it is sent explicitly.
 */

import { getConnectionManager } from "./connect-browser.js";
import { beginInputObservation, endInputObservation, InputObservation, sleep } from "../utils/input-observer.js";
import { createLogger } from "../logger.js";

const log = createLogger("KeyboardInput");

export interface PressKeyParams {
  key: string | number;
  action?: "press" | "down" | "up";
  modifiers?: number; // Bit field: Alt=1, Ctrl=2, Meta=4, Shift=8
  count?: number;
  delayMs?: number;
  nodeId?: number;
}

export interface PressKeyResult extends InputObservation {
  success: boolean;
  action: string;
  key: string;
  windowsVirtualKeyCode: number;
  count: number;
}

interface ResolvedKey {
  name: string;
  vk: number;
  /** Text the key produces, sent as a char event. Absent for non-text keys. */
  text?: string;
  /** The character needs Shift on a US layout ("A", "?", "!"). */
  shifted?: boolean;
}

const SHIFT_VK = 16;
const SHIFT_MODIFIER = 8;

/**
 * Named keys, keyed by a normalized name (lowercase, no "_" / "-" / spaces) so
 * both DOM key names ("ArrowDown", "Escape") and the E2E framework's gf.KEYS
 * names ("ARROW_DOWN", "ESC") resolve.
 */
const NAMED_KEYS: Record<string, { name: string; vk: number; text?: string }> = {};

function addNamed(names: string[], name: string, vk: number, text?: string) {
  for (const n of names) NAMED_KEYS[normalize(n)] = { name, vk, text };
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[\s_-]/g, "");
}

addNamed(["Backspace"], "Backspace", 8);
addNamed(["Tab"], "Tab", 9);
addNamed(["Enter", "Return", "NUMPAD_ENTER"], "Enter", 13, "\r");
addNamed(["Shift"], "Shift", 16);
addNamed(["Control", "Ctrl"], "Control", 17);
addNamed(["Alt"], "Alt", 18);
addNamed(["Pause"], "Pause", 19);
addNamed(["CapsLock"], "CapsLock", 20);
addNamed(["Escape", "Esc"], "Escape", 27);
addNamed(["Space", "Spacebar"], " ", 32, " ");
addNamed(["PageUp"], "PageUp", 33);
addNamed(["PageDown"], "PageDown", 34);
addNamed(["End"], "End", 35);
addNamed(["Home"], "Home", 36);
addNamed(["ArrowLeft", "Left"], "ArrowLeft", 37);
addNamed(["ArrowUp", "Up"], "ArrowUp", 38);
addNamed(["ArrowRight", "Right"], "ArrowRight", 39);
addNamed(["ArrowDown", "Down"], "ArrowDown", 40);
addNamed(["PrintScreen", "PRINT_SCRN"], "PrintScreen", 44);
addNamed(["Insert"], "Insert", 45);
addNamed(["Delete", "Del"], "Delete", 46);
addNamed(["Meta", "System", "OS"], "Meta", 91);
for (let i = 0; i <= 9; i++) addNamed([`NUMPAD_${i}`], String(i), 96 + i, String(i));
addNamed(["NUMPAD_STAR", "NumpadMultiply"], "*", 106, "*");
addNamed(["NUMPAD_PLUS", "NumpadAdd"], "+", 107, "+");
addNamed(["NUMPAD_DASH", "NumpadSubtract"], "-", 109, "-");
addNamed(["NUMPAD_DOT", "NumpadDecimal"], ".", 110, ".");
addNamed(["NUMPAD_FORWARD_SLASH", "NumpadDivide"], "/", 111, "/");
for (let i = 1; i <= 12; i++) addNamed([`F${i}`], `F${i}`, 111 + i);
addNamed(["NumLock"], "NumLock", 144);
addNamed(["ScrollLock"], "ScrollLock", 145);

/** Punctuation typed with Shift held (US layout); its virtual key is the unshifted key's. */
const SHIFTED_PUNCTUATION = new Set([..."~!@#$%^&*()_+{}|:\"<>?"]);

/** Virtual key codes for punctuation, shifted and unshifted (US layout). */
const PUNCTUATION_VK: Record<string, number> = {
  ";": 186, ":": 186, "=": 187, "+": 187, ",": 188, "<": 188, "-": 189, "_": 189,
  ".": 190, ">": 190, "/": 191, "?": 191, "`": 192, "~": 192, "[": 219, "{": 219,
  "\\": 220, "|": 220, "]": 221, "}": 221, "'": 222, '"': 222,
  ")": 48, "!": 49, "@": 50, "#": 51, "$": 52, "%": 53, "^": 54, "&": 55, "*": 56, "(": 57,
};

function resolveKey(key: string | number): ResolvedKey {
  if (typeof key === "number") {
    // A raw virtual key code, as gf.KEYS hands out. Only the codes that map to
    // text get a char event - sending one for, say, ArrowDown (40) would type "(".
    const named = Object.values(NAMED_KEYS).find((k) => k.vk === key);
    if (named) return { ...named };
    if ((key >= 48 && key <= 57) || (key >= 65 && key <= 90)) {
      return { name: String.fromCharCode(key).toLowerCase(), vk: key, text: String.fromCharCode(key).toLowerCase() };
    }
    return { name: `VK_${key}`, vk: key };
  }

  if ([...key].length === 1) {
    if (/[a-z]/i.test(key)) {
      return { name: key, vk: key.toUpperCase().charCodeAt(0), text: key, shifted: key !== key.toLowerCase() };
    }
    if (/[0-9]/.test(key)) return { name: key, vk: key.charCodeAt(0), text: key };
    if (key === " ") return { name: " ", vk: 32, text: " " };
    // Unmapped characters (accented letters, CJK, emoji...) have no virtual
    // key; the char event alone still delivers the text.
    return { name: key, vk: PUNCTUATION_VK[key] ?? 0, text: key, shifted: SHIFTED_PUNCTUATION.has(key) };
  }

  const named = NAMED_KEYS[normalize(key)];
  if (!named) {
    throw new Error(
      `Unknown key "${key}". Use a single character, a DOM key name (e.g. "Enter", "ArrowDown", "Escape", "F5"), or a virtual key code number.`
    );
  }
  return { ...named };
}

async function dispatch(
  type: "keyDown" | "char" | "keyUp",
  key: ResolvedKey,
  modifiers: number,
  autoRepeat: boolean
): Promise<void> {
  const manager = getConnectionManager();
  // Gameface builds the whole DOM event from the numeric keyIdentifier alone:
  // keyCode is that number, code is its virtual-key name, and key is the number
  // read as a character (so ArrowDown, 40, arrives with key "("). The CDP
  // key/code/text fields are ignored, and without keyIdentifier every event
  // arrives as keyCode 0. Verified on Cohtml 3.2.0.12.
  //
  // The char event carries the character code, the key events the virtual key
  // code - sending 97 on keyDown for "a", as the E2E framework does, makes the
  // page see code "NumPad1".
  // codePointAt, not charCodeAt: an emoji is one code point but two UTF-16
  // units, and charCodeAt would send only the lone high surrogate.
  const code = type === "char" ? key.text!.codePointAt(0)! : key.vk;
  const params: Record<string, any> = {
    type,
    modifiers,
    windowsVirtualKeyCode: code,
    keyIdentifier: code,
  };
  if (autoRepeat) {
    params.autoRepeat = true;
  }
  await manager.sendCommand("Input", "dispatchKeyEvent", params);
}

/**
 * Presses, holds or releases a keyboard key, optionally focusing an element
 * first, and reports the key events the page received and where focus ended up.
 */
export async function pressKey(params: PressKeyParams): Promise<PressKeyResult> {
  const { key, action = "press", count = 1, delayMs = 50, nodeId } = params;
  let modifiers = params.modifiers ?? 0;

  const manager = getConnectionManager();
  if (!manager.isConnected()) {
    throw new Error("Not connected to a browser. Please connect first using the connect_browser tool.");
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`'count' must be a positive integer. Received: ${count}`);
  }

  const resolved = resolveKey(key);
  log.info(`Key ${action} "${resolved.name}" (VK ${resolved.vk}) x${count}`);

  if (nodeId !== undefined) {
    await manager.sendCommand("DOM", "focus", { nodeId });
  }

  await beginInputObservation(manager);

  // A shifted character is typed with Shift held, as on a real keyboard: the
  // Shift flag on every event, and a Shift keydown/keyup around them, which is
  // what the Interaction Manager tracks for combos. Skipped if the caller
  // already asked for Shift and so is driving it themselves.
  const autoShift = !!resolved.shifted && !(modifiers & SHIFT_MODIFIER);
  const shiftKey: ResolvedKey = { name: "Shift", vk: SHIFT_VK };
  if (autoShift) {
    modifiers |= SHIFT_MODIFIER;
    if (action !== "up") {
      await dispatch("keyDown", shiftKey, modifiers, false);
    }
  }

  for (let i = 0; i < count; i++) {
    if (i > 0 && delayMs > 0) {
      await sleep(delayMs);
    }
    // A character with no virtual key code only gets its char event.
    const hasVk = resolved.vk !== 0;
    if (action === "press" || action === "down") {
      // Repeated downs without an up are a held key, which is what autoRepeat
      // marks. Repeated presses are separate keystrokes and don't set it.
      if (hasVk) {
        await dispatch("keyDown", resolved, modifiers, action === "down" && i > 0);
      }
      if (resolved.text !== undefined) {
        await dispatch("char", resolved, modifiers, action === "down" && i > 0);
      }
    }
    if (hasVk && (action === "press" || action === "up")) {
      await dispatch("keyUp", resolved, modifiers, false);
    }
  }

  if (autoShift && action !== "down") {
    await dispatch("keyUp", shiftKey, modifiers & ~SHIFT_MODIFIER, false);
  }

  const observation = await endInputObservation(manager);

  return {
    success: true,
    action,
    key: resolved.name,
    windowsVirtualKeyCode: resolved.vk,
    count,
    ...observation,
  };
}
