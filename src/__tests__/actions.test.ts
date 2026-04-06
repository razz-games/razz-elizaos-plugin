import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IAgentRuntime, Memory } from "../types.js";
import { RazzService } from "../services/razz-service.js";
import { ClientOp, ServerOp } from "../protocol.js";

function createMockService() {
  const svc = Object.create(RazzService.prototype);
  svc.ensureConnected = vi.fn().mockResolvedValue(undefined);
  svc.sendAndWait = vi.fn();
  svc.send = vi.fn().mockReturnValue(true);
  svc.waitFor = vi.fn();
  svc.on = vi.fn().mockReturnValue(() => {});
  svc.getBalance = vi.fn();
  svc.getCrashState = vi.fn();
  svc.destroy = vi.fn();
  return svc as RazzService & {
    sendAndWait: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
    waitFor: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    getBalance: ReturnType<typeof vi.fn>;
    getCrashState: ReturnType<typeof vi.fn>;
  };
}

function createRuntime(service: RazzService): IAgentRuntime {
  return {
    agentId: "test-agent",
    getSetting: (key: string) => key === "RAZZ_API_KEY" ? "test-key" : undefined,
    getService: <T>(_name: string) => service as unknown as T,
  };
}

function makeMessage(text: string): Memory {
  return {
    entityId: "user-1",
    content: { text },
    roomId: "room-1",
  };
}

// Import actions
const { playDiceAction } = await import("../actions/play-dice.js");
const { playFlipAction } = await import("../actions/play-flip.js");
const { playCrashAction } = await import("../actions/play-crash.js");
const { checkBalanceAction } = await import("../actions/check-balance.js");
const { sendMessageAction } = await import("../actions/send-message.js");
const { getLeaderboardAction } = await import("../actions/get-leaderboard.js");
const { balanceProvider } = await import("../providers/balance-provider.js");
const { gameStateProvider } = await import("../providers/game-state-provider.js");

