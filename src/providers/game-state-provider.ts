import type { Provider, IAgentRuntime, Memory, State, ProviderResult } from "../types.js";
import { RazzService } from "../services/razz-service.js";

interface CrashRoom {
  phase?: string;
  multiplier?: number;
  playerCount?: number;
  name?: string;
  roomId?: string;
}

export const gameStateProvider: Provider = {
  name: "RAZZ_GAME_STATE",
  description: "Active Razz game state - crash rounds, rooms, live matches",
  dynamic: true,

  get: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State,
  ): Promise<ProviderResult> => {
    const service = runtime.getService<RazzService>("razz");
    if (!service) return {};

    try {
      const state = await service.getCrashState();
      if (!state) return {};

      const stateObj = state as { rooms?: CrashRoom[] };
      const rooms: CrashRoom[] = Array.isArray(state) ? state : stateObj.rooms || [];
      if (rooms.length === 0) return {};

      const lines = rooms.map((r) => {
        const phase = r.phase || "unknown";
        const multi = r.multiplier ? ` ${r.multiplier}x` : "";
        const players = r.playerCount ? ` (${r.playerCount} players)` : "";
        const name = r.name || r.roomId || "crash";
        return `- ${name}: ${phase}${multi}${players}`;
      });

      return {
        text: `[Razz Games]\n${lines.join("\n")}`,
        data: { razzCrashState: state },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return { text: `[Razz Games] unavailable: ${msg}` };
    }
  },
};
