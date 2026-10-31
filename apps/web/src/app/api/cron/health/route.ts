import { cronRoute } from "../../../../server/http";
import { cronHealth } from "../../../../server/game/cron";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handler = cronRoute(cronHealth);
export const GET = handler;
export const POST = handler;
