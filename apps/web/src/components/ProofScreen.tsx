"use client";

// Raw inference evidence for a merchant. Technical vocabulary is allowed on this page.

import Link from "next/link";
import useSWR from "swr";
import type { CityId } from "@caravan/shared";
import { getApi, IS_MOCK, unwrap } from "../ui/api";
import { CITY_META } from "../ui/game-meta";
import { EmptyState, ErrorState, LoadingBlock, Page } from "./Bits";
import { evidenceBadge } from "./Mind";

export function ProofScreen({ merchant }: { merchant: CityId }) {
  const { data, error, isLoading, mutate } = useSWR(["proof", merchant], async () => unwrap(await getApi().proof(merchant)));
  const badge = evidenceBadge(data ? data.attested : null, IS_MOCK);

  return (
    <Page
      title={`${CITY_META[merchant].merchant}'s evidence`}
      subtitle="The latest record of the private inference behind this merchant's prices."
      actions={<Link className="btn btn-small" href={`/play/city/${merchant}`}>Back to {CITY_META[merchant].name}</Link>}
    >
      {isLoading && <LoadingBlock label="Loading evidence" rows={4} />}
      {error && <ErrorState title="Could not load the evidence" onRetry={() => void mutate()} />}
      {data === null && <EmptyState title="No evidence recorded yet">This merchant has not used the AI yet, or the record is not stored.</EmptyState>}
      {data && (
        <>
          <div className="panel stack-sm">
            <span className={`badge ${data.attested ? "badge-ok" : ""}`} title={badge.hint}>{badge.text}</span>
            {IS_MOCK && <p className="muted small">Sample data from the demo world. No AI was called.</p>}
            <p className="muted small">
              {data.attested
                ? "The attestation for this inference was checked."
                : "Evidence recorded. The attestation has not been verified, so this is not shown as verified."}
            </p>
          </div>
          <pre className="panel raw" tabIndex={0} aria-label="Raw evidence record">{JSON.stringify(data, null, 2)}</pre>
        </>
      )}
    </Page>
  );
}
