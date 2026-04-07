# Perps DEX — Solana Tutorial

A full-stack perpetual futures DEX on Solana, built as a hands-on tutorial for developers entering the Solana ecosystem.

### What you'll learn

- Designing an Anchor program with PDA-based account architecture
- The full position lifecycle: collateral, leverage, PnL settlement
- Funding rate mechanics using a cumulative index system
- Connecting a Next.js frontend to an on-chain program with Codama-generated clients

## What Are Perpetual Futures?

A perpetual future (perp) lets you go **long** (bet price goes up) or **short** (bet price goes down) on an asset without an expiry date. Unlike spot trading, you don't hold the underlying token — you hold a **position** backed by USDC collateral. A **funding rate** mechanism keeps the perp price anchored to the spot price: whichever side has more open interest pays the other side periodically.

## Architecture

![Architecture](./architecture.png)

The frontend constructs transactions using a [Codama](https://github.com/codama-idl/codama)-generated TypeScript client and sends them to the Anchor program. All state lives on-chain in Program Derived Address (PDA) accounts — no server or database needed.

| Layer          | Technology                              |
| -------------- | --------------------------------------- |
| Frontend       | Next.js 16, React 19, TypeScript        |
| Styling        | Tailwind CSS v4                         |
| Solana Client  | `@solana/client`, `@solana/react-hooks` |
| Program Client | Codama-generated, `@solana/kit`         |
| Program        | Anchor 1.0.0-rc.2 (Rust)                |

## Project Structure

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

## The Trading Lifecycle

```
1. Deposit Collateral  →  USDC transferred from wallet to per-user collateral token account (PDA)
2. Open Position        →  Lock collateral, create Position account, update open interest
3. Monitor PnL          →  View-only instruction returns price PnL + funding PnL
4. Close Position       →  Settle PnL with actual token transfers, unlock collateral, close Position account
5. Withdraw Collateral  →  Transfer USDC from user's collateral token account back to wallet
```

**Decimal convention:** All amounts use 6-decimal fixed point — `1_000_000` = 1.00 USDC = 1.00 token unit. This matches USDC's native precision and keeps all math consistent.

**One position per market:** Position PDAs are seeded with `["position", user_pubkey, token_mint]`, which means a user can only hold one open position per market. To switch direction, close first.

### Fund Flow

The protocol separates **user collateral** from the **LP vault** to create a clear counterparty relationship:

```
                    ┌──────────────────────┐
   Deposit          │  User Collateral     │
   Wallet ────────► │  Token Account (PDA) │ ◄──── Withdraw
                    │  ["user_collateral", │       back to wallet
                    │   wallet]            │
                    └──────────┬───────────┘
                               │
                  Close Position (PnL settlement)
                               │
              Loss ────────────┼────────────── Win
              tokens flow      │         tokens flow
              to vault         │         from vault
                               │
                    ┌──────────▼───────────┐
                    │  Vault / LP Pool     │
                    │  Token Account (PDA) │
                    │  ["vault"]           │
                    │                      │
                    │  Pre-funded by the   │
                    │  protocol            │
                    └──────────────────────┘
```

- **User collateral account**: Each user gets their own PDA token account (`["user_collateral", wallet]`). Deposits go here, withdrawals come from here. The program controls transfers via PDA signing.
- **Vault (LP pool)**: A shared token account (`["vault"]`) that acts as the counterparty to all traders. When a trader loses, the loss amount is transferred from their collateral account to the vault. When a trader wins, the profit is paid from the vault to their collateral account.
- **No token movement on open/close of position itself**: Collateral is only "locked" in accounting when a position opens. Actual token transfers only happen for PnL settlement on close.

### Design Decisions

**Why per-user PDA token accounts instead of one shared vault?**
If all user deposits go into one vault, a winning trader withdraws profits that came from other users' deposits — there's no counterparty. By separating user collateral from the LP vault, profits/losses flow explicitly between traders and the LP pool, making the fund flow auditable and correct.

**Why not store a `collateral` balance in `UserAccount`?**
The user's collateral token account already holds the actual USDC balance. Duplicating it in a `collateral` field means two sources of truth that must stay in sync. Instead, `UserAccount` only stores `locked_collateral` (a counter that can't be derived from the token account alone), and available collateral is computed as `token_account.amount - locked_collateral`.

**Why PDA token accounts instead of Associated Token Accounts (ATAs)?**
ATAs are owned by the user's wallet — the program can't sign transfers out of them. PDA token accounts with self-authority (`token::authority = user_collateral_token_account`) let the program sign CPI transfers using PDA seeds, which is essential for the settlement flow where the program must move tokens without the user explicitly signing each transfer.

## Program Deep Dive

### Accounts

| Account          | PDA Seeds                              | What It Stores                                          |
| ---------------- | -------------------------------------- | ------------------------------------------------------- |
| `Markets`        | `["markets"]`                          | Vec of PerpsMarket (token, name, OI, funding indices)   |
| `Oracle`         | `["oracle"]`                           | Vec of OraclePrice (token, price, timestamp)            |
| `UserAccount`    | `["user", wallet]`                     | Authority, locked collateral (balance read from token account) |
| `UserCollateral` | `["user_collateral", wallet]`          | Per-user token account holding deposited USDC           |
| `Position`       | `["position", wallet, token_mint]`     | Direction, entry price, size, collateral, funding index |
| `Vault`          | `["vault"]`                            | LP pool token account (protocol-funded counterparty)    |

`Markets` and `Oracle` are singleton accounts — one of each for the entire program. This simplifies PDA derivation (no dynamic seeds) and keeps all market data in one place for easy iteration. The tradeoff is a size limit (`MAX_MARKETS = 10`), which is fine for a tutorial.

