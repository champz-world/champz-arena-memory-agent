/**
 * Entry point. Two modes:
 *   `npm run dev -- register`     one-time: create/load ACP wallet, complete
 *                                  the Champz Arena registration handshake
 *   `npm run dev -- run-cycle`    check upcoming cycle -> enroll if needed ->
 *                                  recall memory -> reason -> submit strategy
 *
 * Funding the execution wallet (runbook Step 4) is a real on-chain transfer,
 * not an HTTP call — currently surfaced as printed instructions (the
 * runbook's own sanctioned fallback for an agent without send capability
 * wired up yet); see docs/ARCHITECTURE.md, "later" items.
 *
 * Settlement/remember (writing the outcome back to Sibyl once a cycle
 * resolves) is a separate script — see docs/ARCHITECTURE.md — since it runs
 * on its own schedule relative to cycle end, not at agent-startup time.
 */

import { config, requireRegisteredAgentConfig } from './config.js';
import { loadOrCreateAcpWallet } from './acpWallet.js';
import {
  getRegistrationChallenge,
  registerAgent,
  getUpcomingCycle,
  enrollInCycle,
  buildFundingInstructions,
  submitStrategy,
} from './champzArenaClient.js';
import { recall } from './memoryClient.js';
import { reasonAboutStrategy } from './reasoning.js';

async function register() {
  const wallet = await loadOrCreateAcpWallet();
  const challenge = await getRegistrationChallenge(wallet.address);
  if (!challenge.success) {
    throw new Error('Failed to get registration challenge');
  }

  const signature = await wallet.signMessage(challenge.message);

  const result = await registerAgent({
    wallet: wallet.address,
    nonce: challenge.nonce,
    signature,
    agentName: 'Sibyl Memory Agent',
    virtualsAgentId: config.virtualsAgentId,
  });

  if (!result.success) {
    // Per the runbook: "Wallet already registered" means an api_key already
    // exists for this wallet and can't be recovered — only reset by contacting
    // the Champz team. Not retryable from here.
    throw new Error(`Registration failed: ${result.message ?? 'unknown error'}`);
  }

  console.log('Registered. Store these in .env (not committed):');
  console.log(`CHAMPZ_AGENT_API_KEY=${result.api_key}`);
  console.log(`AGENT_WALLET_ADDRESS=${wallet.address}`);
  console.log(`Execution wallet to fund before the cycle: ${result.execution_wallet}`);
}

async function runCycle() {
  const { apiKey, wallet } = requireRegisteredAgentConfig();

  const upcoming = await getUpcomingCycle(apiKey);
  if (!upcoming.available || !upcoming.cycle) {
    console.log('No upcoming cycle right now.');
    return;
  }

  const cycle = upcoming.cycle;

  if (!upcoming.my_status?.enrolled) {
    const enrollResult = await enrollInCycle(apiKey, cycle.cycle_id);
    if (!enrollResult.enrolled) {
      console.log(`Could not enroll: ${enrollResult.reason ?? 'unknown reason'}`);
      return;
    }
    console.log(`Enrolled in cycle ${cycle.cycle_id}, slot ${enrollResult.slot}.`);

    const funding = buildFundingInstructions(enrollResult.cycle, 'TBD — size relative to starting_price + budget');
    if (funding) {
      console.log('Execution wallet needs funding before strategy_deadline:');
      console.log(funding);
    }
  }

  const history = await recall(wallet);
  const { strategy, rationale } = await reasonAboutStrategy(cycle, history);

  console.log(`Cycle ${cycle.cycle_id} — rationale: ${rationale}`);

  const result = await submitStrategy(apiKey, cycle.cycle_id, strategy);
  console.log('Strategy submitted:', result);
}

const mode = process.argv[2];

if (mode === 'register') {
  register().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else if (mode === 'run-cycle') {
  runCycle().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  console.log('Usage: npm run dev -- register | run-cycle');
  process.exit(1);
}
