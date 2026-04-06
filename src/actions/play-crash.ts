import type { Action, IAgentRuntime, Memory, ActionResult, HandlerCallback } from "../types.js";
import { RazzService } from "../services/razz-service.js";
import { ClientOp, ServerOp } from "../protocol.js";
import { parseNumber } from "./helpers.js";

export const playCrashAction: Action = {
  name: "RAZZ_PLAY_CRASH",
  description:
    "Play a crash game on Razz. A multiplier rises from 1.0x until it crashes. Set a cashout target to auto-cashout. If the multiplier crashes before your target, you lose. Max wager 0.5 SOL.",
  similes: ["PLAY_CRASH", "CRASH_BET", "CRASH_GAME", "MULTIPLIER_GAME"],
  examples: [
    [
      { name: "user", content: { text: "Play crash with 0.01 SOL, cashout at 2x" } },
      { name: "agent", content: { text: "Entering crash round... Cashed out at 2.0x! Crash point was 3.45x. Payout: 0.02 SOL" } },
    ],
  ],

  validate: async (runtime: IAgentRuntime): Promise<boolean> => {
    return runtime.getService<RazzService>("razz") !== null;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: unknown,
    _options?: unknown,
    callback?: HandlerCallback,
  ): Promise<ActionResult | void> => {
    const service = runtime.getService<RazzService>("razz");
    if (!service) {
      return { success: false, error: "Razz service not available" };
    }

    let removeTick: (() => void) | null = null;
    try {
      await service.ensureConnected();
      const text = message.content.text || "";
      const wager = parseNumber(text, "wager", 0, 0.5, 0);
      const cashoutTarget = parseNumber(text, "cashout", 1.05, 50, 2.0);
      const roomId = "__crash_lobby__";

      // Join crash room
      await service.sendAndWait(
        ClientOp.JoinRoom,
        { roomId },
        ServerOp.RoomInfo,
        5000,
      );

      // Set up result waiter before placing bet
      const resultPromise = service.waitFor<{ crashPoint: number; payout: number }>(
        ServerOp.GameResult,
        120000,
      );

      // Auto-cashout when multiplier reaches target
      let cashedOut = false;
      removeTick = service.on(ServerOp.GameTick, (raw: unknown) => {
        const data = raw as { phase?: string; multiplier?: number };
        if (data.phase === "running" && !cashedOut && (data.multiplier ?? 0) >= cashoutTarget) {
          cashedOut = true;
          service.send(ClientOp.GameAction, { roomId, action: "cashout" });
        }
      });

      // Place the bet
      if (!service.send(ClientOp.GamePlay, {
        roomId,
        gameType: "crash",
        wagerAmount: wager,
        currency: "SOL",
      })) {
        throw new Error("Not connected - could not place crash bet");
      }

      let result: { crashPoint: number; payout: number };
      try {
        result = await resultPromise;
      } finally {
        removeTick();
        removeTick = null;
      }

      const msg = `Crash round ended at ${result.crashPoint}x${result.payout ? ` - payout: ${result.payout} SOL` : ""}`;
      if (callback) await callback({ text: msg });
      return { success: true, text: msg, data: result as Record<string, unknown> };
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : "Unknown error";
      const msg = `Crash game failed: ${errMessage}`;
      if (callback) await callback({ text: msg });
      return { success: false, error: errMessage };
    } finally {
      if (removeTick) removeTick();
    }
  },
};
