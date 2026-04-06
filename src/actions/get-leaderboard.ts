import type { Action, IAgentRuntime, Memory, ActionResult, HandlerCallback } from "../types.js";
import { RazzService } from "../services/razz-service.js";
import { ClientOp, ServerOp } from "../protocol.js";

interface LeaderboardEntry {
  displayName?: string;
  name?: string;
  accountId?: string;
  wins?: number;
  score?: number;
}

export const getLeaderboardAction: Action = {
  name: "RAZZ_GET_LEADERBOARD",
  description:
    "Get the Razz game leaderboard rankings. Shows top players by game type.",
  similes: ["GET_LEADERBOARD", "RAZZ_RANKINGS", "TOP_PLAYERS", "LEADERBOARD"],
  examples: [
    [
      { name: "user", content: { text: "Show me the Razz leaderboard" } },
      { name: "agent", content: { text: "Razz Leaderboard:\n1. Player1 - 150 wins\n2. Player2 - 120 wins" } },
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

      const raw = (message.content.text || "").toLowerCase();
      let gameType: string | undefined;
      if (raw.includes("dice")) gameType = "dice";
      else if (raw.includes("flip")) gameType = "flip";
      else if (raw.includes("crash")) gameType = "crash";

      const data = await service.sendAndWait<{
        entries?: LeaderboardEntry[];
        leaderboard?: LeaderboardEntry[];
      }>(
        ClientOp.GetLeaderboard,
        { gameType, limit: 10 },
        ServerOp.LeaderboardData,
        10000,
      );

      const entries = data.entries || data.leaderboard || [];
      const lines = entries.map(
        (e: LeaderboardEntry, i: number) =>
          `${i + 1}. ${e.displayName || e.name || e.accountId || "Unknown"} - ${e.wins ?? e.score ?? 0} wins`,
      );
      const text =
        lines.length > 0
          ? `Razz Leaderboard${gameType ? ` (${gameType})` : ""}:\n${lines.join("\n")}`
          : "No leaderboard data available";

      if (callback) await callback({ text });
      return { success: true, text, data: data as Record<string, unknown> };
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : "Unknown error";
      const text = `Leaderboard fetch failed: ${errMessage}`;
      if (callback) await callback({ text });
      return { success: false, error: errMessage };
    }
  },
};
