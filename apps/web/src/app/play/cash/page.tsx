import { Suspense } from "react";
import { CashScreen } from "../../../components/CashScreen";
import { LoadingBlock } from "../../../components/Bits";

export default function CashPage() {
  return (
    <Suspense fallback={<LoadingBlock label="Loading your cash" rows={4} />}>
      <CashScreen />
    </Suspense>
  );
}
