import { getRoute } from "../../../../server/http";
import { depositStatus } from "../../../../server/game/money";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = getRoute({ auth: "required", run: depositStatus });
