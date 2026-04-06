import type { Action, IAgentRuntime, Memory, ActionResult, HandlerCallback } from "../types.js";
import { RazzService } from "../services/razz-service.js";
import { ClientOp, ServerOp } from "../protocol.js";
import { parseNumber } from "./helpers.js";

export const playFlipAction: Action = {
  name: "RAZZ_PLAY_FLIP",
  description:
    "Play a coin flip game on Razz. Heads wins, tails loses. 1.96x payout on wagers. Pass wager amount or 0 for free play.",
  similes: ["PLAY_FLIP", "COIN_FLIP", "FLIP_BET", "FLIP_COIN"],
  examples: [
    [
      { name: "user", content: { text: "Flip a coin for 0.05 SOL" } },
      { name: "agent", content: { text: "Flipping coin... Heads - you win! Payout: 0.098 SOL" } },
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

    try {
      await service.ensureConnected();
      const wager = parseNumber(message.content.text, "wager", 0, 1, 0);
      const result = await service.sendAndWait<{ won: boolean; outcome: string; payout: number }>(
        ClientOp.GamePlay,
        { gameType: "flip", wagerAmount: wager, currency: "SOL" },
        ServerOp.GameResult,
        10000,
      );

      const side = result.won ? "Heads" : "Tails";
      const text = `${side} - ${result.won ? "you win" : "you lose"}${result.payout ? ` ${result.payout} SOL` : ""}`;

      if (callback) await callback({ text });
      return { success: true, text, data: result as Record<string, unknown> };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      const text = `Flip game failed: ${message}`;
      if (callback) await callback({ text });
      return { success: false, error: message };
    }
  },
};
