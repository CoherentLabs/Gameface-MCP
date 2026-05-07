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
  data: string; // base64 encoded image
  format: string;
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
