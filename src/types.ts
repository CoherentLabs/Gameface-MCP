/**
 * Shared TypeScript interfaces for MCP tool parameters and responses
 */

// Launch Browser Tool
export interface LaunchBrowserParams {
  executablePath: string;
  args?: string[];
  url?: string;
  port?: number;
}

export interface LaunchBrowserResult {
  success: boolean;
  port: number;
  pid?: number;
  message: string;
  cohtmlVersion?: string;
  versionWarning?: string;
}

// Connect Browser Tool
export interface ConnectBrowserParams {
  port: number;
  host?: string;
  targetId?: string;
}

export interface ConnectBrowserResult {
  success: boolean;
  message: string;
  targetInfo?: any;
  cohtmlVersion?: string;
  versionWarning?: string;
}

// Console Logs Tool
export interface ConsoleMessage {
  type: string;
  args: any[];
  timestamp: number;
  stackTrace?: any;
}

export interface LogEntry {
  source: string;
  level: string;
  text: string;
  timestamp: number;
  url?: string;
  lineNumber?: number;
  stackTrace?: any;
  category?: string;
  networkRequestId?: string;
  workerId?: string;
  args?: any[];
}

export interface GetConsoleLogsParams {
  clear?: boolean;
  filterLevel?: string;
}

export interface GetConsoleLogsResult {
  logs: Array<ConsoleMessage | LogEntry>;
}

// DOM Snapshot Tool
export interface GetDomSnapshotParams {
  depth?: number;
  selector?: string;
}

export interface DomNode {
  nodeId: number;
  nodeName: string;
  nodeType: number;
  nodeValue?: string;
  attributes?: Record<string, string>;
  childNodeIds?: number[];
}

export interface GetDomSnapshotResult {
  nodes: DomNode[];
}

// Computed Styles Tool
export interface GetComputedStylesParams {
  nodeId: number;
  propertyNames?: string[];
}

export interface GetComputedStylesResult {
  styles: Record<string, string>;
}

// Interact Element Tool
export interface InteractElementParams {
  nodeId: number;
  action: "click" | "type" | "hover" | "focus" | "scrollIntoView" | "dispatchTouchEvent";
  text?: string;
  x?: number;
  y?: number;
}

export interface InteractElementResult {
  success: boolean;
  message: string;
}

// Screenshot Tool
export interface TakeScreenshotParams {
  fullPage?: boolean;
  clipArea?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface TakeScreenshotResult {
  type: "image";
  data: string; // base64 encoded image
  mimeType: "image/png";
  annotations?: Record<string, any>;
  _meta?: Record<string, any>;
}

// Search DOM Tool
export interface SearchDomParams {
  query: string;
  includeUserAgentShadowDOM?: boolean;
  maxResults?: number;
}

export interface SearchDomNode {
  nodeId: number;
  nodeName: string;
  nodeType: number;
  attributes?: Record<string, string>;
}

export interface SearchDomResult {
  resultCount: number;
  nodes: SearchDomNode[];
}

// Navigate Tool
export interface NavigateParams {
  url: string;
  waitUntil?: "documentUpdated";
}

export interface NavigateResult {
  success: boolean;
  url: string;
  frameId: string;
  loaderId?: string;
  errorText?: string;
}

// Eval JS Tool
export interface EvalJsParams {
  expression: string;
  awaitPromise?: boolean;
  returnByValue?: boolean;
  timeout?: number;
}

export interface EvalJsResult {
  success: boolean;
  type: string;
  value?: any;
  description?: string;
  exceptionDetails?: any;
}

// Gameface Get Status Tool
export interface GamefaceGetStatusParams {
  // No parameters needed
}

export interface GamefaceGetStatusResult {
  connected: boolean;
  host?: string;
  port?: number;
  message: string;
  cohtmlVersion?: string;
  versionWarning?: string;
}

// Gameface Restart Tool
export interface GamefaceRestartParams {
  // No parameters needed - uses stored launch/connection parameters
}

export interface GamefaceRestartResult {
  success: boolean;
  message: string;
  port?: number;
  pid?: number;
}

// Shared geometry type for assertion tools
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

// Assert Text Fits Tool
export interface AssertTextFitsParams {
  nodeId: number;
}

export interface AssertTextFitsResult {
  success: boolean;
  fits: boolean;
  overflowX: number;
  overflowY: number;
  measurements: {
    scrollWidth: number;
    scrollHeight: number;
    clientWidth: number;
    clientHeight: number;
  };
  message: string;
}

// Assert No Overlap Tool
export interface AssertNoOverlapParams {
  nodeIdA: number;
  nodeIdB: number;
}

export interface AssertNoOverlapResult {
  success: boolean;
  overlaps: boolean;
  rectA: Rect;
  rectB: Rect;
  overlapRect?: Rect;
  message: string;
}

// Search Gameface Docs Tool
export interface SearchGamefaceDocsParams {
  query: string;
  topic?: string;
  severity?: string;
  maxResults?: number;
}

export interface GamefaceDocResult {
  file: string;
  topic?: string;
  type?: string;
  severity?: string;
  source?: string;
  heading: string;
  content: string;
  score: number;
}

export interface SearchGamefaceDocsResult {
  resultCount: number;
  results: GamefaceDocResult[];
}

// Assert Within Parent Tool
export interface AssertWithinParentParams {
  nodeId: number;
  containerNodeId?: number;
  useViewport?: boolean;
}

export interface AssertWithinParentResult {
  success: boolean;
  within: boolean;
  elementRect: Rect;
  containerRect: Rect;
  overflow: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  };
  message: string;
}

