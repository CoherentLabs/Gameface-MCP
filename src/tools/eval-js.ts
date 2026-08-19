import { getConnectionManager } from "./connect-browser.js";
import { EvalJsParams, EvalJsResult } from "../types.js";
import { createLogger } from "../logger.js";

const log = createLogger("EvalJs");

/**
 * MCP tool implementation for executing arbitrary JavaScript
 * Uses Runtime.evaluate to execute JavaScript code in the browser context
 * Supports await for promises, return by value, and timeout
 */
export async function evalJs(params: EvalJsParams): Promise<EvalJsResult> {
  const manager = getConnectionManager();

  // Check if connected
  if (!manager.isConnected()) {
    throw new Error("Not connected to a browser. Please connect first using the connect_browser tool.");
  }

  const { 
    expression, 
    awaitPromise = false, 
    returnByValue = true,
    timeout 
  } = params;

  // Validate expression parameter
  if (!expression || expression.trim() === "") {
    throw new Error("'expression' parameter is required and cannot be empty");
  }

  try {
    log.info(`Evaluating JavaScript expression${awaitPromise ? " (awaiting promise)" : ""}`);
    log.debug(`Expression: ${expression.substring(0, 100)}${expression.length > 100 ? "..." : ""}`);

    // Prepare evaluation options
    const evaluateOptions: any = {
      expression,
      awaitPromise,
      returnByValue,
    };

    // Add timeout if specified
    if (timeout !== undefined && timeout > 0) {
      evaluateOptions.timeout = timeout;
      log.debug(`Using timeout: ${timeout}ms`);
    }

    // Execute the evaluation
    const result = await manager.sendCommand("Runtime", "evaluate", evaluateOptions);

    if (!result) {
      throw new Error("Failed to evaluate expression - no response returned");
    }

    // Check for evaluation exceptions
    if (result.exceptionDetails) {
      log.warn(`JavaScript evaluation threw an exception: ${JSON.stringify(result.exceptionDetails)}`);
      
      const exceptionText = result.exceptionDetails.exception?.description || 
                           result.exceptionDetails.text || 
                           "Unknown exception";

      return {
        success: false,
        type: "exception",
        description: exceptionText,
        exceptionDetails: result.exceptionDetails,
      };
    }

    // Extract the result value
    const resultObject = result.result;
    if (!resultObject) {
      throw new Error("Failed to evaluate expression - no result object returned");
    }

    // Parse the result based on type
    let value: any;
    if (returnByValue) {
      value = resultObject.value;
    } else {
      // If not returning by value, we got an object reference
      value = resultObject.objectId ? `[Object: ${resultObject.objectId}]` : resultObject.description;
    }

    log.info(`JavaScript evaluation successful (type: ${resultObject.type})`);
    log.debug(`Result: ${JSON.stringify(value)?.substring(0, 200)}`);

    return {
      success: true,
      type: resultObject.type,
      value,
      description: resultObject.description,
    };
  } catch (error: any) {
    log.error(`Failed to evaluate JavaScript: ${error.message}`);
    throw error;
  }
}
