import type { Action, IAgentRuntime, Memory, ActionResult, HandlerCallback } from "../types.js";
import { RazzService } from "../services/razz-service.js";
import { ClientOp, ServerOp } from "../protocol.js";

export const sendMessageAction: Action = {
  name: "RAZZ_SEND_MESSAGE",
  description:
    "Send a chat message in the current Razz room. The agent must be in a room first.",
  similes: ["SEND_MESSAGE", "RAZZ_CHAT", "CHAT_MESSAGE"],
  examples: [
    [
      { name: "user", content: { text: "Say 'gg' in the Razz chat" } },
      { name: "agent", content: { text: "Sent message: gg" } },
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
      const raw = message.content.text || "";

      // Extract quoted text or use whole message
      let chatMsg = raw;
      const quoted = raw.match(/['"`]([^'"`]+)['"`]/);
      if (quoted) chatMsg = quoted[1];

      if (!chatMsg || chatMsg.length === 0) {
        return { success: false, error: "No message content provided" };
      }
      if (chatMsg.length > 2000) {
        chatMsg = chatMsg.slice(0, 2000);
      }

      await service.sendAndWait(
        ClientOp.SendMessage,
        { content: chatMsg },
        ServerOp.MessageSent,
        5000,
      );

      const text = `Sent message: ${chatMsg}`;
      if (callback) await callback({ text });
      return { success: true, text };
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : "Unknown error";
      const text = `Send message failed: ${errMessage}`;
      if (callback) await callback({ text });
      return { success: false, error: errMessage };
    }
  },
};
