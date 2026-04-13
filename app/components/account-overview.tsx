"use client";

import { useState } from "react";
import { useWalletConnection } from "@solana/react-hooks";
import { useAccountHealth } from "../hooks/useAccountHealth";
import { useDeposit } from "../hooks/useDeposit";
import { useWithdraw } from "../hooks/useWithdraw";
import { useTokenAccount } from "../hooks/useTokenAccount";
import { useTokenBalance } from "../hooks/useTokenBalance";
import { usePositions } from "../hooks/usePositions";
import { formatUsdc } from "../lib/format";
import { USDC_DECIMALS, USDC_MINT_ADDRESS } from "../lib/constants";
import { Card, Dialog, ErrorBanner, StatRow } from "./ui";

/**
 * Account overview showing portfolio value, PnL, margin, leverage, and health.
 */
export function AccountOverview() {
  const { wallet } = useWalletConnection();
  const {
    totalUnrealizedPnl,
    totalMaintenanceMargin,
    portfolioValue,
    availableCollateral,
    healthFactor,
    accountLeverage,
    collateralBalance,
    isLoading,
  } = useAccountHealth();
  const { positions } = usePositions();
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  if (!wallet?.account.address) {
    return (
      <Card>
        <div className="p-6">
          <p className="text-sm font-semibold mb-4">Account Overview</p>
          <div className="rounded-xl bg-surface px-4 py-8 text-center text-sm text-muted">
            Connect your wallet to view account details
          </div>
        </div>
      </Card>
    );
  }

  // Health factor color: green >= 2, yellow 1.2-2, red < 1.2
  const healthColor =
    healthFactor === null
      ? ""
      : healthFactor >= 2
        ? "text-long"
        : healthFactor >= 1.2
          ? "text-yellow-400"
          : "text-short";

  const pnlColor =
    totalUnrealizedPnl > 0n
      ? "text-long"
      : totalUnrealizedPnl < 0n
        ? "text-short"
        : "";

  const pnlPrefix = totalUnrealizedPnl >= 0n ? "+" : "-";
  const pnlAbsolute = totalUnrealizedPnl >= 0n ? totalUnrealizedPnl : -totalUnrealizedPnl;

  return (
    <Card>
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Account Overview</p>
            <p className="mt-0.5 text-xs text-muted">
              {positions.length} open {positions.length === 1 ? "position" : "positions"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDepositOpen(true)}
              disabled={isLoading}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition hover:bg-primary-hover disabled:opacity-50"
            >
              Deposit
            </button>
            <button
              onClick={() => setWithdrawOpen(true)}
              disabled={isLoading || collateralBalance <= 0n}
              className="rounded-lg border border-border-low bg-surface px-3 py-1.5 text-xs font-medium text-muted transition hover:text-foreground hover:border-border-strong hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Withdraw
            </button>
          </div>
        </div>

        <div className="space-y-3">
          <StatRow label="Portfolio Value" isLoading={isLoading}>
            {formatUsdc(portfolioValue)} USDC
          </StatRow>
          <StatRow label="Unrealized PNL" isLoading={isLoading} className={pnlColor}>
            {pnlPrefix}{formatUsdc(pnlAbsolute)} USDC
          </StatRow>
          <StatRow label="Perps Maintenance Margin" isLoading={isLoading}>
            {formatUsdc(totalMaintenanceMargin)} USDC
          </StatRow>
          <StatRow label="Account Leverage" isLoading={isLoading}>
            {accountLeverage.toFixed(2)}x
          </StatRow>
          <StatRow label="Health Factor" isLoading={isLoading} className={healthColor}>
            {healthFactor === null ? "\u2014" : healthFactor.toFixed(2)}
          </StatRow>
        </div>
      </div>

      {depositOpen && (
        <DepositDialog
          onClose={() => setDepositOpen(false)}
          onSuccess={() => setDepositOpen(false)}
        />
      )}
      {withdrawOpen && (
        <WithdrawDialog
          onClose={() => setWithdrawOpen(false)}
          onSuccess={() => setWithdrawOpen(false)}
          maxAmount={availableCollateral}
        />
      )}
    </Card>
  );
}

/**
 * Dialog for depositing USDC collateral.
 * @param onClose - Callback when dialog is closed.
 * @param onSuccess - Callback when deposit succeeds.
 */
