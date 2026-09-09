import { getConnectionManager } from "./connect-browser.js";
import { createLogger } from "../logger.js";
import {
  DataBindAttributePayload,
  DataBindingAttribute,
  DataBindingElement,
  DataBindingIssue,
  DataBindingModelInfo,
  DataBindingMutator,
  GetDataBindingModelsParams,
  GetDataBindingModelsResult,
  InspectDataBindingsParams,
  InspectDataBindingsResult,
  SetDataBindingModelParams,
  SetDataBindingModelResult,
  SetDataBindingValueParams,
  SetDataBindingValueResult,
  SyncDataBindingModelsParams,
  SyncDataBindingModelsResult,
} from "../types.js";

const log = createLogger("DataBindings");

/**
 * Data binding tooling for Gameface.
 *
 * Everything here is built on the five data-binding commands Gameface adds to
 * the CDP DOM domain plus the DOM.dataBindingModelsSynchronized event. They are
 * absent from upstream Chrome's protocol descriptor, so they go out through
 * ConnectionManager.sendRaw() rather than the typed domain objects.
 *
 * Behaviour below was verified against Cohtml 3.2.0.2. The engine-side quirks
 * that shaped this code:
 *
 *  - DOM.updateDataBindingValue only accepts scalars. Objects, arrays and null
 *    come back with succeeded:false and leave the model untouched. Structured
 *    values have to go through DOM.importDataBindingModels instead.
 *  - Neither updateDataBindingValue nor importDataBindingModels touches the
 *    rendered DOM on its own. The DOM only catches up after
 *    engine.synchronizeModels(), and for a value edit the owning model has to
 *    be marked dirty with engine.updateWholeModel() first.
 *  - engine.updateWholeModel() takes the model OBJECT. Handing it the model's
 *    name as a string silently does nothing.
 *  - engine.unregisterModel() takes the model object too, and passing a string
 *    crashes the Player process outright - so this file never calls it.
 */

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Any attribute the binding system owns starts with this prefix. */
const DATA_BIND_PREFIX = "data-bind";

/**
 * The engine reports an expression it couldn't resolve to a model property with
 * this valueType (and an empty evaluatedValue), rather than as a hard error.
 */
const INVALID_VALUE_TYPE = "invalid";

function requireConnection() {
  const manager = getConnectionManager();
  if (!manager.isConnected()) {
    throw new Error("Not connected to a browser. Please connect first using the connect_browser tool.");
  }
  return manager;
}

/**
 * Trims a model value down to something safe to hand back through MCP. Real
 * game models can hold thousands of entries; without this a single call to read
 * "all models" can dwarf everything else in the conversation.
 */
function summarize(
  value: any,
  limits: { maxDepth: number; maxArrayItems: number; maxStringLength: number },
  depth: number,
  state: { truncated: boolean }
): any {
  if (typeof value === "string") {
    if (value.length > limits.maxStringLength) {
      state.truncated = true;
      return `${value.slice(0, limits.maxStringLength)}...<${value.length - limits.maxStringLength} more chars>`;
    }
    return value;
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (depth >= limits.maxDepth) {
    state.truncated = true;
    return Array.isArray(value) ? `<array of ${value.length}, depth limit reached>` : "<object, depth limit reached>";
  }

  if (Array.isArray(value)) {
    const kept = value.slice(0, limits.maxArrayItems).map((v) => summarize(v, limits, depth + 1, state));
    if (value.length > limits.maxArrayItems) {
      state.truncated = true;
      kept.push(`<${value.length - limits.maxArrayItems} more items>`);
    }
    return kept;
  }

  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = summarize(v, limits, depth + 1, state);
  }
  return out;
}

/**
 * Splits a binding path like "Player.items[0].name" into its root model name
 * ("Player") and the rest. The root is what has to be marked dirty for the DOM
 * to pick up an edit.
 */
function rootModelOf(path: string): string {
  const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(path.trim());
  return match ? match[0] : "";
}

/**
 * Reads the value a binding path points at out of an already-fetched model,
 * so a write can be reported as the before/after of that one property rather
 * than of the whole model. Returns undefined if the path doesn't resolve.
 */
