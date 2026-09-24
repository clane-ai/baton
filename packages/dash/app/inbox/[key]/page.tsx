import ItemScreen from "@/components/item/ItemScreen";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return <ItemScreen itemKey={key} />;
}
