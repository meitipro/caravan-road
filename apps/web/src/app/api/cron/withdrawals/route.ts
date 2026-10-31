import { cronRoute } from "../../../../server/http";
import { cronWithdrawals } from "../../../../server/game/cron";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handler = cronRoute(cronWithdrawals);
export const GET = handler;
export const POST = handler;