function valueAtPath(model: any, path: string): any {
  // Everything after the root model name, as a list of property/index steps.
  const steps = path
    .trim()
    .slice(rootModelOf(path).length)
    .replace(/\[\s*"([^"]*)"\s*\]/g, ".$1")
    .replace(/\[\s*'([^']*)'\s*\]/g, ".$1")
    .replace(/\[\s*(\d+)\s*\]/g, ".$1")
    .split(".")
    .filter((s) => s.length > 0);

  let current = model;
  for (const step of steps) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = current[step];
  }
  return current;
}

/**
 * Classifies each known model by whether the page has a global of the same
 * name. Models created from JavaScript (engine.createJSModel, or imported via
 * this server) become page globals; a model the engine knows about with no such
 * global is one registered outside the page, i.e. from the game's C++ side.
 */
async function classifyModels(manager: ReturnType<typeof requireConnection>, names: string[]): Promise<DataBindingModelInfo[]> {
  if (names.length === 0) {
    return [];
  }

  try {
    const result = await manager.sendCommand("Runtime", "evaluate", {
      expression: `(${JSON.stringify(names)}).map(n => { const v = window[n]; return v !== undefined && v !== null; })`,
      returnByValue: true,
    });

    const flags: boolean[] = result?.result?.value || [];
    return names.map((name, i) => ({ name, source: flags[i] ? "js" : "engine" } as DataBindingModelInfo));
  } catch (error: any) {
    // Classification is a convenience, never a reason to fail the read.
    log.warn(`Could not classify models as js/engine: ${error.message}`);
    return names.map((name) => ({ name, source: "engine" } as DataBindingModelInfo));
  }
}

/**
 * Lists the data-binding models the engine currently holds and, unless only
 * names were asked for, their live values.
 */
export async function getDataBindingModels(params: GetDataBindingModelsParams): Promise<GetDataBindingModelsResult> {
  const manager = requireConnection();
  const { modelName, namesOnly = false, maxDepth = 6, maxArrayItems = 50, maxStringLength = 500 } = params;

  log.info(`Reading data binding models (modelName: ${modelName || "all"}, namesOnly: ${namesOnly})`);

  const namesResponse = await manager.sendRaw("DOM.getDataBindingModelNames");
  const modelNames: string[] = namesResponse?.models || [];
  const modelInfo = await classifyModels(manager, modelNames);

  if (namesOnly) {
    return {
      success: true,
      modelNames,
      modelInfo,
      truncated: false,
      message: modelNames.length
        ? `${modelNames.length} model(s) registered.`
        : "No data binding models are registered. Nothing has called engine.createJSModel and no C++ model is bound.",
    };
  }

  if (modelName && !modelNames.includes(modelName)) {
    return {
      success: false,
      modelNames,
      modelInfo,
      truncated: false,
      message: `No model named "${modelName}". Registered models: ${modelNames.length ? modelNames.join(", ") : "(none)"}.`,
    };
  }

  // Both parameters are optional; omitting modelName returns every model.
  // verbose had no observable effect on Cohtml 3.2.0.2 but is part of the
  // command's signature, so it is passed through as the engine defines it.
  const raw = await manager.sendRaw("DOM.getDataBindingModels", modelName ? { modelName, verbose: false } : { verbose: false });

  const state = { truncated: false };
  const models = summarize(raw || {}, { maxDepth, maxArrayItems, maxStringLength }, 0, state);

  return {
    success: true,
    modelNames,
    models,
    modelInfo,
    truncated: state.truncated,
    message: state.truncated
      ? "Model data was trimmed to stay a reasonable size. Raise maxDepth/maxArrayItems/maxStringLength, or pass modelName, to see more."
      : `Read ${Object.keys(models).length} model(s).`,
  };
}

/**
 * Turns one raw dataBindAttributes entry into a reported attribute plus the
 * problems it carries. The engine surfaces four distinct failure modes and they
 * mean quite different things to whoever is debugging:
 *
 *  - parsingError:     the {{ }} expression is not valid binding syntax.
 *  - compilationError: it parsed but could not be compiled into a mutator.
 *  - evaluationError:  it ran but hit something like a missing property.
 *  - valueType "invalid": it resolved to nothing, which is what an unknown
 *    model or property looks like when no explicit error is attached.
 */
