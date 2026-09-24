import { notFound } from "next/navigation";
import OpsView from "@/components/shell/OpsView";
import { OPS_VIEWS, type OpsViewName } from "@/lib/ops";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  if (!(OPS_VIEWS as readonly string[]).includes(view)) notFound();
  return <OpsView view={view as OpsViewName} />;
}
