import { devLogout } from "../../../../server/dev/login";
import { assertDevFlagsSafe } from "../../../../server/dev/flags";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

assertDevFlagsSafe(process.env);

export const POST = (req: Request) => devLogout(req);
export const GET = (req: Request) => devLogout(req);