function analyzeAttribute(payload: DataBindAttributePayload): { attribute: DataBindingAttribute; issues: DataBindingIssue[] } {
  const issues: DataBindingIssue[] = [];
  const mutators: DataBindingMutator[] = [];

  for (const mutator of payload.mutators || []) {
    if (mutator.parsingError) {
      issues.push({
        severity: "error",
        attribute: payload.attributeName,
        detail: `Binding expression could not be parsed: ${mutator.parsingError}. Note that Gameface parses these attributes itself, so raw < and > have to be written as &lt; and &gt; inside HTML.`,
      });
    }

    if (mutator.compilationError) {
      issues.push({
        severity: "error",
        attribute: payload.attributeName,
        detail: `Binding expression could not be compiled: ${mutator.compilationError}`,
      });
    }

    const expressions = (mutator.evaluationNodes || []).map((node) => {
      if (node.evaluationError) {
        issues.push({
          severity: "error",
          attribute: payload.attributeName,
          expression: node.evaluatableExpression,
          detail: `Evaluation failed: ${node.evaluationError}`,
        });
      } else if (node.valueType === INVALID_VALUE_TYPE) {
        issues.push({
          severity: "error",
          attribute: payload.attributeName,
          expression: node.evaluatableExpression,
          detail: "Expression resolved to nothing. The model or the property it names does not exist on the engine side.",
        });
      }

      if (!node.syncStatus) {
        issues.push({
          severity: "warning",
          attribute: payload.attributeName,
          expression: node.evaluatableExpression,
          detail: "Value has not been synchronized into the DOM. Run sync_data_binding_models, or call engine.synchronizeModels() in the page.",
        });
      }

      return {
        expression: node.evaluatableExpression,
        value: node.evaluatedValue,
        valueType: node.valueType,
        inSync: node.syncStatus,
        evaluationError: node.evaluationError,
      };
    });

    mutators.push({
      parsingError: mutator.parsingError,
      compilationError: mutator.compilationError,
      expressions,
    });
  }

  // An attribute that names a binding but produced no mutator at all was never
  // wired up - worth flagging, because it renders as silently doing nothing.
  if ((payload.mutators || []).length === 0 && payload.attributeValue.includes("{{")) {
    issues.push({
      severity: "warning",
      attribute: payload.attributeName,
      detail: "Attribute contains a {{ }} expression but the engine built no mutator for it, so it is inert.",
    });
  }

  return {
    attribute: { name: payload.attributeName, value: payload.attributeValue, mutators },
    issues,
  };
}

/** Attribute arrays arrive from CDP flattened as [name, value, name, value, ...]. */
function attributePairs(attributes: string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; attributes && i < attributes.length; i += 2) {
    out[attributes[i]] = attributes[i + 1];
  }
  return out;
}

/** Depth-first walk of a DOM.getDocument tree, collecting every element node. */
function collectElements(node: any, into: any[]): void {
  if (!node) {
    return;
  }
  if (node.nodeType === 1) {
    into.push(node);
  }
  for (const child of node.children || []) {
    collectElements(child, into);
  }
  for (const child of node.shadowRoots || []) {
    collectElements(child, into);
  }
  if (node.contentDocument) {
    collectElements(node.contentDocument, into);
  }
}

/**
 * Reports the live state of data-bind attributes: what each expression
 * currently evaluates to, and which ones are broken.
 *
 * With no nodeId and no selector this sweeps the whole document for elements
 * carrying a data-bind-* attribute, which is the quickest way to find why a
 * screen isn't showing what the model says it should.
 */
