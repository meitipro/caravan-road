import { getRoute } from "../../../../server/http";
import { getProof } from "../../../../server/game/state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ merchant: string }> }): Promise<Response> {
  const { merchant } = await ctx.params;
  return getRoute({ auth: "none", run: ({ svc }) => getProof(svc, merchant) })(req);
}
