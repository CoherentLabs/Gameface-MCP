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
export interface GetConsoleLogsParams {
  clear?: boolean;
  filterLevel?: string;
}

export interface GetConsoleLogsResult {
  logs: Array<{
    type: string;
    args: any[];
    timestamp: number;
    stackTrace?: any;
  }>;
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
  format?: "png" | "jpeg";
  quality?: number;
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
