export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return <h1>Item {key}</h1>;
}
