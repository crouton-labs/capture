import WebSocket from "ws";

function httpEndpoint(endpoint) {
  const url = new URL(endpoint);
  if (url.protocol === "ws:" || url.protocol === "wss:") return null;
  url.pathname = url.pathname.replace(/\/$/, "");
  return url;
}

async function resolveWebSocketUrl(endpoint, { create = false } = {}) {
  if (endpoint.startsWith("ws://") || endpoint.startsWith("wss://")) return endpoint;
  const base = httpEndpoint(endpoint);
  if (!base) throw new Error(`Unsupported CDP endpoint: ${endpoint}`);
  if (create) {
    const created = await fetch(new URL("/json/new?about:blank", base), { method: "PUT" });
    if (created.ok) return (await created.json()).webSocketDebuggerUrl;
  }
  const listed = await fetch(new URL("/json/list", base));
  if (!listed.ok) throw new Error(`CDP target list failed: ${listed.status} ${listed.statusText}`);
  const targets = await listed.json();
  const target = targets.find((item) => item.type === "page") ?? targets[0];
  if (!target?.webSocketDebuggerUrl) throw new Error("CDP endpoint has no debuggable target");
  return target.webSocketDebuggerUrl;
}

/** Connects to one CDP target. `send` accepts any protocol method, including session-scoped calls. */
export async function connect(endpoint, options = {}) {
  const webSocketUrl = await resolveWebSocketUrl(endpoint, options);
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  const subscribers = new Map();
  let nextId = 1;
  let closed = false;

  socket.on("message", (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (message.id !== undefined) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(Object.assign(new Error(message.error.message ?? "CDP error"), { code: message.error.code, data: message.error.data }));
      else waiter.resolve(message.result ?? {});
      return;
    }
    const handlers = subscribers.get(message.method);
    if (handlers) for (const handler of [...handlers]) handler(message.params ?? {}, message);
    const wildcard = subscribers.get("*");
    if (wildcard) for (const handler of [...wildcard]) handler(message.params ?? {}, message);
  });
  const rejectAll = (error) => { for (const { reject } of pending.values()) reject(error); pending.clear(); };
  socket.once("error", rejectAll);
  socket.once("close", () => { closed = true; rejectAll(new Error("CDP connection closed")); });
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });

  return {
    webSocketUrl,
    send(method, params = {}, { sessionId } = {}) {
      if (closed || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("CDP connection is not open"));
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }), (error) => { if (error) { pending.delete(id); reject(error); } });
      });
    },
    on(method, handler) {
      const handlers = subscribers.get(method) ?? new Set();
      handlers.add(handler); subscribers.set(method, handlers);
      return () => { handlers.delete(handler); if (!handlers.size) subscribers.delete(method); };
    },
    async close() { if (closed) return; await new Promise((resolve) => { socket.once("close", resolve); socket.close(); }); },
  };
}

export { resolveWebSocketUrl };
