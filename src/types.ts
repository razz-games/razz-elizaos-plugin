// Minimal type definitions matching ElizaOS v2 Plugin/Action/Provider/Service interfaces.
// Defined locally to avoid heavy @elizaos/core dependency at build time.
// Structurally compatible with the real SDK types via duck typing.

export interface IAgentRuntime {
  agentId: string;
  getSetting(key: string): string | undefined;
  getService<T>(name: string): T | null;
}

export interface Memory {
  id?: string;
  entityId: string;
  content: Content;
  roomId: string;
}

export interface Content {
  text?: string;
  source?: string;
  [key: string]: any;
}

export interface State {
  values: Record<string, any>;
  data?: Record<string, any>;
  text: string;
}

export interface ActionResult {
  success: boolean;
  text?: string;
  data?: Record<string, any>;
  error?: string;
}

export interface ActionExample {
  name: string;
  content: Content;
}

export type HandlerCallback = (response: Content) => Promise<Memory[]>;

export interface Action {
  name: string;
  description: string;
  similes?: string[];
  examples?: ActionExample[][];
  validate: (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
  ) => Promise<boolean>;
  handler: (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: Record<string, any>,
    callback?: HandlerCallback,
  ) => Promise<ActionResult | void>;
}

export interface ProviderResult {
  text?: string;
  values?: Record<string, any>;
  data?: Record<string, any>;
}

export interface Provider {
  name: string;
  description?: string;
  dynamic?: boolean;
  get: (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
  ) => Promise<ProviderResult>;
}

export abstract class Service {
  static serviceType: string;
  abstract capabilityDescription: string;
  static async start(_runtime: IAgentRuntime): Promise<Service> {
    throw new Error("Not implemented");
  }
  abstract stop(): Promise<void>;
}

export interface Plugin {
  name: string;
  description: string;
  init?: (
    config: Record<string, string>,
    runtime: IAgentRuntime,
  ) => Promise<void>;
  actions?: Action[];
  providers?: Provider[];
  services?: (typeof Service)[];
}