export async function inspectDataBindings(params: InspectDataBindingsParams): Promise<InspectDataBindingsResult> {
  const manager = requireConnection();
  const { nodeId, selector, onlyProblems = false, maxElements = 100 } = params;

  log.info(`Inspecting data bindings (nodeId: ${nodeId ?? "none"}, selector: ${selector || "none"}, onlyProblems: ${onlyProblems})`);

  let candidates: Array<{ nodeId: number; tag: string; id?: string; className?: string }> = [];

  if (nodeId !== undefined) {
    const described = await manager.sendCommand("DOM", "describeNode", { nodeId });
    const node = described?.node;
    const attrs = attributePairs(node?.attributes);
    candidates = [{ nodeId, tag: node?.nodeName || "?", id: attrs.id, className: attrs.class }];
  } else {
    // DOM.getDocument has to run before any nodeId is meaningful, and it also
    // hands back every element's attributes in one round trip - so the whole
    // document sweep needs no per-element describeNode call.
    const doc = await manager.sendCommand("DOM", "getDocument", { depth: -1 });
    const root = doc?.root;
    if (!root) {
      throw new Error("Failed to read the document - DOM.getDocument returned no root node.");
    }

    if (selector) {
      const found = await manager.sendCommand("DOM", "querySelectorAll", { nodeId: root.nodeId, selector });
      const ids: number[] = found?.nodeIds || [];
      const all: any[] = [];
      collectElements(root, all);
      const byId = new Map<number, any>(all.map((n) => [n.nodeId, n]));
      candidates = ids.map((id) => {
        const node = byId.get(id);
        const attrs = attributePairs(node?.attributes);
        return { nodeId: id, tag: node?.nodeName || "?", id: attrs.id, className: attrs.class };
      });
    } else {
      const all: any[] = [];
      collectElements(root, all);
      candidates = all
        .filter((node) => {
          const attrs = node.attributes || [];
          for (let i = 0; i < attrs.length; i += 2) {
            if (attrs[i].startsWith(DATA_BIND_PREFIX)) {
              return true;
            }
          }
          return false;
        })
        .map((node) => {
          const attrs = attributePairs(node.attributes);
          return { nodeId: node.nodeId, tag: node.nodeName, id: attrs.id, className: attrs.class };
        });
    }
  }

  const elementsScanned = candidates.length;
  const truncated = elementsScanned > maxElements;
  const elements: DataBindingElement[] = [];
  let errorCount = 0;
  let warningCount = 0;

  for (const candidate of candidates.slice(0, maxElements)) {
    let payloads: DataBindAttributePayload[];
    try {
      const response = await manager.sendRaw("DOM.getDataBindingDataForNode", { nodeId: candidate.nodeId });
      payloads = response?.dataBindAttributes || [];
    } catch (error: any) {
      // Nodes the binding system regenerates (data-bind-for children, for one)
      // can go stale between the tree read and this call. Skip rather than
      // abandon the whole sweep.
      log.warn(`Could not read bindings for node ${candidate.nodeId}: ${error.message}`);
      continue;
    }

    const attributes: DataBindingAttribute[] = [];
    const issues: DataBindingIssue[] = [];
    for (const payload of payloads) {
      const analyzed = analyzeAttribute(payload);
      attributes.push(analyzed.attribute);
      issues.push(...analyzed.issues);
    }

    errorCount += issues.filter((i) => i.severity === "error").length;
    warningCount += issues.filter((i) => i.severity === "warning").length;

    if (attributes.length === 0 && nodeId === undefined) {
      continue;
    }
    if (onlyProblems && issues.length === 0) {
      continue;
    }

    elements.push({ ...candidate, attributes, issues });
  }

  const message = errorCount
    ? `${errorCount} binding error(s) and ${warningCount} warning(s) across ${elementsScanned} bound element(s).`
    : warningCount
    ? `No binding errors. ${warningCount} warning(s) across ${elementsScanned} bound element(s).`
    : elementsScanned === 0
    ? "No elements with data-bind-* attributes were found."
    : `All ${elementsScanned} bound element(s) are healthy.`;

  return {
    success: true,
    elementsScanned,
    elementsReported: elements.length,
    elements,
    errorCount,
    warningCount,
    truncated,
    message: truncated ? `${message} Only the first ${maxElements} were inspected; raise maxElements to see the rest.` : message,
  };
}

/**
 * Marks models dirty and runs a synchronization pass, then waits for the engine
 * to confirm it. This is what actually moves model values into the rendered DOM.
 */
