import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RazzService } from "../services/razz-service.js";
import { ClientOp, ServerOp } from "../protocol.js";

// Mock WebSocket
vi.mock("ws", () => {
  return {
    default: class {
      static OPEN = 1;
      static CLOSED = 3;
      readyState = 1;
      handlers = new Map<string, ((...args: unknown[]) => void)[]>();
      sent: string[] = [];
      closeCalled = false;

      constructor() {
        (globalThis as Record<string, unknown>).__lastMockWs = this;
      }

      on(event: string, handler: (...args: unknown[]) => void) {
        if (!this.handlers.has(event)) this.handlers.set(event, []);
        this.handlers.get(event)!.push(handler);
      }

      send(data: string) {
        this.sent.push(data);
      }

      close() {
        this.closeCalled = true;
        this.readyState = 3;
      }

      emit(event: string, ...args: unknown[]) {
        const handlers = this.handlers.get(event) || [];
        for (const h of handlers) h(...args);
      }

      lastSent(): { op: number; d: unknown } | null {
        if (this.sent.length === 0) return null;
        return JSON.parse(this.sent[this.sent.length - 1]);
      }
    },
  };
});

interface MockWs {
  sent: string[];
  closeCalled: boolean;
  readyState: number;
  emit: (event: string, ...args: unknown[]) => void;
  lastSent: () => { op: number; d: unknown } | null;
}

function getMockWs(): MockWs {
  return (globalThis as Record<string, unknown>).__lastMockWs as MockWs;
}

function simulateAuth(ws: MockWs) {
  ws.emit("open");
  ws.emit("message", Buffer.from(JSON.stringify({ op: ServerOp.Ready, d: { user: { id: "test-agent" } } })));
}

