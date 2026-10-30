import { notFound } from "next/navigation";
import { CITY_IDS, type CityId } from "@caravan/shared";
import { ProofScreen } from "../../../../components/ProofScreen";

export default async function ProofPage({ params }: { params: Promise<{ merchant: string }> }) {
  const { merchant } = await params;
  if (!(CITY_IDS as readonly string[]).includes(merchant)) notFound();
  return <ProofScreen merchant={merchant as CityId} />;
}
