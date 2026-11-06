import { notFound } from "next/navigation";
import { CITY_IDS, type CityId } from "@caravan/shared";
import { StallsScreen } from "../../../../../components/StallsScreen";

export default async function StallsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(CITY_IDS as readonly string[]).includes(id)) notFound();
  return <StallsScreen id={id as CityId} />;
}
