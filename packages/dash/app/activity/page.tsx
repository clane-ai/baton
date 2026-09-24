import { Suspense } from "react";
import ActivityScreen from "@/components/activity/ActivityScreen";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<div className="muted">Loading…</div>}>
      <ActivityScreen />
    </Suspense>
  );
}
