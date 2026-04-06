// Opcodes inlined from Razz protocol - only the ones this plugin needs.
// Avoids importing @razz/shared or the MCP server package.

export const ClientOp = {
  Authenticate: 1,
  JoinRoom: 20,
  SendMessage: 30,
  GamePlay: 186,
  GameAction: 187,
  Heartbeat: 199,
  GetBalance: 210,
  RequestDeposit: 211,
  GetLeaderboard: 213,
} as const;

export const ServerOp = {
  Ready: 1,
  Error: 2,
  MessageSent: 30,
  RoomInfo: 90,
  GameResult: 186,
  GameError: 187,
  GameTick: 188,
  BalanceUpdate: 210,
  DepositInfo: 211,
  LeaderboardData: 213,
} as const;
