import WebSocket from "ws";
import { Service } from "../types.js";
import type { IAgentRuntime } from "../types.js";
import { ClientOp, ServerOp } from "../protocol.js";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface BalanceInfo {
  amount: string;
  currency: string;
  raw: unknown;
}

export class RazzService extends Service {
  static serviceType = "razz";
  capabilityDescription = "Persistent connection to Razz games platform";

  private ws: WebSocket | null = null;
  private apiKey: string;
  private wsUrl: string;
  private apiUrl: string;
  private pending = new Map<number, PendingRequest[]>();
  private listeners = new Map<number, ((data: unknown) => void)[]>();
  private _ready = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private connectPromise: Promise<void> | null = null;
  private destroyed = false;
  private reconnectDelay = 1000;
  private readonly maxReconnectDelay = 30000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _initialConnect = true;

  // Cache for providers
  private balanceCache: { data: BalanceInfo; ts: number } | null = null;
  private crashStateCache: { data: unknown; ts: number } | null = null;
  private readonly CACHE_TTL = 30000;

  constructor(apiKey: string, wsUrl: string, apiUrl: string) {
    super();
    this.apiKey = apiKey;
    this.wsUrl = wsUrl;
    this.apiUrl = apiUrl;
  }

  get ready(): boolean {
    return this._ready;
  }

  static async start(runtime: IAgentRuntime): Promise<RazzService> {
    const apiKey = runtime.getSetting("RAZZ_API_KEY");
    if (!apiKey) throw new Error("RAZZ_API_KEY not configured");
    const wsUrl = runtime.getSetting("RAZZ_WS_URL") || "wss://razz.games/ws";
    const apiUrl = runtime.getSetting("RAZZ_API_URL") || "https://razz.games/api";
    const service = new RazzService(apiKey, wsUrl, apiUrl);
    await service.ensureConnected();
    return service;
  }

  async stop(): Promise<void> {
    this.destroy();
  }

  async ensureConnected(): Promise<void> {
    if (this._ready && this.ws?.readyState === WebSocket.OPEN) return;
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this._doConnect();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private _doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.destroyed) {
        reject(new Error("Service destroyed"));
        return;
      }

      const origin = this.wsUrl.replace(/^ws(s?):/, "http$1:").replace(/\/ws$/, "");
      this.ws = new WebSocket(this.wsUrl, { headers: { Origin: origin } });

      const authTimeout = setTimeout(() => {
        reject(new Error("Auth timeout - no Ready response within 10s"));
        this.ws?.close();
      }, 10000);

      this.ws.on("open", () => {
        this.reconnectDelay = 1000;
        this._rawSend(ClientOp.Authenticate, { token: `AGENT:${this.apiKey}` });
      });

      this.ws.on("message", (raw: Buffer) => {
        let msg: { op: number; d: Record<string, unknown> };
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        this._handleMessage(msg.op, msg.d, { authTimeout, resolve });
      });

      this.ws.on("close", () => {
        const wasInitial = this._initialConnect;
        this._cleanup();

        if (wasInitial) {
          reject(new Error("Connection closed before auth completed"));
          return;
        }
        if (!this.destroyed) {
          this._scheduleReconnect();
        }
      });