describe("RazzService", () => {
  let service: RazzService;

  beforeEach(() => {
    vi.useFakeTimers();
    service = new RazzService("test-key", "wss://test/ws", "https://test/api");
  });

  afterEach(() => {
    service.destroy();
    vi.useRealTimers();
  });

  describe("connection", () => {
    it("sends auth on connect", async () => {
      const connectPromise = service.ensureConnected();
      const ws = getMockWs();
      simulateAuth(ws);
      await connectPromise;

      const authMsg = JSON.parse(ws.sent[0]);
      expect(authMsg.op).toBe(ClientOp.Authenticate);
      expect(authMsg.d.token).toBe("AGENT:test-key");
    });

    it("sets ready after auth", async () => {
      expect(service.ready).toBe(false);
      const p = service.ensureConnected();
      simulateAuth(getMockWs());
      await p;
      expect(service.ready).toBe(true);
    });

    it("rejects on auth timeout", async () => {
      const p = service.ensureConnected();
      getMockWs();
      vi.advanceTimersByTime(11000);
      await expect(p).rejects.toThrow("Auth timeout");
    });

    it("deduplicates concurrent connect calls", async () => {
      const p1 = service.ensureConnected();
      const p2 = service.ensureConnected();
      const ws = getMockWs();
      simulateAuth(ws);
      await Promise.all([p1, p2]);
      expect(ws.sent.length).toBe(1);
    });
  });

  describe("sendAndWait", () => {
    it("resolves on matching response", async () => {
      const p = service.ensureConnected();
      const ws = getMockWs();
      simulateAuth(ws);
      await p;

      const resultPromise = service.sendAndWait(
        ClientOp.GamePlay,
        { gameType: "dice" },
        ServerOp.GameResult,
      );

      ws.emit("message", Buffer.from(JSON.stringify({
        op: ServerOp.GameResult,
        d: { won: true, roll: 73 },
      })));

      expect(await resultPromise).toEqual({ won: true, roll: 73 });
    });

    it("rejects on timeout", async () => {
      const p = service.ensureConnected();
      simulateAuth(getMockWs());
      await p;

      const rp = service.sendAndWait(
        ClientOp.GamePlay, {}, ServerOp.GameResult, 5000,
      );
      vi.advanceTimersByTime(6000);
      await expect(rp).rejects.toThrow("Timeout");
    });

    it("rejects when not connected", () => {
      expect(
        service.sendAndWait(ClientOp.GamePlay, {}, ServerOp.GameResult),
      ).rejects.toThrow("Not connected");
    });
  });

  describe("error handling", () => {
    it("rejects pending on ServerOp.Error", async () => {
      const p = service.ensureConnected();
      const ws = getMockWs();
      simulateAuth(ws);
      await p;

      const rp = service.sendAndWait(ClientOp.GetBalance, {}, ServerOp.BalanceUpdate);
      ws.emit("message", Buffer.from(JSON.stringify({
        op: ServerOp.Error,
        d: { message: "Rate limited" },
      })));
      await expect(rp).rejects.toThrow("Rate limited");
    });

    it("rejects game pending on GameError", async () => {
      const p = service.ensureConnected();
      const ws = getMockWs();
      simulateAuth(ws);
      await p;

      const rp = service.sendAndWait(ClientOp.GamePlay, {}, ServerOp.GameResult);
      ws.emit("message", Buffer.from(JSON.stringify({
        op: ServerOp.GameError,
        d: { message: "Insufficient balance" },
      })));
      await expect(rp).rejects.toThrow("Insufficient balance");
    });

    it("rejects all pending on connection close", async () => {
      const p = service.ensureConnected();
      const ws = getMockWs();
      simulateAuth(ws);
      await p;

      const r1 = service.waitFor(ServerOp.GameResult, 30000);
      const r2 = service.waitFor(ServerOp.BalanceUpdate, 30000);
      ws.emit("close");

      await expect(r1).rejects.toThrow("Connection closed");
      await expect(r2).rejects.toThrow("Connection closed");
    });
  });

  describe("event listeners", () => {
    it("calls listeners for matching opcodes", async () => {
      const p = service.ensureConnected();
      const ws = getMockWs();
      simulateAuth(ws);
      await p;

      const received: unknown[] = [];
      service.on(ServerOp.GameTick, (data) => received.push(data));
      ws.emit("message", Buffer.from(JSON.stringify({
        op: ServerOp.GameTick,
        d: { phase: "running", multiplier: 1.5 },
      })));
      expect(received).toEqual([{ phase: "running", multiplier: 1.5 }]);
    });

    it("unsubscribes correctly", async () => {
      const p = service.ensureConnected();
      const ws = getMockWs();
      simulateAuth(ws);
      await p;

      const received: unknown[] = [];
      const unsub = service.on(ServerOp.GameTick, (data) => received.push(data));
      ws.emit("message", Buffer.from(JSON.stringify({ op: ServerOp.GameTick, d: { m: 1 } })));
      unsub();
      ws.emit("message", Buffer.from(JSON.stringify({ op: ServerOp.GameTick, d: { m: 2 } })));
      expect(received).toHaveLength(1);
    });
  });

  describe("getBalance (cached)", () => {
    it("fetches and caches balance", async () => {
      const p = service.ensureConnected();
      const ws = getMockWs();
      simulateAuth(ws);
      await p;

      // First call - should sendAndWait
      const balancePromise = service.getBalance();
      // Flush microtasks so ensureConnected() inside getBalance resolves
      // and sendAndWait registers the pending waiter
      await new Promise<void>((r) => queueMicrotask(r));

      ws.emit("message", Buffer.from(JSON.stringify({
        op: ServerOp.BalanceUpdate,
        d: { balances: [{ currency: "SOL", available: "1.5", amount: "1.5" }] },
      })));
      const balance = await balancePromise;
      expect(balance.amount).toBe("1.5");
      expect(balance.currency).toBe("SOL");

      // Second call within TTL - should use cache (no new sendAndWait)
      const balance2 = await service.getBalance();
      expect(balance2.amount).toBe("1.5");
    });

    it("returns 0 when no SOL balance", async () => {
      const p = service.ensureConnected();
      const ws = getMockWs();
      simulateAuth(ws);
      await p;

      const bp = service.getBalance();
      await new Promise<void>((r) => queueMicrotask(r));

      ws.emit("message", Buffer.from(JSON.stringify({
        op: ServerOp.BalanceUpdate,
        d: { balances: [] },
      })));
      const balance = await bp;
      expect(balance.amount).toBe("0");
    });
  });

  describe("send", () => {
    it("returns false when not connected", () => {
      expect(service.send(ClientOp.Heartbeat, {})).toBe(false);
    });

    it("returns true when connected", async () => {
      const p = service.ensureConnected();
      simulateAuth(getMockWs());
      await p;
      expect(service.send(ClientOp.Heartbeat, {})).toBe(true);
    });
  });

  describe("destroy", () => {
    it("rejects pending and closes", async () => {
      const p = service.ensureConnected();
      const ws = getMockWs();
      simulateAuth(ws);
      await p;

      const pending = service.waitFor(ServerOp.GameResult, 30000);
      service.destroy();
      await expect(pending).rejects.toThrow("Connection closed");
      expect(ws.closeCalled).toBe(true);
    });
  });
});
