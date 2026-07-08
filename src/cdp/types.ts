export interface CDPTarget {
  id: string;
  title: string;
  url: string;
  type: string;
  webSocketDebuggerUrl?: string;
}

export interface ParsedArgs {
  command: string;
  positional: string[];
  port?: number;
  out?: string;
  json?: boolean;
  interactive?: boolean;
  harOut?: string;
  record?: boolean;
  duration?: number;
  settle?: number;
  file?: string;
  nested?: boolean;
  har?: string;
  new?: boolean;
  target?: string;
  url?: string;
  role?: string;
  into?: string;
  noScreenshot?: boolean;
  viewport?: string;
  fullPage?: boolean;
  height?: number;
  help?: boolean;
  filterUrl?: string;
  filterStatus?: string;
  filterMethod?: string;
  limit?: number;
  browser?: boolean;
  params?: string;
  waitEvent?: string;
  timeoutMs?: number;
  socket?: string;
}
