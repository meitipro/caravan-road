import { getRoute } from "../../../server/http";
import { getStateData } from "../../../server/game/state";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = getRoute({ auth: "optional", provision: true, run: ({ svc, user }) => getStateData(svc, user) });
