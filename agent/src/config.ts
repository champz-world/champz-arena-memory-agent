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

  groqApiKey: process.env.GROQ_API_KEY,
};

export function requireRegisteredAgentConfig() {
  return {
    apiKey: required('CHAMPZ_AGENT_API_KEY'),
    wallet: required('AGENT_WALLET_ADDRESS'),
  };
}
