import { SkeletonStat } from "./_components/ui";

export default function ControlLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <p className="cp-eyebrow">Loading workspace</p>
      <p className="cp-subtitle">Fetching current records…</p>
      <div aria-hidden="true">
        <SkeletonStat />
      </div>
    </div>
  );
}