describe("Actions", () => {
  let mockService: ReturnType<typeof createMockService>;
  let runtime: IAgentRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    runtime = createRuntime(mockService);
  });

  describe("playDiceAction", () => {
    it("validates service exists", async () => {
      const valid = await playDiceAction.validate(runtime, makeMessage(""));
      expect(valid).toBe(true);
    });

    it("validates false when service missing", async () => {
      const rt: IAgentRuntime = {
        agentId: "test",
        getSetting: () => undefined,
        getService: () => null,
      };
      const valid = await playDiceAction.validate(rt, makeMessage(""));
      expect(valid).toBe(false);
    });

    it("handler returns success on win", async () => {
      mockService.sendAndWait.mockResolvedValueOnce({
        won: true, roll: 73, payout: 0.0196,
      });

      const result = await playDiceAction.handler(
        runtime, makeMessage("Roll dice for 0.01 SOL"),
      );
      expect(result).toBeDefined();
      expect((result as { success: boolean }).success).toBe(true);
      expect((result as { text: string }).text).toContain("73");
      expect((result as { text: string }).text).toContain("won");
    });

    it("handler returns error on failure", async () => {
      mockService.sendAndWait.mockRejectedValueOnce(
        new Error("Insufficient balance"),
      );

      const result = await playDiceAction.handler(
        runtime, makeMessage("Roll dice"),
      );
      expect((result as { success: boolean }).success).toBe(false);
      expect((result as { error: string }).error).toBe("Insufficient balance");
    });

    it("handler handles non-Error throws", async () => {
      mockService.sendAndWait.mockRejectedValueOnce("string error");

      const result = await playDiceAction.handler(
        runtime, makeMessage("Roll dice"),
      );
      expect((result as { error: string }).error).toBe("Unknown error");
    });

    it("parses wager from message text", async () => {
      mockService.sendAndWait.mockResolvedValueOnce({ won: false, roll: 23, payout: 0 });

      await playDiceAction.handler(runtime, makeMessage("Roll dice for 0.05 SOL"));

      expect(mockService.sendAndWait).toHaveBeenCalledWith(
        ClientOp.GamePlay,
        { gameType: "dice", wagerAmount: 0.05, currency: "SOL" },
        ServerOp.GameResult,
        10000,
      );
    });

    it("calls callback when provided", async () => {
      mockService.sendAndWait.mockResolvedValueOnce({ won: true, roll: 88, payout: 0 });
      const callback = vi.fn().mockResolvedValue([]);

      await playDiceAction.handler(runtime, makeMessage("dice"), undefined, undefined, callback);
      expect(callback).toHaveBeenCalledWith({ text: expect.stringContaining("88") });
    });
  });

  describe("playFlipAction", () => {
    it("handler returns success", async () => {
      mockService.sendAndWait.mockResolvedValueOnce({
        won: true, outcome: "heads", payout: 0.098,
      });

      const result = await playFlipAction.handler(
        runtime, makeMessage("Flip coin 0.05 SOL"),
      );
      expect((result as { success: boolean }).success).toBe(true);
      expect((result as { text: string }).text).toContain("Heads");
    });

    it("handler shows loss", async () => {
      mockService.sendAndWait.mockResolvedValueOnce({
        won: false, outcome: "tails", payout: 0,
      });

      const result = await playFlipAction.handler(
        runtime, makeMessage("Flip"),
      );
      expect((result as { text: string }).text).toContain("Tails");
      expect((result as { text: string }).text).toContain("you lose");
    });
  });

  describe("playCrashAction", () => {
    it("joins room, places bet, waits for result", async () => {
      mockService.sendAndWait.mockResolvedValueOnce({ roomId: "__crash_lobby__" });
      mockService.waitFor.mockResolvedValueOnce({ crashPoint: 3.45, payout: 0.02 });

      const result = await playCrashAction.handler(
        runtime, makeMessage("Play crash 0.01 SOL cashout 2x"),
      );
      expect((result as { success: boolean }).success).toBe(true);
      expect((result as { text: string }).text).toContain("3.45x");
    });

    it("cleans up tick listener on error", async () => {
      mockService.sendAndWait.mockResolvedValueOnce({ roomId: "__crash_lobby__" });
      mockService.waitFor.mockRejectedValueOnce(new Error("Timeout"));

      const unsub = vi.fn();
      mockService.on.mockReturnValue(unsub);

      const result = await playCrashAction.handler(
        runtime, makeMessage("crash"),
      );
      expect((result as { success: boolean }).success).toBe(false);
      expect(unsub).toHaveBeenCalled();
    });

    it("returns error when not connected for bet send", async () => {
      mockService.sendAndWait.mockResolvedValueOnce({ roomId: "__crash_lobby__" });
      mockService.waitFor.mockResolvedValueOnce({});
      mockService.send.mockReturnValue(false);

      const result = await playCrashAction.handler(
        runtime, makeMessage("crash"),
      );
      expect((result as { success: boolean }).success).toBe(false);
      expect((result as { error: string }).error).toContain("Not connected");
    });
  });

  describe("checkBalanceAction", () => {
    it("returns formatted balance", async () => {
      mockService.getBalance.mockResolvedValueOnce({
        amount: "1.5",
        currency: "SOL",
        raw: { balances: [{ currency: "SOL", amount: "1.5" }] },
      });

      const result = await checkBalanceAction.handler(
        runtime, makeMessage("balance"),
      );
      expect((result as { success: boolean }).success).toBe(true);
      expect((result as { text: string }).text).toContain("1.5 SOL");
    });

    it("returns error on failure", async () => {
      mockService.getBalance.mockRejectedValueOnce(new Error("Timeout"));

      const result = await checkBalanceAction.handler(
        runtime, makeMessage("balance"),
      );
      expect((result as { success: boolean }).success).toBe(false);
    });
  });

  describe("sendMessageAction", () => {
    it("sends quoted text", async () => {
      mockService.sendAndWait.mockResolvedValueOnce({});

      const result = await sendMessageAction.handler(
        runtime, makeMessage("Say 'gg' in chat"),
      );
      expect((result as { success: boolean }).success).toBe(true);
      expect(mockService.sendAndWait).toHaveBeenCalledWith(
        ClientOp.SendMessage,
        { content: "gg" },
        ServerOp.MessageSent,
        5000,
      );
    });

    it("returns error for empty message", async () => {
      const result = await sendMessageAction.handler(
        runtime, makeMessage(""),
      );
      expect((result as { success: boolean }).success).toBe(false);
      expect((result as { error: string }).error).toContain("No message");
    });

    it("truncates long messages", async () => {
      mockService.sendAndWait.mockResolvedValueOnce({});
      const longText = "a".repeat(3000);

      await sendMessageAction.handler(
        runtime, makeMessage(longText),
      );

      const call = mockService.sendAndWait.mock.calls[0];
      expect((call[1] as { content: string }).content.length).toBe(2000);
    });
  });

  describe("getLeaderboardAction", () => {
    it("detects game type from message", async () => {
      mockService.sendAndWait.mockResolvedValueOnce({
        entries: [{ displayName: "Player1", wins: 50 }],
      });

      const result = await getLeaderboardAction.handler(
        runtime, makeMessage("Show dice leaderboard"),
      );
      expect((result as { success: boolean }).success).toBe(true);
      expect((result as { text: string }).text).toContain("dice");
      expect(mockService.sendAndWait).toHaveBeenCalledWith(
        ClientOp.GetLeaderboard,
        { gameType: "dice", limit: 10 },
        ServerOp.LeaderboardData,
        10000,
      );
    });

    it("returns empty message when no entries", async () => {
      mockService.sendAndWait.mockResolvedValueOnce({ entries: [] });

      const result = await getLeaderboardAction.handler(
        runtime, makeMessage("leaderboard"),
      );
      expect((result as { text: string }).text).toContain("No leaderboard");
    });
  });
});

