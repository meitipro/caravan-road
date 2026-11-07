"use client";

import useSWR from "swr";
import { getApi, IS_MOCK, unwrap } from "../ui/api";
import { formatCoins } from "../ui/format";
import { EmptyState, ErrorState, LoadingBlock, Money, Page } from "./Bits";
import { useGame } from "./GameProvider";

const MEDALS = ["Gold", "Silver", "Bronze"] as const;

export function RanksScreen() {
  const { me } = useGame();
  const { data, error, isLoading, mutate } = useSWR("leaderboard", async () => unwrap(await getApi().leaderboard()), {
    refreshInterval: 10000,
    keepPreviousData: true,
  });

  const rows = data?.rows ?? [];
  const myIndex = me ? rows.findIndex((r) => r.name === me.display_name) : -1;

  return (
    <Page title="Ranks" subtitle="Richest merchants first. Net worth is coins plus goods at base prices.">
      {isLoading && !data && <LoadingBlock label="Loading the ranks" rows={6} />}
      {error && !data && <ErrorState title="Could not load the ranks" onRetry={() => void mutate()}>We will keep trying.</ErrorState>}
      {data && rows.length === 0 && <EmptyState title="Nobody is on the road yet">Be the first merchant to make a profit.</EmptyState>}

      {data && rows.length > 0 && (
        <>
          {myIndex >= 0 && (
            <div className="panel pinned" aria-label="Your rank">
              <span className="muted small">Your rank</span>
              <span className="num rank-big">#{myIndex + 1}</span>
              <span className="strong grow">{rows[myIndex]!.name}</span>
              <Money fils={rows[myIndex]!.net_worth} />
            </div>
          )}
          <div className="panel table-wrap">
            <table className="table">
              <caption className="sr-only">Leaderboard by net worth in coins</caption>
              <thead>
                <tr><th scope="col">Rank</th><th scope="col">Merchant</th><th scope="col" className="right">Net worth</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const mine = i === myIndex;
                  return (
                    <tr key={`${r.name}-${i}`} className={mine ? "mine" : ""} aria-current={mine ? "true" : undefined}>
                      <td>
                        {i < 3 ? (
                          <span className={`medal medal-${i + 1}`}>
                            <span aria-hidden="true">{i + 1}</span>
                            <span className="sr-only">{MEDALS[i]} medal, rank {i + 1}</span>
                          </span>
                        ) : (
                          <span className="num">{i + 1}</span>
                        )}
                      </td>
                      <td>{r.name}{mine && <span className="chip you-chip">You</span>}</td>
                      <td className="right num">{formatCoins(r.net_worth)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            Updates every 10 seconds.{IS_MOCK ? " The other merchants in this demo are sample players, not real people." : ""}
          </p>
        </>
      )}
    </Page>
  );
}
