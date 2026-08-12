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
