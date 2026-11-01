import { devLogin } from "../../../../server/dev/login";
import { assertDevFlagsSafe } from "../../../../server/dev/flags";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

assertDevFlagsSafe(process.env); // importing this route with DEV_LOGIN=1 in production throws

export const POST = (req: Request) => devLogin(req);
export const GET = (req: Request) => devLogin(req);