async function synchronize(
  manager: ReturnType<typeof requireConnection>,
  modelNames: string[],
  timeout: number
): Promise<{ updated: string[]; skipped: string[]; synchronized: boolean }> {
  const before = manager.getDataBindingSyncCount();

  // engine.updateWholeModel wants the model object, not its name - a string
  // argument is accepted and silently does nothing. Looking the object up as
  // window[name] also keeps the model name out of the evaluated source.
  const expression = `(() => {
    const names = ${JSON.stringify(modelNames)};
    const updated = [], skipped = [];
    for (const name of names) {
      const model = window[name];
      if (model && typeof model === 'object') {
        engine.updateWholeModel(model);
        updated.push(name);
      } else {
        skipped.push(name);
      }
    }
    engine.synchronizeModels();
    return { updated, skipped };
  })()`;

  const result = await manager.sendCommand("Runtime", "evaluate", { expression, returnByValue: true });

  if (result?.exceptionDetails) {
    const text = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "unknown error";
    throw new Error(`Synchronization failed in the page: ${text}`);
  }

  const value = result?.result?.value || { updated: [], skipped: [] };
  const synchronized = await manager.waitForDataBindingSync(before, timeout);

  return { updated: value.updated || [], skipped: value.skipped || [], synchronized };
}

/**
 * Writes a single scalar into a bound model and pushes it to the DOM.
 *
 * Only scalars go through DOM.updateDataBindingValue - the engine rejects
 * objects, arrays and null. Use set_data_binding_model for those.
 */
export async function setDataBindingValue(params: SetDataBindingValueParams): Promise<SetDataBindingValueResult> {
  const manager = requireConnection();
  const { path, value, synchronize: shouldSync = true } = params;

  if (!path || path.trim() === "") {
    throw new Error("'path' parameter is required and cannot be empty");
  }

  const rootModel = rootModelOf(path);
  if (!rootModel) {
    throw new Error(`'${path}' does not start with a model name. Paths look like "Player.health" or "Player.items[0].name".`);
  }

  if (value === null || typeof value === "object") {
    throw new Error(
      "The engine's updateDataBindingValue command only accepts scalar values (string, number, boolean). " +
        "To set an object, an array or null, replace the whole model with set_data_binding_model instead."
    );
  }

  // Strings need to reach the engine quoted, or the parse fails. Numbers and
  // booleans go through as bare literals.
  const newValue = typeof value === "string" ? JSON.stringify(value) : String(value);

  const readValue = async () => {
    try {
      const raw = await manager.sendRaw("DOM.getDataBindingModels", { modelName: rootModel, verbose: false });
      return valueAtPath(raw?.[rootModel], path);
    } catch {
      return undefined;
    }
  };

  const previousValue = await readValue();

  log.info(`Setting ${path} = ${newValue}`);
  const response = await manager.sendRaw("DOM.updateDataBindingValue", { path, newValue });

  if (!response?.succeeded) {
    const names = (await manager.sendRaw("DOM.getDataBindingModelNames"))?.models || [];
    const hint = names.includes(rootModel)
      ? `Model "${rootModel}" exists, so the rest of the path is what the engine could not resolve. Check it against the model with get_data_binding_models.`
      : `There is no model named "${rootModel}". Registered models: ${names.length ? names.join(", ") : "(none)"}.`;

    return {
      success: false,
      path,
      rootModel,
      previousValue,
      synchronized: false,
      message: `The engine refused the write to ${path}. ${hint}`,
    };
  }

  let synchronized = false;
  if (shouldSync) {
    const result = await synchronize(manager, [rootModel], 2000);
    synchronized = result.synchronized;
  }

  const currentValue = await readValue();

  return {
    success: true,
    path,
    rootModel,
    previousValue,
    currentValue,
    synchronized,
    message: shouldSync
      ? synchronized
        ? `Set ${path} and synchronized "${rootModel}" into the DOM.`
        : `Set ${path}, but the engine did not report a synchronization pass within 2s. The model holds the new value; the DOM may not show it yet.`
      : `Set ${path} on the model. The DOM will not show it until a synchronization pass runs - call sync_data_binding_models.`,
  };
}

