import { getRoute } from "../../../server/http";
import { getLeaderboard } from "../../../server/game/state";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = getRoute({ auth: "none", run: ({ svc }) => getLeaderboard(svc) });