function DepositDialog({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { deposit, isLoading, error } = useDeposit();
  const userTokenAccount = useTokenAccount(USDC_MINT_ADDRESS);
  const { balance: walletBalance } = useTokenBalance(userTokenAccount);
  const [amount, setAmount] = useState("");

  /**
   * Fires the deposit transaction and calls onSuccess if it lands.
   */
  const handleDeposit = async () => {
    if (!amount || parseFloat(amount) <= 0 || !userTokenAccount) return;
    const amountLamports = Math.floor(parseFloat(amount) * 10 ** USDC_DECIMALS);
    const sig = await deposit(amountLamports, userTokenAccount);
    if (sig) onSuccess();
  };

  /**
   * Sets the input to the user's full wallet balance.
   */
  const handleMax = () => {
    if (walletBalance === null) return;
    setAmount((Number(walletBalance) / 10 ** USDC_DECIMALS).toString());
  };

  const balanceDisplay = walletBalance !== null
    ? (Number(walletBalance) / 10 ** USDC_DECIMALS).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : null;

  return (
    <Dialog onClose={onClose} title="Deposit Collateral">
      <p className="text-sm text-muted">
        Deposit USDC to use as collateral for perpetual futures trading.
      </p>

      <AmountInput
        amount={amount}
        onChange={setAmount}
        onMax={handleMax}
        maxLabel={balanceDisplay ? `${balanceDisplay}` : "\u2014"}
        maxDisabled={!walletBalance || walletBalance === 0n}
        disabled={isLoading}
      />

      {balanceDisplay && (
        <div className="rounded-lg bg-surface px-3 py-2 text-xs text-muted">
          Wallet Balance:{" "}
          <span className="font-mono font-semibold text-foreground">{balanceDisplay} USDC</span>
        </div>
      )}

      {error && <ErrorBanner message={error.message} />}

      <button
        onClick={handleDeposit}
        disabled={isLoading || !amount || parseFloat(amount) <= 0 || !userTokenAccount}
        className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isLoading ? "Depositing\u2026" : "Deposit USDC"}
      </button>
    </Dialog>
  );
}

/**
 * Dialog for withdrawing USDC collateral.
 * @param onClose - Callback when dialog is closed.
 * @param onSuccess - Callback when withdrawal succeeds.
 * @param maxAmount - Maximum withdrawable amount in base units.
 */
function WithdrawDialog({
  onClose,
  onSuccess,
  maxAmount,
}: {
  onClose: () => void;
  onSuccess: () => void;
  maxAmount: bigint;
}) {
  const { withdraw, isLoading, error } = useWithdraw();
  const userTokenAccount = useTokenAccount(USDC_MINT_ADDRESS);
  const [amount, setAmount] = useState("");
  const maxAmountDisplay = Number(maxAmount) / 10 ** USDC_DECIMALS;

  /**
   * Fires the withdraw transaction and calls onSuccess if it lands.
   */
  const handleWithdraw = async () => {
    if (!amount || parseFloat(amount) <= 0 || !userTokenAccount) return;
    const amountLamports = Math.floor(parseFloat(amount) * 10 ** USDC_DECIMALS);
    const sig = await withdraw(amountLamports, userTokenAccount);
    if (sig) onSuccess();
  };

  /**
   * Sets the input to the maximum available collateral.
   */
  const handleMax = () => setAmount(maxAmountDisplay.toString());

  return (
    <Dialog onClose={onClose} title="Withdraw Collateral">
      <p className="text-sm text-muted">
        Withdraw USDC collateral from your trading account.
      </p>

      <AmountInput
        amount={amount}
        onChange={setAmount}
        onMax={handleMax}
        maxLabel={`${maxAmountDisplay.toLocaleString("en-US", { maximumFractionDigits: 2 })}`}
        maxDisabled={maxAmount === 0n}
        disabled={isLoading}
        max={maxAmountDisplay}
      />

      <div className="rounded-lg bg-surface px-3 py-2 text-xs text-muted">
        Available Collateral:{" "}
        <span className="font-mono font-semibold text-foreground">
          {maxAmountDisplay.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC
        </span>
      </div>

      {parseFloat(amount) > maxAmountDisplay && (
        <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-400">
          Amount exceeds available collateral
        </div>
      )}

      {error && <ErrorBanner message={error.message} />}

      <button
        onClick={handleWithdraw}
        disabled={isLoading || !amount || parseFloat(amount) <= 0 || parseFloat(amount) > maxAmountDisplay || !userTokenAccount}
        className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isLoading ? "Withdrawing\u2026" : "Withdraw USDC"}
      </button>
    </Dialog>
  );
}

/**
 * Amount input field with a Max button, used in deposit/withdraw dialogs.
 * @param amount - Current input value.
 * @param onChange - Callback when input changes.
 * @param onMax - Callback when Max is clicked.
 * @param maxLabel - Display text for the max amount.
 * @param maxDisabled - Whether the Max button is disabled.
 * @param disabled - Whether the input is disabled.
 * @param max - Optional max value for the input.
 */
function AmountInput({
  amount,
  onChange,
  onMax,
  maxLabel,
  maxDisabled,
  disabled,
  max,
}: {
  amount: string;
  onChange: (value: string) => void;
  onMax: () => void;
  maxLabel: string;
  maxDisabled: boolean;
  disabled: boolean;
  max?: number;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium uppercase tracking-wide text-muted">
          Amount (USDC)
        </label>
        <button
          onClick={onMax}
          disabled={maxDisabled}
          className="text-xs font-medium text-muted transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          Max: {maxLabel} USDC
        </button>
      </div>
      <input
        type="number"
        value={amount}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0.00"
        step="0.01"
        min="0"
        max={max}
        disabled={disabled}
        className="w-full rounded-xl border border-input-border bg-input-bg px-4 py-3 text-lg font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-50"
      />
    </div>
  );
}
