import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const config = {
  champzArenaBaseUrl: process.env.CHAMPZ_ARENA_BASE_URL ?? 'https://api.champz.world/game/spore-trainer/ai-agent',
  sibylBridgeBaseUrl: process.env.SIBYL_BRIDGE_BASE_URL ?? 'http://localhost:8787',

  // Set after the one-time registration step (see docs/ARCHITECTURE.md) — do not commit real values.
  agentApiKey: process.env.CHAMPZ_AGENT_API_KEY,
  agentWallet: process.env.AGENT_WALLET_ADDRESS,

  virtualsAgentId: process.env.VIRTUALS_AGENT_ID,

  // OpenRouter — matches the rest of the Champz stack (model: moonshotai/kimi-k2.6).
  // Loaded from the environment only. .env is gitignored and never committed;
  // .env.example (which IS committed) only ever has blank placeholders — see
  // that file's comment for the same rule applied to every other credential.
  openRouterApiKey: process.env.OPENROUTER_API_KEY,
};

export function requireRegisteredAgentConfig() {
  return {
    apiKey: required('CHAMPZ_AGENT_API_KEY'),
    wallet: required('AGENT_WALLET_ADDRESS'),
  };
}