/**
 * Creates or wholly replaces one or more models, then synchronizes.
 *
 * This is the tool for standing up mock models to develop a screen against
 * without the game running, and for resetting a model to a known state. It goes
 * through DOM.importDataBindingModels, which - unlike engine.createJSModel -
 * both creates models that don't exist yet and overwrites ones that do,
 * including nested objects and arrays.
 *
 * The replacement is wholesale: keys absent from `data` are dropped from the
 * model.
 */
export async function setDataBindingModel(params: SetDataBindingModelParams): Promise<SetDataBindingModelResult> {
  const manager = requireConnection();
  const { modelName, data, models, synchronize: shouldSync = true } = params;

  let payload: Record<string, any>;

  if (models && Object.keys(models).length > 0) {
    payload = models;
  } else if (modelName) {
    if (data === undefined) {
      throw new Error("'data' is required when 'modelName' is given.");
    }
    payload = { [modelName]: data };
  } else {
    throw new Error("Pass either 'modelName' with 'data' for a single model, or 'models' as a name-to-data object for several.");
  }

  for (const name of Object.keys(payload)) {
    if (!IDENTIFIER.test(name)) {
      throw new Error(`"${name}" is not usable as a model name. Binding expressions reference models as plain identifiers, e.g. "Player".`);
    }
    const value = payload[name];
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Model "${name}" must be a plain object of properties. Got ${Array.isArray(value) ? "an array" : String(value)}.`);
    }
  }

  const written = Object.keys(payload);
  log.info(`Writing ${written.length} model(s): ${written.join(", ")}`);

  await manager.sendRaw("DOM.importDataBindingModels", { modelsJSON: payload });

  let synchronized = false;
  if (shouldSync) {
    const result = await synchronize(manager, written, 2000);
    synchronized = result.synchronized;
  }

  const modelNames: string[] = (await manager.sendRaw("DOM.getDataBindingModelNames"))?.models || [];
  const readBack = await manager.sendRaw("DOM.getDataBindingModels", { verbose: false });
  const state = { truncated: false };
  const filtered: Record<string, any> = {};
  for (const name of written) {
    filtered[name] = summarize(readBack?.[name], { maxDepth: 6, maxArrayItems: 50, maxStringLength: 500 }, 0, state);
  }

  return {
    success: true,
    modelNames,
    written,
    models: filtered,
    synchronized,
    message: shouldSync
      ? synchronized
        ? `Wrote ${written.join(", ")} and synchronized into the DOM.`
        : `Wrote ${written.join(", ")}, but the engine did not report a synchronization pass within 2s.`
      : `Wrote ${written.join(", ")}. Call sync_data_binding_models to push them into the DOM.`,
  };
}

/**
 * Runs a synchronization pass so the DOM catches up with the models.
 *
 * Needed after editing a model from JavaScript, and after any value write made
 * with synchronize:false.
 */
export async function syncDataBindingModels(params: SyncDataBindingModelsParams): Promise<SyncDataBindingModelsResult> {
  const manager = requireConnection();
  const { modelName, timeout = 2000 } = params;

  const known: string[] = (await manager.sendRaw("DOM.getDataBindingModelNames"))?.models || [];

  let targets: string[];
  if (modelName) {
    if (!known.includes(modelName)) {
      return {
        success: false,
        updated: [],
        skipped: [],
        synchronized: false,
        message: `No model named "${modelName}". Registered models: ${known.length ? known.join(", ") : "(none)"}.`,
      };
    }
    targets = [modelName];
  } else {
    targets = known;
  }

  log.info(`Synchronizing ${targets.length} model(s)`);
  const { updated, skipped, synchronized } = await synchronize(manager, targets, timeout);

  const skipNote = skipped.length
    ? ` Skipped ${skipped.join(", ")} - no page-side object to mark dirty, which is normal for a model registered from C++; the game updates those itself.`
    : "";

  return {
    success: true,
    updated,
    skipped,
    synchronized,
    message: synchronized
      ? `Synchronized. Marked ${updated.length} model(s) dirty.${skipNote}`
      : `Ran a synchronization pass but the engine did not confirm one within ${timeout}ms.${skipNote}`,
  };
}
