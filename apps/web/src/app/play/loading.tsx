import { LoadingBlock } from "../../components/Bits";

// Route-level loading state: shown instantly while a page segment compiles (next dev) or streams in,
// instead of leaving the previous screen frozen after a click.
export default function Loading() {
  return (
    <section className="page" aria-label="Loading the next screen">
      <LoadingBlock label="Loading the next screen" rows={4} />
    </section>
  );
}
