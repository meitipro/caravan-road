import Link from "next/link";
import { EmptyState } from "../../components/Bits";

// Lives inside the /play layout (below its error boundary and shell), so a bad city id shows this
// instead of "The caravan hit a rock".
export default function PlayNotFound() {
  return (
    <section className="page">
      <EmptyState title="There is no such place" action={<Link className="btn btn-primary" href="/play">Back to the map</Link>}>
        That address does not lead anywhere on the Silk Road.
      </EmptyState>
    </section>
  );
}
