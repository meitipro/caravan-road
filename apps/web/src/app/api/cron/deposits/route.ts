import { cronRoute } from "../../../../server/http";
import { cronDeposits } from "../../../../server/game/cron";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handler = cronRoute(cronDeposits);
export const GET = handler;
export const POST = handler;
