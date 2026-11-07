import { getRoute } from "../../../server/http";
import { supportedAssets } from "../../../server/game/money";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Public: the assets 1Click supports, so the UI can offer real ids for deposits and withdrawals. LIVE only.
export const GET = getRoute({ auth: "none", run: supportedAssets });
