import { postRoute } from "../../../server/http";
import { faucetSpec } from "../../../server/game/actions";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = postRoute(faucetSpec);
