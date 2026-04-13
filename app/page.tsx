import { AccountOverview } from "./components/account-overview";
import { Markets } from "./components/markets";
import { PositionsTable } from "./components/positions-table";

export default function Home() {
  return (
    <div className="mx-auto w-full max-w-7xl grid grid-cols-[2fr_1fr] gap-4 p-4">
      <div className="col-span-2">
        <Markets />
      </div>
      <PositionsTable />
      <AccountOverview />
    </div>
  );
}
