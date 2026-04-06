import type { Provider, IAgentRuntime, Memory, State, ProviderResult } from "../types.js";
import { RazzService } from "../services/razz-service.js";

export const balanceProvider: Provider = {
  name: "RAZZ_BALANCE",
  description: "Current Razz platform balance for wagering",
  dynamic: true,

  get: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State,
  ): Promise<ProviderResult> => {
    const service = runtime.getService<RazzService>("razz");
    if (!service) return {};

    try {
      const balance = await service.getBalance();
      return {
        text: `[Razz Balance] ${balance.amount} ${balance.currency}`,
        values: { razzBalance: balance.amount, razzCurrency: balance.currency },
        data: { razzBalanceData: balance.raw },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return { text: `[Razz Balance] unavailable: ${msg}` };
    }
  },
};