describe("Providers", () => {
  let mockService: ReturnType<typeof createMockService>;
  let runtime: IAgentRuntime;

  beforeEach(() => {
    mockService = createMockService();
    runtime = createRuntime(mockService);
  });

  describe("balanceProvider", () => {
    it("returns balance data", async () => {
      mockService.getBalance.mockResolvedValueOnce({
        amount: "2.5", currency: "SOL", raw: {},
      });

      const result = await balanceProvider.get(
        runtime,
        makeMessage(""),
        { values: {}, text: "" },
      );
      expect(result.text).toContain("2.5 SOL");
      expect(result.values?.razzBalance).toBe("2.5");
    });

    it("returns error text on failure instead of empty object", async () => {
      mockService.getBalance.mockRejectedValueOnce(new Error("Timeout"));

      const result = await balanceProvider.get(
        runtime,
        makeMessage(""),
        { values: {}, text: "" },
      );
      expect(result.text).toContain("unavailable");
      expect(result.text).toContain("Timeout");
    });

    it("returns empty when no service", async () => {
      const rt: IAgentRuntime = {
        agentId: "test",
        getSetting: () => undefined,
        getService: () => null,
      };
      const result = await balanceProvider.get(
        rt, makeMessage(""), { values: {}, text: "" },
      );
      expect(result).toEqual({});
    });
  });

  describe("gameStateProvider", () => {
    it("formats crash room states", async () => {
      mockService.getCrashState.mockResolvedValueOnce({
        rooms: [
          { name: "Crash Lobby", phase: "running", multiplier: 2.5, playerCount: 3 },
        ],
      });

      const result = await gameStateProvider.get(
        runtime, makeMessage(""), { values: {}, text: "" },
      );
      expect(result.text).toContain("Crash Lobby");
      expect(result.text).toContain("running");
      expect(result.text).toContain("2.5x");
    });

    it("returns empty when no crash state", async () => {
      mockService.getCrashState.mockResolvedValueOnce(null);

      const result = await gameStateProvider.get(
        runtime, makeMessage(""), { values: {}, text: "" },
      );
      expect(result).toEqual({});
    });

    it("returns error text on failure instead of empty", async () => {
      mockService.getCrashState.mockRejectedValueOnce(new Error("Network error"));

      const result = await gameStateProvider.get(
        runtime, makeMessage(""), { values: {}, text: "" },
      );
      expect(result.text).toContain("unavailable");
    });
  });
});
