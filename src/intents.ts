/**
 * NEAR Intents payment leg — 1Click Swap API (docs.near-intents.org).
 *
 * What this module does (day 1): DRY-RUN quotes only. A quote asks the
 * 1Click solver network what a swap would cost; it moves no funds, signs
 * nothing, and needs no JWT (without a JWT the swap would carry a 0.2%
 * fee — see HACKATHON.md Q-006 — but a dry-run quote is free).
 *
 * What it does NOT do yet: submit a deposit, sign a transaction, or
 * execute a swap. Execution is a day-2 step and needs a funded testnet /
 * mainnet account; per HACKATHON.md Q-007 there is NO Intents testnet, so
 * live execution happens on mainnet with tiny amounts and dry:true quotes
 * first. Nothing here spends anything.
 *
 * The gate (gate.ts) decides WHETHER a payment may happen; this module is
 * HOW it would be priced and executed once allowed. The demo calls only
 * requestDryRunQuote().
 */
export interface DryRunQuote {
  originAsset: string;
  destinationAsset: string;
  amount: string; // smallest unit of the origin asset
  quotedAmountOut: string | null;
  quotedAmountOutUsd: number | null;
  timeEstimateSeconds: number | null;
  raw: unknown;
}

const ONE_CLICK = "https://1click.chaindefuser.com";

export async function requestDryRunQuote(
  originAsset: string,
  destinationAsset: string,
  amount: string,
): Promise<DryRunQuote> {
  const res = await fetch(`${ONE_CLICK}/v0/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      swapType: "EXACT_INPUT",
      slippageTolerance: 100, // 1.00%
      depositType: "ORIGIN_CHAIN",
      originAsset,
      destinationAsset,
      amount,
      refundTo: "scoregraft-demo.invalid", // dry run: never used
      refundType: "ORIGIN_CHAIN",
      recipient: "scoregraft-demo.invalid", // dry run: never used
      recipientType: "DESTINATION_CHAIN",
      deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
      dry: true,
    }),
  });
  const raw = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      `1Click quote failed HTTP ${res.status}: ${JSON.stringify(raw).slice(0, 300)}`,
    );
  }
  const quote = raw.quote as Record<string, unknown> | undefined;
  return {
    originAsset,
    destinationAsset,
    amount,
    quotedAmountOut: (quote?.amountOut as string | undefined) ?? null,
    quotedAmountOutUsd:
      quote?.amountOutUsd != null ? Number(quote.amountOutUsd) : null,
    timeEstimateSeconds:
      quote?.timeEstimate != null ? Number(quote.timeEstimate) : null,
    raw,
  };
}

/** Live 1Click token list (no auth). Used to resolve asset ids. */
export async function listTokens(): Promise<unknown> {
  const res = await fetch(`${ONE_CLICK}/v0/tokens`);
  if (!res.ok) throw new Error(`token list failed HTTP ${res.status}`);
  return res.json();
}