### Instructions

| Category        | Instruction                     | Description                                       |
| --------------- | ------------------------------- | ------------------------------------------------- |
| **Setup**       | `initialize`                    | Create Markets, Oracle, and Vault PDAs            |
|                 | `initialize_market_with_oracle` | Add a new perps market with initial oracle price  |
| **Trading**     | `deposit_collateral`            | Transfer USDC from wallet to user's collateral account |
|                 | `open_position`                 | Lock collateral, create Position PDA, update OI        |
|                 | `view_position_pnl`             | Read-only: returns price PnL + funding PnL             |
|                 | `close_position`                | Settle PnL (token transfers), unlock collateral, close Position PDA |
|                 | `withdraw_collateral`           | Transfer available USDC from collateral account to wallet |
| **Maintenance** | `update_funding`                | Update cumulative funding indices                 |
|                 | `update_oracle`                 | Update oracle price for a token                   |

### Funding Rate

The funding rate uses a **cumulative index** system — instead of tracking every payment, each position stores the index at entry and calculates the difference at close:

- Every 5 minutes (`FUNDING_INTERVAL = 300s`), funding can be updated
- The rate is proportional to OI imbalance: `(long_OI - short_OI) / total_OI * MAX_FUNDING_RATE`
- `MAX_FUNDING_RATE` is 0.1% per interval (`1_000` out of `FUNDING_RATE_BASE = 1_000_000`)
- When a position opens, it stores the current cumulative index as `entry_funding_index`
- At close: `funding_pnl = (current_index - entry_index) * collateral / FUNDING_RATE_BASE`
- Funding indices are updated **before** any OI change in `open_position` and `close_position` — this ensures accurate accumulation even when positions change the OI balance

### PnL Calculation

**Price PnL** (unrealized profit/loss from price movement):

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

**Total PnL** = price PnL + funding PnL. When a position is closed, actual token transfers settle the PnL: losses move from the user's collateral token account to the vault (LP pool), and profits move from the vault to the user's collateral token account.

## Frontend

### Provider Setup

The app wraps everything in a `SolanaProvider` (from `@solana/react-hooks`) connected to `http://localhost:8899` (localnet). Wallet connectors are auto-discovered — any browser wallet extension works.

See `app/components/providers.tsx`.

### Codama-Generated Client

The `app/generated/perps/` directory is auto-generated from the Anchor IDL using [Codama](https://github.com/codama-idl/codama). It provides:

- **Account decoders** — type-safe fetching of Markets, Oracle, UserAccount, Position
- **Instruction data encoders** — build instruction data for each program instruction
- **Type definitions** — PerpsMarket, OraclePrice, PositionDirection, PnlInfo

Regenerate after program changes: `npm run setup` (or `npm run anchor-build && npm run codama:js`).

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

PDA derivation on the client (in `app/lib/pdas.ts`) must use the same seeds as the program — `["position", wallet_bytes, token_mint_bytes]`, `["user_collateral", wallet_bytes]`, etc. The `usePdas` hook wraps this for convenience.

## Getting Started

### Prerequisites

- [Rust](https://rustup.rs/)
- [Solana CLI](https://solana.com/docs/intro/installation)
- [Anchor CLI](https://www.anchor-lang.com/docs/installation) (1.0.0-rc.2)
- Node.js 18+

### 1. Install Dependencies

```bash
git clone <repo-url>
cd perps-dex
npm install
```

### 2. Start a Local Validator

```bash
# Terminal 1
solana-test-validator
```

This starts a local Solana cluster on `localhost:8899`.

### 3. Build, Deploy, and Initialize

```bash
# Terminal 2
npm run workflow
```

This runs four steps in sequence:

1. **`anchor-build`** — compiles the Rust program
2. **`anchor-deploy`** — deploys it to the local validator
3. **`init-program`** — creates the Markets, Oracle, and Vault PDAs
4. **`create-markets`** — adds perps markets (SOL, etc.) with initial oracle prices

### 4. Start the Mock Oracle

```bash
# Terminal 3
npm run mock-oracle
```

Streams simulated price updates to the on-chain oracle account via WebSocket.

### 5. Start the Frontend

```bash
# Terminal 4
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), connect your wallet, and trade.

### Getting Test USDC

To deposit collateral, your wallet needs USDC tokens on localnet. Run:

```bash
npx tsx anchor/scripts/setup-user-usdc.ts
```

This creates a USDC token account for your wallet and mints test tokens.

## Testing

```bash
npm run anchor-build
npm run anchor-test
```

Tests use [LiteSVM](https://github.com/LiteSVM/litesvm) — a fast in-process Solana VM that doesn't need a running validator. The integration test in `anchor/tests/full-flow-test.ts` covers the full trading lifecycle: initialize, deposit, open position, check PnL at different prices, close at profit/loss, and withdraw.

**Important:** Stop any running Surfpool or `solana-test-validator` before running tests. `anchor test` starts its own clean validator — if another validator is already on port 8899, the tests will connect to it instead and fail due to stale state (e.g., vault initialized with a different USDC mint from a previous session).

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

## Learn More

- [Solana Docs](https://solana.com/docs) — core concepts and guides
- [Anchor Docs](https://www.anchor-lang.com/docs) — program development framework
- [Codama](https://github.com/codama-idl/codama) — client generation from IDL
- [Solana Kit](https://github.com/solana-foundation/solana-kit) — `@solana/client` and `@solana/react-hooks`
- [Deploying Programs](https://solana.com/docs/programs/deploying) — deployment guide
