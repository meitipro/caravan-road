import { postRoute } from "../../../../server/http";
import { stallBuySpec } from "../../../../server/game/actions";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = postRoute(stallBuySpec);
