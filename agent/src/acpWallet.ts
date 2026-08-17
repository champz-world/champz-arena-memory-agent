/**
 * Wallet identity + signing via Virtuals' ACP SDK (@virtuals-protocol/acp-node-v2).
 *
 * Confirmed directly against the installed package's type definitions (not
 * guessed): `PrivyAlchemyEvmProviderAdapter.create(...)` provisions the wallet
 * and exposes `getAddress()` / `signMessage(chainId, message)`. `AcpAgent`
 * wraps that provider for the ACP marketplace layer (registry lookup, job
 * creation) but does NOT itself expose signMessage — its `clients` are
 * private. We keep the provider directly for signing Champz's registration
 * challenge, and separately wrap it in AcpAgent so this is a real,
 * registry-discoverable ACP agent identity (verifiable via
 * `agent.getMe()` / `agent.getAgentByWalletAddress()`), not just a bare
 * wallet borrowing the SDK's signing utility.
 *
 * REAL PREREQUISITE before this can run (account-creation steps on
 * Virtuals' own site, not something this codebase can generate):
 *   1. Register the agent at https://app.virtuals.io/acp/new (Service Registry)
 *   2. Under the agent's "Signers" tab, add a signer to get a `walletId` +
 *      `signerPrivateKey`
 *   3. (Optional but recommended) grab a Base `builderCode` from the
 *      agent's Settings tab
 */

import { AcpAgent, PrivyAlchemyEvmProviderAdapter } from '@virtuals-protocol/acp-node-v2';
import { base } from '@account-kit/infra';

export interface AcpWallet {
  address: string;
  signMessage(message: string): Promise<string>;
  /** Kept for future ACP marketplace use — not needed for Champz registration itself. */
  agent: AcpAgent;
}

export async function loadOrCreateAcpWallet(): Promise<AcpWallet> {
  const walletAddress = process.env.ACP_WALLET_ADDRESS as `0x${string}` | undefined;
  const walletId = process.env.ACP_WALLET_ID;
  const signerPrivateKey = process.env.ACP_SIGNER_PRIVATE_KEY;
  const builderCode = process.env.ACP_BUILDER_CODE; // optional

  if (!walletAddress || !walletId || !signerPrivateKey) {
    throw new Error(
      'Missing ACP_WALLET_ADDRESS / ACP_WALLET_ID / ACP_SIGNER_PRIVATE_KEY — ' +
        "register at https://app.virtuals.io/acp/new first (see this file's header comment)."
    );
  }

  const provider = await PrivyAlchemyEvmProviderAdapter.create({
    walletAddress,
    walletId,
    signerPrivateKey,
    chains: [base],
    builderCode,
  });

  const agent = await AcpAgent.create({ evmProvider: provider });
  const address = await provider.getAddress();

  return {
    address,
    agent,
    // Champz's registration challenge is a plain EIP-191 personal_sign over a
    // text message (see champzArenaClient.ts) — base.id covers it here since
    // that's the only chain this agent operates on.
    signMessage: (message: string) => provider.signMessage(base.id, message),
  };
}
