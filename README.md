# Perps DEX — Solana Tutorial

A full-stack perpetual futures DEX on Solana, built as a hands-on tutorial for developers entering the Solana ecosystem.

### What you'll learn

- Designing an Anchor program with PDA-based account architecture
- The full position lifecycle: collateral, leverage, PnL settlement
- Funding rate mechanics using a cumulative index system
- Liquidation: health checks, incentives, and keeper mechanics
- Connecting a Next.js frontend to an on-chain program with Codama-generated clients

## Table of Contents

- [What We're Building](#what-were-building)
- [Simplifications](#simplifications)
- [Protocol Overview](#protocol-overview)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Deep Dive](#deep-dive)
- [Frontend](#frontend)
- [Testing](#testing)
- [Scripts](#scripts)
- [Design Decisions](#design-decisions)
- [Learn More](#learn-more)

## What We're Building

A vault-backed perpetual futures protocol on Solana. There is no orderbook — the protocol's vault acts as the counterparty to every trade, absorbing losses from traders and paying out their profits.

Perps Platform Architecture

**Vault-backed trading** — A protocol-funded vault sits on the other side of every position. When traders lose, the vault collects. When traders win, the vault pays out.

**Liquidation** — When a position's losses eat into its collateral beyond a safe threshold, it becomes liquidatable. Anyone can call the `liquidate` instruction — there's no privileged keeper. The liquidator earns a **liquidation bonus** (5% of remaining collateral) as incentive, protecting the vault from bad debt.

Liquidation Flow

As shown above, a liquidator checks position health and calls `liquidate` on unhealthy ones. The vault receives the user's losses, the liquidator receives the bonus, and the user keeps whatever collateral remains.

**Funding rate** — A periodic payment that keeps long/short interest balanced. Whichever side has more open interest pays the other side. The protocol (or any crank) calls `update_funding` to adjust the cumulative funding index.

**Frontend** — A Next.js UI for depositing collateral, opening/closing positions, and monitoring PnL in real time.

## Simplifications

This is a tutorial — we deliberately cut corners to focus on the core mechanics:

- **Mock oracle** — Instead of a real oracle like Pyth or Switchboard, prices are driven by a local script (`npm run mock-oracle`). It uses Geometric Brownian Motion to simulate realistic price movements, sending an `updateOracle` transaction every 5 seconds.
- **Mock USDC** — We create our own SPL token on localnet rather than using a real stablecoin mint
- **No trading fee** — The vault doesn't charge fees on open/close, which would be essential in production
- **Simplified funding rate** — A linear model based on OI discrepancy (`(long_OI - short_OI) / total_OI * MAX_RATE`) instead of the more complex models used in production

## Protocol Overview

### Fund Flow

1. **Deposit** — User transfers USDC from their wallet into a per-user collateral token account (PDA)
2. **Open position** — Collateral is locked, a Position account is created, and open interest is updated on the market
3. **Health** — Each user account has a health factor based on locked collateral vs. unrealized PnL. If health drops below the threshold, anyone can liquidate
4. **PnL settlement** — When a position is closed (or liquidated), actual token transfers settle the PnL:
  - **Loss** → tokens move from user's collateral account to the vault
  - **Win** → tokens move from the vault to user's collateral account
5. **Withdraw** — User transfers available (unlocked) USDC back to their wallet

### Instructions


| Category        | Instruction                     | Description                                                          |
| --------------- | ------------------------------- | -------------------------------------------------------------------- |
| **Setup**       | `initialize`                    | Create Markets, Oracle, and Vault accounts                           |
|                 | `initialize_market_with_oracle` | Add a new perps market with initial oracle price                     |
| **Trading**     | `deposit_collateral`            | Transfer USDC from wallet to user's collateral account               |
|                 | `open_position`                 | Lock collateral, create Position, update OI                          |
|                 | `view_position_pnl`             | Read-only: returns price PnL + funding PnL                           |
|                 | `close_position`                | Settle PnL via token transfers, unlock collateral, close Position    |
|                 | `withdraw_collateral`           | Transfer available USDC from collateral account to wallet            |
| **Liquidation** | `liquidate`                     | Close unhealthy position, settle loss to vault, pay liquidator bonus |
| **Maintenance** | `update_funding`                | Update cumulative funding indices based on OI imbalance              |
|                 | `update_oracle`                 | Update oracle price for a token                                      |


### Accounts


| Account          | What It Stores                                                 |
| ---------------- | -------------------------------------------------------------- |
| `Markets`        | Vec of PerpsMarket (token, name, OI, funding indices)          |
| `Oracle`         | Vec of OraclePrice (token, price, timestamp)                   |
| `UserAccount`    | Authority, locked collateral (balance read from token account) |
| `UserCollateral` | Per-user token account holding deposited USDC                  |
| `Position`       | Direction, entry price, size, collateral, funding index        |
| `Vault`          | LP pool token account (protocol-funded counterparty)           |


`Markets` and `Oracle` are singleton accounts — one of each for the entire program. The tradeoff is a size limit (`MAX_MARKETS = 10`), which is fine for a tutorial.

## Architecture


| Layer          | Technology                                                              |
| -------------- | ----------------------------------------------------------------------- |
| Frontend       | Next.js 16, React 19, TypeScript                                        |
| Styling        | Tailwind CSS v4                                                         |
| Solana Client  | `@solana/client`, `@solana/react-hooks`                                 |
| Program Client | [Codama](https://github.com/codama-idl/codama)-generated, `@solana/kit` |
| Program        | Anchor 1.0.0-rc.2 (Rust)                                                |


The frontend constructs transactions using a Codama-generated TypeScript client (in `app/generated/perps/`) and sends them to the Anchor program. All state lives on-chain in PDA accounts — no server or database needed.

### Project Structure

```
perps-dex/
├── anchor/
│   ├── programs/perps/src/
│   │   ├── lib.rs                        # Program entry point + instruction dispatch
│   │   ├── state.rs                      # Account structs (Markets, Oracle, UserAccount, Position)
│   │   ├── error.rs                      # Custom error codes
│   │   ├── constants.rs                  # PDA seeds, funding rate parameters
│   │   ├── utils.rs                      # PnL + funding rate calculations
│   │   └── instructions/                 # One file per instruction handler
│   ├── scripts/                          # Deploy, initialize, oracle scripts
│   └── tests/full-flow-test.ts           # Integration test (full trading lifecycle)
├── app/
│   ├── components/                       # React UI (markets, positions, account overview)
│   ├── hooks/                            # Custom hooks for on-chain reads + writes
│   ├── generated/perps/                  # Auto-generated TypeScript client (do not edit)
│   ├── lib/                              # Constants, PDA derivation, formatters
│   └── layout.tsx                        # App shell with navbar + grid layout
├── codama.json                           # Codama client generation config
└── package.json                          # Scripts: setup, workflow, dev, test
```

## Getting Started

### Prerequisites

- [Rust](https://rustup.rs/)
- [Solana CLI](https://solana.com/docs/intro/installation)
- [Anchor CLI](https://www.anchor-lang.com/docs/installation) (1.0.0-rc.2)
- [Surfpool](https://github.com/txtx/surfpool) — local Solana development environment
- Node.js 18+

### 1. Clone and Install

```bash
git clone <repo-url>
cd solana-perps-tutorial
npm install
```

### 2. Start Surfpool

```bash
surfpool start
```

This starts a local Solana environment on `localhost:8899`. Keep this terminal open — steps 3 and 4 require a running validator.

### 3. Create the USDC Mint

```bash
# Create the USDC mint (uses the keypair in usdc-mint.json)
spl-token create-token --decimals 6 usdc-mint.json
```

This must happen before deploying — the workflow scripts reference the USDC mint.

### 4. Deploy the contracts

```bash
# Update the anchor keys / program ID
cd anchor && anchor keys sync && cd ..

# Build, deploy, initialize program, and create markets
npm run workflow
```

Note the **vault PDA address** printed in the deployment logs — you'll need it in the next step.

### 5. Fund Accounts

```bash
# Create a token account and mint 2000 USDC (1000 for you, 1000 for the vault)
spl-token create-account $(solana-keygen pubkey usdc-mint.json)
spl-token mint $(solana-keygen pubkey usdc-mint.json) 2000

# Transfer USDC and SOL to your wallet
export USER_ADDRESS=<your-wallet-address>
spl-token transfer $(solana-keygen pubkey usdc-mint.json) 1000 $USER_ADDRESS \
  --fund-recipient --allow-unfunded-recipient
solana transfer $USER_ADDRESS 1 --url localhost --allow-unfunded-recipient

# Fund the vault so it can pay out winning trades
# The vault PDA address is printed in the logs from step 4
export VAULT_PDA=<vault-pda-address>
spl-token mint $(solana-keygen pubkey usdc-mint.json) 1000 $VAULT_PDA
```

### 6. Run

Open three terminals (Surfpool should already be running from step 2):


| Terminal | Command               | What it does                                                   |
| -------- | --------------------- | -------------------------------------------------------------- |
| 1        | `surfpool start`      | Local Solana environment on `localhost:8899`                   |
| 2        | `npm run mock-oracle` | Simulated price feed — see [Simplifications](#simplifications) |
| 3        | `npm run dev`         | Next.js frontend on `localhost:3000`                           |


Open [http://localhost:3000](http://localhost:3000), connect your wallet, and trade.

## Deep Dive

### Funding Rate

The funding rate uses a **cumulative index** system — instead of tracking every payment, each position stores the index at entry and calculates the difference at close:

- Every 5 minutes (`FUNDING_INTERVAL = 300s`), funding can be updated
- The rate is proportional to OI imbalance: `(long_OI - short_OI) / total_OI * MAX_FUNDING_RATE`
- `MAX_FUNDING_RATE` is 0.1% per interval (`1_000` out of `FUNDING_RATE_BASE = 1_000_000`)
- When a position opens, it stores the current cumulative index as `entry_funding_index`
- At close: `funding_pnl = (current_index - entry_index) * collateral / FUNDING_RATE_BASE`
- Funding indices are updated **before** any OI change in `open_position` and `close_position` — this ensures accurate accumulation even when positions change the OI balance

### PnL Calculation

All amounts use 6-decimal fixed point (`1_000_000` = 1.00 USDC), matching USDC's native precision.

**Price PnL** (profit/loss from price movement):

```
Long:  (current_price - entry_price) * position_size / 10^6
Short: (entry_price - current_price) * position_size / 10^6
```

**Funding PnL** (accumulated funding payments):

```
index_diff = current_cumulative_index - entry_funding_index
Long:  -(index_diff * collateral / FUNDING_RATE_BASE)   // longs pay when index increases
Short:  (index_diff * collateral / FUNDING_RATE_BASE)    // shorts receive
```

**Total PnL** = price PnL + funding PnL. On close, token transfers settle the result: losses move from the user's collateral account to the vault, profits move from the vault to the user.

## Frontend

The app uses a `SolanaProvider` (from `@solana/react-hooks`) connected to `localhost:8899`. Any browser wallet extension works. See `app/components/providers.tsx`.

The `app/generated/perps/` directory is auto-generated from the Anchor IDL by Codama — regenerate after program changes with `npm run setup`.

### Hooks


| Hook               | Purpose                                        |
| ------------------ | ---------------------------------------------- |
| `useMarkets`       | Fetch all perps markets                        |
| `usePositions`     | Fetch user's open positions across all markets |
| `useOraclePrices`  | Fetch oracle prices (auto-refreshes every 5s)  |
| `useCollateral`    | Fetch user's available and locked collateral   |
| `useOpenPosition`  | Send open position transaction                 |
| `useClosePosition` | Send close position transaction                |
| `useDeposit`       | Send deposit collateral transaction            |
| `useWithdraw`      | Send withdraw collateral transaction           |
| `usePositionPnl`   | Fetch real-time PnL via transaction simulation |
| `usePdas`          | Derive all program PDA addresses client-side   |


## Testing

```bash
npm run anchor-build
npm run anchor-test
```

Tests use [LiteSVM](https://github.com/LiteSVM/litesvm) — a fast in-process Solana VM that doesn't need a running validator. The integration test in `anchor/tests/full-flow-test.ts` covers the full trading lifecycle: initialize, deposit, open position, check PnL at different prices, close at profit/loss, and withdraw.

**Important:** Stop any running Surfpool before running tests — `anchor test` starts its own validator, and a port conflict on 8899 causes stale-state failures.

## Scripts


| Script           | Command                  | Description                                |
| ---------------- | ------------------------ | ------------------------------------------ |
| `setup`          | `npm run setup`          | Build program + generate TypeScript client |
| `workflow`       | `npm run workflow`       | Build, deploy, initialize, create markets  |
| `dev`            | `npm run dev`            | Start Next.js dev server                   |
| `anchor-build`   | `npm run anchor-build`   | Compile the Anchor program                 |
| `anchor-test`    | `npm run anchor-test`    | Run integration tests                      |
| `anchor-deploy`  | `npm run anchor-deploy`  | Deploy program to current cluster          |
| `init-program`   | `npm run init-program`   | Initialize program PDAs                    |
| `create-markets` | `npm run create-markets` | Create perps markets with oracle prices    |
| `mock-oracle`    | `npm run mock-oracle`    | Stream mock price data                     |
| `update-oracle`  | `npm run update-oracle`  | One-time oracle price update               |
| `codama:js`      | `npm run codama:js`      | Regenerate TypeScript client from IDL      |


## Design Decisions

### Why per-user PDA token accounts instead of one shared vault?

If all user deposits go into one vault, a winning trader withdraws profits that came from other users' deposits — there's no counterparty. By separating user collateral from the LP vault, profits/losses flow explicitly between traders and the LP pool, making the fund flow auditable and correct.

### Why not store a `collateral` balance in `UserAccount`?

The user's collateral token account already holds the actual USDC balance. Duplicating it in a `collateral` field means two sources of truth that must stay in sync. Instead, `UserAccount` only stores `locked_collateral` (a counter that can't be derived from the token account alone), and available collateral is computed as `token_account.amount - locked_collateral`.

### Why PDA token accounts instead of Associated Token Accounts (ATAs)?

ATAs are owned by the user's wallet — the program can't sign transfers out of them. PDA token accounts with self-authority let the program sign CPI transfers using PDA seeds, which is essential for the settlement flow where the program must move tokens without the user explicitly signing each transfer.

## Learn More

- [Solana Docs](https://solana.com/docs) — core concepts and guides
- [Anchor Docs](https://www.anchor-lang.com/docs) — program development framework
- [Codama](https://github.com/codama-idl/codama) — client generation from IDL
- [Solana Kit](https://github.com/solana-foundation/solana-kit) — `@solana/client` and `@solana/react-hooks`

