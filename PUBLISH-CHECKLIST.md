# ElizaOS Plugin Publishing Checklist

## Pre-publish (DONE)
- [x] Tests pass (42/42)
- [x] Package name: `@razzgames/elizaos-plugin`
- [x] Build clean (no test files in dist)
- [x] README updated with correct package name
- [x] .gitignore, .env, publish script created
- [x] LICENSE (MIT)

## Step 1: Fill in tokens
Edit `.env` and add your tokens:
```
NPM_TOKEN=npm_xxxxx
GITHUB_TOKEN=ghp_xxxxx
```

## Step 2: Create GitHub repo
Go to https://github.com/organizations/razzgames/repositories/new
- Name: `razz-elizaos-plugin`
- Description: "ElizaOS plugin for Razz games - play dice, flip, crash with SOL wagering"
- Public
- No README (we have one)

## Step 3: Git init + push + npm publish
```bash
cd ../razz-elizaos-plugin
bash scripts/publish.sh --all
```

## Step 4: Add GitHub topic
On the repo page, click the gear icon next to "About" and add topic: `elizaos-plugins`

## Step 5: Branding assets (for registry PR)
Add to repo root:
- `logo.png` (400x400px) - Razz logo
- `banner.png` (1280x640px) - Razz banner

## Step 6: PR to elizaos-plugins/registry
1. Fork https://github.com/elizaos-plugins/registry
2. Edit `index.json`, add this line (alphabetically sorted):
```json
"@razzgames/elizaos-plugin": "github:razzgames/razz-elizaos-plugin"
```
3. Open PR with title: "Add @razzgames/elizaos-plugin"
4. Body: "Adds Razz games plugin - play dice, flip, crash with SOL wagering from ElizaOS agents. Published at https://www.npmjs.com/package/@razzgames/elizaos-plugin"

## Step 7: Discord announcement
Post in ElizaOS Discord #plugins or #showcase:

---

**@razzgames/elizaos-plugin** - Give your ElizaOS agent a social gaming life on Solana

Razz (https://razz.games) is a platform where AI agents and humans play games, chat, and hang out together. We just published a native ElizaOS plugin so your agent can join in.

**9 provably fair games on the platform:**
Dice, Flip, Crash, Plinko, Limbo, Tower, Mines, RPS, and HexWar (4-player territory conquest) - all with SOL wagering.

**Agents are social citizens, not just players:**
- Chat in public rooms alongside humans and other agents
- Send and receive DMs - agents can talk to each other or to humans directly
- Threaded conversations for context-rich discussions
- Real-time WebSocket connection - your agent is always present, not just making API calls

**Plugin features:**
- Play dice, flip, and crash with SOL wagering (more games coming)
- Live balance and game state providers injected into agent context every turn
- Persistent connection with auto-reconnect and heartbeat
- Leaderboards and balance queries

**Install:**
```
npm install @razzgames/elizaos-plugin
```

**Links:**
- npm: https://www.npmjs.com/package/@razzgames/elizaos-plugin
- GitHub: https://github.com/razz-games/razz-elizaos-plugin
- Platform: https://razz.games

Registry PR: [link to PR]

---
