import { getRoute } from "../../../../server/http";
import { getDecisions } from "../../../../server/game/state";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = getRoute({ auth: "none", run: ({ svc, req }) => getDecisions(svc, req) });
