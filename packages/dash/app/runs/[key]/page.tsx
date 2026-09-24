import RunScreen from "@/components/runs/RunScreen";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return <RunScreen runKey={key} />;
}