      this.ws.on("error", (err) => {
        clearTimeout(authTimeout);
        if (this._initialConnect && !this._ready) {
          reject(err);
        }
      });
    });
  }

  private _handleMessage(
    op: number,
    d: Record<string, unknown>,
    auth?: { authTimeout: ReturnType<typeof setTimeout>; resolve: () => void },
  ): void {
    if (op === ServerOp.Ready && auth) {
      clearTimeout(auth.authTimeout);
      this._ready = true;
      this._initialConnect = false;
      this._startHeartbeat();
      auth.resolve();
      return;
    }

    if (op === ServerOp.Error) {
      const errMsg = String(d?.message || d?.error || "Server error");
      this._rejectOldestPending(new Error(errMsg));
      return;
    }

    if (op === ServerOp.GameError) {
      const errMsg = String(d?.message || d?.error || "Game error");
      this._rejectPendingGame(new Error(errMsg));
      return;
    }

    // Resolve matching pending requests
    this._resolvePending(op, d);

    // Notify listeners
    const callbacks = this.listeners.get(op);
    if (callbacks) {
      for (const cb of [...callbacks]) cb(d);
    }
  }

  /** Fire-and-forget send. Returns false if not connected. */
  send(op: number, data: unknown): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ op, d: data }));
    return true;
  }

  sendAndWait<T = unknown>(
    sendOp: number,
    data: unknown,
    expectOp: number,
    timeoutMs = 10000,
  ): Promise<T> {
    if (!this.send(sendOp, data)) {
      return Promise.reject(new Error("Not connected"));
    }
    return this.waitFor<T>(expectOp, timeoutMs);
  }

  waitFor<T = unknown>(expectOp: number, timeoutMs = 10000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._removePending(expectOp, entry);
        reject(new Error(`Timeout waiting for response (op=${expectOp})`));
      }, timeoutMs);

      const entry: PendingRequest = {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      };

      const queue = this.pending.get(expectOp) || [];
      queue.push(entry);
      this.pending.set(expectOp, queue);
    });
  }

  on(op: number, callback: (data: unknown) => void): () => void {
    if (!this.listeners.has(op)) this.listeners.set(op, []);
    this.listeners.get(op)!.push(callback);
    return () => {
      const list = this.listeners.get(op);
      if (list) {
        const idx = list.indexOf(callback);
        if (idx !== -1) list.splice(idx, 1);
      }
    };
  }

  // High-level methods used by providers

  async getBalance(): Promise<BalanceInfo> {
    if (this.balanceCache && Date.now() - this.balanceCache.ts < this.CACHE_TTL) {
      return this.balanceCache.data;
    }
    await this.ensureConnected();
    const data = await this.sendAndWait<{ balances: Array<{ currency: string; available?: string; amount?: string }> }>(
      ClientOp.GetBalance,
      {},
      ServerOp.BalanceUpdate,
      5000,
    );
    const balances = data.balances || [];
    const sol = balances.find(
      (b) => b.currency === "SOL" || b.currency === "sol",
    );
    const result: BalanceInfo = {
      amount: sol ? String(sol.available || sol.amount || "0") : "0",
      currency: "SOL",
      raw: data,
    };
    this.balanceCache = { data: result, ts: Date.now() };
    return result;
  }

  async getCrashState(): Promise<unknown | null> {
    if (this.crashStateCache && Date.now() - this.crashStateCache.ts < this.CACHE_TTL) {
      return this.crashStateCache.data;
    }
    try {
      const data = await this.restGet("/matches/live");
      this.crashStateCache = { data, ts: Date.now() };
      return data;
    } catch {
      return null;
    }
  }

  async restGet<T = unknown>(path: string): Promise<T> {
    const url = `${this.apiUrl}${path}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer AGENT:${this.apiKey}` },
    });
    if (!resp.ok) {
      throw new Error(`GET ${path}: ${resp.status} ${resp.statusText}`);
    }
    return resp.json() as Promise<T>;
  }

  async restPost<T = unknown>(path: string, body: unknown): Promise<T> {
    const url = `${this.apiUrl}${path}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer AGENT:${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      throw new Error(`POST ${path}: ${resp.status} ${resp.statusText}`);
    }
    return resp.json() as Promise<T>;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this._cleanup();
    this.ws?.close();
    this.ws = null;
    this.balanceCache = null;
    this.crashStateCache = null;
  }

  // Internal helpers

  private _rawSend(op: number, data: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }
    this.ws.send(JSON.stringify({ op, d: data }));
  }

  private _resolvePending(op: number, data: unknown): void {
    const queue = this.pending.get(op);
    if (!queue || queue.length === 0) return;
    const entry = queue.shift()!;
    clearTimeout(entry.timer);
    entry.resolve(data);
    if (queue.length === 0) this.pending.delete(op);
  }

  private _rejectPendingGame(err: Error): void {
    for (const op of [ServerOp.GameResult, ServerOp.GameTick]) {
      const queue = this.pending.get(op);
      if (queue && queue.length > 0) {
        const entry = queue.shift()!;
        clearTimeout(entry.timer);
        entry.reject(err);
        if (queue.length === 0) this.pending.delete(op);
        return;
      }
    }
  }

  private _rejectOldestPending(err: Error): void {
    for (const [op, queue] of this.pending) {
      if (queue.length > 0) {
        const entry = queue.shift()!;
        clearTimeout(entry.timer);
        entry.reject(err);
        if (queue.length === 0) this.pending.delete(op);
        return;
      }
    }
  }

  private _removePending(op: number, entry: PendingRequest): void {
    const queue = this.pending.get(op);
    if (!queue) return;
    const idx = queue.indexOf(entry);
    if (idx >= 0) queue.splice(idx, 1);
    if (queue.length === 0) this.pending.delete(op);
  }

  private _rejectAll(reason: string): void {
    for (const [, queue] of this.pending) {
      for (const entry of queue) {
        clearTimeout(entry.timer);
        entry.reject(new Error(reason));
      }
    }
    this.pending.clear();
  }

  private _startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.send(ClientOp.Heartbeat, {});
    }, 30000);
    this.heartbeatTimer.unref();
  }

  private _stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private _cleanup(): void {
    this._stopHeartbeat();
    this._ready = false;
    this._rejectAll("Connection closed");
  }

  private _scheduleReconnect(): void {
    if (this.destroyed) return;
    const jitter = this.reconnectDelay * (0.75 + Math.random() * 0.5);
    this.reconnectTimer = setTimeout(() => {
      this.connectPromise = null;
      this.ensureConnected().catch(() => {});
    }, jitter);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }
}