// Perf Lint Tool
export interface PerfLintParams {
  selector?: string;
}

export interface PerfLintViolation {
  rule: string;
  selector: string;
  detail: string;
}

export interface PerfLintResult {
  success: boolean;
  violations: PerfLintViolation[];
  elementsScanned: number;
  /**
   * How many elements the engine will put in their own stacking context, and
   * why. Reported as a summary rather than per-element violations because the
   * common causes (position, overflow) are ubiquitous and mostly unavoidable;
   * the count is the signal, since each context is a separate paint grouping.
   */
  stackingContexts?: {
    total: number;
    byCause: Record<string, number>;
  };
  error?: string;
}

// Perf Measure Tool
export interface PerfMeasureParams {
  frames?: number;
  warmup?: number;
}

export interface PerfMeasureResult {
  success: boolean;
  timedOut?: boolean;
  error?: string;
  p50?: number;
  p95?: number;
  p99?: number;
  sampleCount?: number;
  resolution?: { width: number; height: number };
  resolutionMatchesBaseline?: boolean;
  cohtmlVersion?: string;
  cohtmlVersionMatchesBaseline?: boolean;
  noiseFloor?: {
    p50: { min: number; max: number };
    p95: { min: number; max: number };
    p99: { min: number; max: number };
  };
  withinNoiseFloor?: {
    p50: boolean;
    p95: boolean;
    p99: boolean;
  };
}

// ---------------------------------------------------------------------------
// Data Binding Tools
//
// These wrap Gameface's own additions to the CDP DOM domain
// (DOM.getDataBindingModelNames / getDataBindingModels /
// getDataBindingDataForNode / updateDataBindingValue / importDataBindingModels
// plus the DOM.dataBindingModelsSynchronized event). None of them exist in
// upstream Chrome, so they are sent as raw CDP methods.
// ---------------------------------------------------------------------------

/** Raw DOM.getDataBindingDataForNode payload shapes, as the engine returns them. */
export interface DataBindNodePayload {
  evaluatableExpression: string;
  evaluatedValue: string;
  valueType: string;
  syncStatus: boolean;
  evaluationError?: string;
}

export interface MutatorPayload {
  parsingError?: string;
  compilationError?: string;
  evaluationNodes: DataBindNodePayload[];
}

export interface DataBindAttributePayload {
  attributeName: string;
  attributeValue: string;
  mutators: MutatorPayload[];
}

// Get Data Binding Models Tool
export interface GetDataBindingModelsParams {
  modelName?: string;
  namesOnly?: boolean;
  maxDepth?: number;
  maxArrayItems?: number;
  maxStringLength?: number;
}

export interface DataBindingModelInfo {
  name: string;
  /**
   * "js" when a page global with the model's name exists, meaning the model was
   * created from JavaScript (engine.createJSModel / an imported mock).
   * "engine" when the engine knows the model but the page has no such global,
   * which is what a model registered from C++ looks like from here.
   * This is a heuristic based on global presence, not a flag the engine reports.
   */
  source: "js" | "engine";
}

export interface GetDataBindingModelsResult {
  success: boolean;
  modelNames: string[];
  models?: Record<string, any>;
  modelInfo: DataBindingModelInfo[];
  truncated: boolean;
  message?: string;
}

// Inspect Data Bindings Tool
export interface InspectDataBindingsParams {
  nodeId?: number;
  selector?: string;
  onlyProblems?: boolean;
  maxElements?: number;
}

export interface DataBindingIssue {
  severity: "error" | "warning";
  attribute: string;
  expression?: string;
  detail: string;
}

export interface DataBindingExpression {
  expression: string;
  value: string;
  valueType: string;
  inSync: boolean;
  evaluationError?: string;
}

export interface DataBindingMutator {
  parsingError?: string;
  compilationError?: string;
  expressions: DataBindingExpression[];
}

export interface DataBindingAttribute {
  name: string;
  value: string;
  mutators: DataBindingMutator[];
}

export interface DataBindingElement {
  nodeId: number;
  tag: string;
  id?: string;
  className?: string;
  attributes: DataBindingAttribute[];
  issues: DataBindingIssue[];
}

export interface InspectDataBindingsResult {
  success: boolean;
  elementsScanned: number;
  elementsReported: number;
  elements: DataBindingElement[];
  errorCount: number;
  warningCount: number;
  truncated: boolean;
  message?: string;
}

