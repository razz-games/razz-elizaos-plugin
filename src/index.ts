import type { Plugin, IAgentRuntime } from "./types.js";
import { RazzService } from "./services/razz-service.js";
import { playDiceAction } from "./actions/play-dice.js";
import { playFlipAction } from "./actions/play-flip.js";
import { playCrashAction } from "./actions/play-crash.js";
import { checkBalanceAction } from "./actions/check-balance.js";
import { sendMessageAction } from "./actions/send-message.js";
import { getLeaderboardAction } from "./actions/get-leaderboard.js";
import { balanceProvider } from "./providers/balance-provider.js";
import { gameStateProvider } from "./providers/game-state-provider.js";
import type { Service } from "./types.js";

const razzPlugin: Plugin = {
  name: "razz",
  description:
    "Razz games platform - play dice, flip, crash with SOL wagering",

  services: [RazzService as unknown as typeof Service],

  actions: [
    playDiceAction,
    playFlipAction,
    playCrashAction,
    checkBalanceAction,
    sendMessageAction,
    getLeaderboardAction,
  ],

  providers: [balanceProvider, gameStateProvider],

  init: async (
    _config: Record<string, string>,
    runtime: IAgentRuntime,
  ): Promise<void> => {
    const apiKey = runtime.getSetting("RAZZ_API_KEY");
    if (!apiKey) {
      console.warn("[razz] RAZZ_API_KEY not configured - plugin actions will fail");
    }
  },
};

export default razzPlugin;
export { RazzService } from "./services/razz-service.js";
export type {
  Plugin,
  Action,
  Provider,
  Service,
  IAgentRuntime,
} from "./types.js";
