import { Suspense } from "react";
import { JourneyScreen } from "../../../components/JourneyScreen";
import { LoadingBlock } from "../../../components/Bits";

export default function JourneyPage() {
  return (
    <Suspense fallback={<LoadingBlock label="Loading your caravan" rows={4} />}>
      <JourneyScreen />
    </Suspense>
  );
}