// Set Data Binding Value Tool
export interface SetDataBindingValueParams {
  path: string;
  value: string | number | boolean;
  synchronize?: boolean;
}

export interface SetDataBindingValueResult {
  success: boolean;
  path: string;
  rootModel: string;
  previousValue?: any;
  currentValue?: any;
  synchronized: boolean;
  message: string;
}

// Set Data Binding Model Tool (create or replace whole models)
export interface SetDataBindingModelParams {
  modelName?: string;
  data?: any;
  models?: Record<string, any>;
  synchronize?: boolean;
}

export interface SetDataBindingModelResult {
  success: boolean;
  modelNames: string[];
  written: string[];
  models?: Record<string, any>;
  synchronized: boolean;
  message: string;
}

// Sync Data Binding Models Tool
export interface SyncDataBindingModelsParams {
  modelName?: string;
  timeout?: number;
}

export interface SyncDataBindingModelsResult {
  success: boolean;
  updated: string[];
  skipped: string[];
  synchronized: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Performance Profile / Trace Tools
//
// perf_profile measures and stops; perf_trace breaks the measurement down but
// only once the user has set a budget (see src/perf-budget.ts). The split is
// deliberate: trace output has no natural stopping point, so the per-phase
// data is withheld until a human has said what "fast enough" means.
// ---------------------------------------------------------------------------

export interface PerfProfileParams {
  durationMs?: number;
  sampleRuns?: number;
  targetFps?: number;
}

export interface PerfProfileResult {
  success: boolean;
  /** Summed engine cost per frame. The number the budget is set against. */
  uiCostPerFrameMs: number;
  /** Half-range across the sampled captures: the smallest change that could be
   *  called real rather than run-to-run variance. */
  repeatabilityPct: number;
  framePeriodMs: number;
  framesPerSecond: number;
  capturesTaken: number;
  warmupDiscarded: number;
  budgetSet: boolean;
  budgetMs?: number;
  budgetPath: string;
  budgetDeclined?: boolean;
  /** null when no budget exists, so "not over budget" is never inferred. */
  withinBudget: boolean | null;
  /** Addressed to the user, not the agent. Relay verbatim. */
  userMessage?: string;
  message: string;
}

export interface PerfTraceParams {
  durationMs?: number;
  systems?: string[];
  level?: number;
  sampleRuns?: number;
}

export interface PerfTracePhase {
  name: string;
  category: string;
  /** Cost with nested child phases subtracted - what a change to this phase
   *  alone would actually move. Ranking and actionability use this. */
  selfPerFrameUs: number;
  /** Cost including nested children, for context only. */
  totalPerFrameUs: number;
  repeatabilityPct: number;
  minUs: number;
  maxUs: number;
  shareOfOverspendPct: number;
  /** Large enough to close part of the gap, and above its own noise floor. */
  actionable: boolean;
}

export interface PerfTraceResult {
  success: boolean;
  budgetSet: boolean;
  budgetMs?: number;
  budgetPath: string;
  uiCostPerFrameMs?: number;
  repeatabilityPct?: number;
  withinBudget?: boolean;
  overBudgetByMs?: number;
  phases: PerfTracePhase[];
  actionablePhases?: string[];
  capturesTaken: number;
  framesPerSecond?: number;
  counters?: Record<string, { first: number; last: number; delta: number }>;
  availableSystems?: string[];
  userMessage?: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Memory Tools
//
// The CDP Memory domain is not implemented by Gameface (every command returns
// "wasn't found"), so these are built on Runtime.getHeapUsage,
// HeapProfiler.collectGarbage and CohtmlDebug.getSystemCacheStats instead.
// ---------------------------------------------------------------------------

export interface CachedImage {
  name: string;
  sizeBytes: number;
}

export interface GetImageCacheStatsParams {
  topN?: number;
  releaseUnused?: boolean;
}

export interface GetImageCacheStatsResult {
  success: boolean;
  aliveCount: number;
  aliveBytes: number;
  orphanedCount: number;
  orphanedBytes: number;
  totalBytes: number;
  largestImages: CachedImage[];
  orphanedImages: CachedImage[];
  released: boolean;
  message: string;
}

export interface CheckMemoryParams {
  trigger?: string;
  iterations?: number;
  settleMs?: number;
}

export interface MemoryReading {
  jsHeapUsedBytes: number;
  jsHeapTotalBytes: number;
  imageCacheAliveBytes: number;
  imageCacheAliveCount: number;
  imageCacheOrphanedBytes: number;
  imageCacheOrphanedCount: number;
  domNodes?: number;
}

export interface CheckMemoryResult {
  success: boolean;
  baseline: MemoryReading;
  after?: MemoryReading;
  delta?: Partial<MemoryReading>;
  iterations: number;
  suspectedLeak: boolean;
  findings: string[];
  message: string;
  error?: string;
}
