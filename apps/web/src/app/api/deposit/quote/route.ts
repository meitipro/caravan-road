import { postRoute } from "../../../../server/http";
import { depositQuoteSpec } from "../../../../server/game/money";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = postRoute(depositQuoteSpec);
