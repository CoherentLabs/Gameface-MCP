/**
 * Element Interaction Tool
 * 
 * Provides MCP tool for interacting with DOM elements via Chrome DevTools Protocol.
 * Supports: click, type, hover, focus, scrollIntoView, and touch events.
 */

import { getConnectionManager } from "./connect-browser.js";
import { getElementCoordinates, scrollIntoView } from "../utils/interaction-helper.js";
import type { Client } from "chrome-remote-interface";

import { createLogger } from "../logger.js";

const log = createLogger("InteractElement");

export interface InteractElementParams {
  nodeId: number;
  action: "click" | "type" | "hover" | "focus" | "scrollIntoView" | "touch";
  text?: string; // Required for 'type' action
  button?: "left" | "right" | "middle"; // Optional for 'click', defaults to 'left'
  clickCount?: number; // Optional for 'click', defaults to 1
  modifiers?: number; // Keyboard modifiers (bit field: Alt=1, Ctrl=2, Meta=4, Shift=8)
  touchType?: "touchStart" | "touchEnd" | "touchMove" | "touchCancel"; // For 'touch' action
}

export interface InteractElementResult {
  success: boolean;
  action: string;
  nodeId: number;
  message?: string;
  coordinates?: {
    x: number;
    y: number;
  };
}

/**
 * Executes an interaction action on a DOM element identified by its node ID.
 * 
 * Supported actions:
 * - click: Dispatches mouse click at element center
 * - type: Focuses element and inserts text
 * - hover: Moves mouse to element center (triggers :hover)
 * - focus: Sets focus on element
 * - scrollIntoView: Scrolls element into viewport
 * - touch: Dispatches touch event at element center
 * 
 * @param params Interaction parameters including nodeId and action
 * @returns Result with success status and action details
 */
export async function interactElement(
  params: InteractElementParams
): Promise<InteractElementResult> {
  const { nodeId, action, text, button = "left", clickCount = 1, modifiers = 0, touchType = "touchStart" } = params;

  log.info(`Executing ${action} on node ${nodeId}`);

  const manager = getConnectionManager();
  const client = manager.getClient();

  if (!client) {
    throw new Error("Not connected to browser. Call connect_browser first.");
  }

  try {
    switch (action) {
      case "click":
        return await performClick(client, nodeId, button, clickCount, modifiers);

      case "type":
        if (!text) {
          throw new Error("'text' parameter is required for 'type' action");
        }
        return await performType(client, nodeId, text);

      case "hover":
        return await performHover(client, nodeId);

      case "focus":
        return await performFocus(client, nodeId);

      case "scrollIntoView":
        return await performScrollIntoView(client, nodeId);

      case "touch":
        return await performTouch(client, nodeId, touchType, modifiers);

      default:
        throw new Error(`Unknown action: ${action}. Supported: click, type, hover, focus, scrollIntoView, touch`);
    }
  } catch (error) {
    log.error(`Failed to ${action} on node ${nodeId}: ${error}`);
    throw error;
  }
}

/**
 * Performs a mouse click on an element.
 */
async function performClick(
  client: Client,
  nodeId: number,
  button: string,
  clickCount: number,
  modifiers: number
): Promise<InteractElementResult> {
  // Get element coordinates
  const coords = await getElementCoordinates(client, nodeId);

  // Map button string to CDP button type
  const buttonMap = { left: "left", right: "right", middle: "middle" } as const;
  const cdpButton = buttonMap[button as keyof typeof buttonMap] || "left";

  // Dispatch mouse pressed event
  await client.Input.dispatchMouseEvent({
    type: "mousePressed",
    x: coords.centerX,
    y: coords.centerY,
    button: cdpButton,
    clickCount,
    modifiers,
  });

  // Small delay for natural interaction
  //await new Promise((resolve) => setTimeout(resolve, 50));

  // Dispatch mouse released event
  await client.Input.dispatchMouseEvent({
    type: "mouseReleased",
    x: coords.centerX,
    y: coords.centerY,
    button: cdpButton,
    clickCount,
    modifiers,
  });

  log.info(`Clicked button ${button} ${clickCount} time(s) at (${coords.centerX.toFixed(1)}, ${coords.centerY.toFixed(1)})`);

  return {
    success: true,
    action: "click",
    nodeId,
    message: `Clicked button ${button} at (${coords.centerX.toFixed(1)}, ${coords.centerY.toFixed(1)})`,
    coordinates: {
      x: coords.centerX,
      y: coords.centerY,
    },
  };
}

/**
 * Types text into an element (focuses first, then inserts text).
 */
async function performType(
  client: Client,
  nodeId: number,
  text: string
): Promise<InteractElementResult> {
  // Focus the element first
  await client.DOM.focus({ nodeId });

  // Small delay for focus to take effect
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Insert text using Input.insertText (simulates user typing)
  await client.Input.insertText({ text });

  log.info(`Typed "${text}" into node ${nodeId}`);

  return {
    success: true,
    action: "type",
    nodeId,
    message: `Typed text into element: "${text}"`,
  };
}

/**
 * Hovers mouse over an element (triggers :hover CSS state).
 */
async function performHover(
  client: any,
  nodeId: number
): Promise<InteractElementResult> {
  // Get element coordinates
  const coords = await getElementCoordinates(client, nodeId);

  // Dispatch mouse move event to hover position
  await client.Input.dispatchMouseEvent({
    type: "mouseMoved",
    x: coords.centerX,
    y: coords.centerY,
  });

  log.info(`Hovered at (${coords.centerX.toFixed(1)}, ${coords.centerY.toFixed(1)})`);

  return {
    success: true,
    action: "hover",
    nodeId,
    message: `Hovered over element at (${coords.centerX.toFixed(1)}, ${coords.centerY.toFixed(1)})`,
    coordinates: {
      x: coords.centerX,
      y: coords.centerY,
    },
  };
}

/**
 * Sets focus on an element.
 */
async function performFocus(
  client: Client,
  nodeId: number
): Promise<InteractElementResult> {
  await client.DOM.focus({ nodeId });

  log.info(`Focused node ${nodeId}`);

  return {
    success: true,
    action: "focus",
    nodeId,
    message: `Focused element`,
  };
}

/**
 * Scrolls an element into view.
 */
async function performScrollIntoView(
  client: Client,
  nodeId: number
): Promise<InteractElementResult> {
  await scrollIntoView(client, nodeId);

  log.info(`Scrolled node ${nodeId} into view`);

  return {
    success: true,
    action: "scrollIntoView",
    nodeId,
    message: `Scrolled element into view`,
  };
}

/**
 * Dispatches a touch event on an element.
 */
async function performTouch(
  client: Client,
  nodeId: number,
  touchType: "touchStart" | "touchEnd" | "touchMove" | "touchCancel",
  modifiers: number
): Promise<InteractElementResult> {
  // Get element coordinates
  const coords = await getElementCoordinates(client, nodeId);

  // Dispatch touch event
  await client.Input.dispatchTouchEvent({
    type: touchType,
    touchPoints: [
      {
        x: coords.centerX,
        y: coords.centerY,
        radiusX: 1,
        radiusY: 1,
      },
    ],
    modifiers,
  });

  log.info(`Touch ${touchType} at (${coords.centerX.toFixed(1)}, ${coords.centerY.toFixed(1)})`);

  return {
    success: true,
    action: "touch",
    nodeId,
    message: `Touch ${touchType} at (${coords.centerX.toFixed(1)}, ${coords.centerY.toFixed(1)})`,
    coordinates: {
      x: coords.centerX,
      y: coords.centerY,
    },
  };
}
