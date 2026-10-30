import { notFound } from "next/navigation";
import { CITY_IDS, type CityId } from "@caravan/shared";
import { CityScreen } from "../../../../components/CityScreen";

export default async function CityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(CITY_IDS as readonly string[]).includes(id)) notFound();
  return <CityScreen id={id as CityId} />;
}
