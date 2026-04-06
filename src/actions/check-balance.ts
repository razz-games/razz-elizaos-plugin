import type { Action, IAgentRuntime, Memory, ActionResult, HandlerCallback } from "../types.js";
import { RazzService } from "../services/razz-service.js";

export const checkBalanceAction: Action = {
  name: "RAZZ_CHECK_BALANCE",
  description:
    "Check your current Razz platform balance. Shows available SOL for wagering.",
  similes: ["CHECK_BALANCE", "GET_BALANCE", "RAZZ_BALANCE", "MY_BALANCE"],
  examples: [
    [
      { name: "user", content: { text: "What's my Razz balance?" } },
      { name: "agent", content: { text: "Your Razz balance is 0.5 SOL" } },
    ],
  ],

  validate: async (runtime: IAgentRuntime): Promise<boolean> => {
    return runtime.getService<RazzService>("razz") !== null;
  },

  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state?: unknown,
    _options?: unknown,
    callback?: HandlerCallback,
  ): Promise<ActionResult | void> => {
    const service = runtime.getService<RazzService>("razz");
    if (!service) {
      return { success: false, error: "Razz service not available" };
    }

    try {
      const balance = await service.getBalance();
      const text = `Your Razz balance: ${balance.amount} ${balance.currency}`;

      if (callback) await callback({ text });
      return { success: true, text, data: { balance: balance.raw } };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      const text = `Balance check failed: ${message}`;
      if (callback) await callback({ text });
      return { success: false, error: message };
    }
  },
};
