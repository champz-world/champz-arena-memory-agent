/**
 * Entry point. Two modes:
 *   `npm run dev -- register`     one-time: create/load ACP wallet, complete
 *                                  the Champz Arena registration handshake
 *   `npm run dev -- prep-cycle`   check upcoming cycle -> enroll if needed ->
 *                                  recall memory -> print everything needed
 *                                  to paste into Virtuals chat for reasoning
 *
 * Reasoning is deliberately NOT automated here. It happens live, by hand:
 * this command's printed output (recalled memory + live cycle state) gets
 * pasted into the Virtuals agent chat, which reasons out a strategy; you
 * then submit it with `POST /strategy` (see champzArenaClient.ts's
 * submitStrategy(), called directly via curl in the demo, or from a REPL —
 * there's no scripted LLM call in this repo to keep in sync with).
 *
 * Funding the execution wallet (runbook Step 4) is a real on-chain transfer,
 * not an HTTP call — currently surfaced as printed instructions (the
 * runbook's own sanctioned fallback for an agent without send capability
 * wired up yet); see docs/ARCHITECTURE.md, "later" items.
 *
 * Settlement/remember (writing the outcome back to Sibyl once a cycle
 * resolves) is a separate, manual step — see docs/ARCHITECTURE.md and the
 * Sep 1 demo runbook — since it runs on its own schedule relative to cycle
 * end, not at agent-startup time, and is done on camera via curl, not code.
 */

import { config, requireRegisteredAgentConfig } from './config.js';
import { loadOrCreateAcpWallet } from './acpWallet.js';
import {
  getRegistrationChallenge,
  registerAgent,
  getUpcomingCycle,
  enrollInCycle,
  buildFundingInstructions,
} from './champzArenaClient.js';
import { recall } from './memoryClient.js';

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

async function prepCycle() {
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

  console.log('\n──────────────────────────────────────────────');
  console.log(' Paste everything below into Virtuals chat and');
  console.log(' ask it to reason a strategy, then submit the');
  console.log(' result with POST /strategy (cycle_id: ' + cycle.cycle_id + ').');
  console.log('──────────────────────────────────────────────\n');

  console.log('RECALLED MEMORY:');
  console.log(history.summary);
  console.log(JSON.stringify(history.entries, null, 2));

  console.log('\nLIVE CYCLE STATE:');
  console.log(JSON.stringify(cycle, null, 2));
}

const mode = process.argv[2];

if (mode === 'register') {
  register().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else if (mode === 'prep-cycle') {
  prepCycle().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  console.log('Usage: npm run dev -- register | prep-cycle');
  process.exit(1);
}
