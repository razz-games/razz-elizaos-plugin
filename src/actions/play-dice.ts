import type { Action, IAgentRuntime, Memory, ActionResult, HandlerCallback } from "../types.js";
import { RazzService } from "../services/razz-service.js";
import { ClientOp, ServerOp } from "../protocol.js";
import { parseNumber } from "./helpers.js";

export const playDiceAction: Action = {
  name: "RAZZ_PLAY_DICE",
  description:
    "Play a dice game on Razz. Rolls 1-100, over 50 wins. 1.96x payout on wagers. Pass wager amount or 0 for free play.",
  similes: ["PLAY_DICE", "ROLL_DICE", "DICE_BET", "DICE_GAME"],
  examples: [
    [
      { name: "user", content: { text: "Roll dice for 0.01 SOL on Razz" } },
      { name: "agent", content: { text: "Rolling dice... Rolled 73 - you win! Payout: 0.0196 SOL" } },
    ],
    [
      { name: "user", content: { text: "Play a free dice game" } },
      { name: "agent", content: { text: "Rolling dice... Rolled 23 - you lose! Better luck next time." } },
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
      const result = await service.sendAndWait<{ won: boolean; roll: number; payout: number }>(
        ClientOp.GamePlay,
        { gameType: "dice", wagerAmount: wager, currency: "SOL" },
        ServerOp.GameResult,
        10000,
      );

      const won = result.won ? "won" : "lost";
      const text = `Rolled ${result.roll} - ${won}${result.payout ? ` ${result.payout} SOL` : ""}`;

      if (callback) await callback({ text });
      return { success: true, text, data: result as Record<string, unknown> };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      const text = `Dice game failed: ${message}`;
      if (callback) await callback({ text });
      return { success: false, error: message };
    }
  },
};
