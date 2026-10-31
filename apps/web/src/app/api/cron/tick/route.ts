import { cronRoute } from "../../../../server/http";
import { cronTick } from "../../../../server/game/cron";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handler = cronRoute(cronTick);
export const GET = handler;
export const POST = handler;
