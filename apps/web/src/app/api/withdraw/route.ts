import { postRoute } from "../../../server/http";
import { withdrawSpec } from "../../../server/game/money";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = postRoute(withdrawSpec);
