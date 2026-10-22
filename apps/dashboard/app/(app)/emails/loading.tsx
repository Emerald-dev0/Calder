import { DsSkeleton } from "../../../components/design-system";

/**
 * Skeleton matching the final layout: header with the action cluster, project
 * picker, stream tabs, the filter row and the five-column table. The row height
 * is the same 40–44px band the real table uses, so nothing jumps on arrival.
 */
export default function EmailsLoading() {
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div>
          <DsSkeleton width={160} height={26} />
          <div style={{ height: 8 }} />
          <DsSkeleton width={540} height={14} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <DsSkeleton width={96} height={34} />
          <DsSkeleton width={112} height={34} />
          <DsSkeleton width={116} height={34} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[80, 130, 120].map((w, i) => (
          <DsSkeleton key={i} width={w} height={30} />
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <DsSkeleton width={260} height={38} />
        {[130, 130, 140, 150, 140].map((w, i) => (
          <DsSkeleton key={i} width={w} height={38} />
        ))}
      </div>

      <div className="ds-table-shell">
        <div className="ds-table-scroll">
          <table className="ds-table">
            <thead>
              <tr>
                <th style={{ width: 128 }}>Status</th>
                <th>Recipient &amp; subject</th>
                <th style={{ width: 110 }}>Stream</th>
                <th style={{ width: 196 }}>Message ID</th>
                <th style={{ width: 120, textAlign: "right" }}>Created</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 10 }).map((_, i) => (
                <tr key={i}>
                  <td>
                    <DsSkeleton width={88} height={20} />
                  </td>
                  <td>
                    <DsSkeleton width={260} height={13} />
                    <div style={{ height: 6 }} />
                    <DsSkeleton width={180} height={11} />
                  </td>
                  <td>
                    <DsSkeleton width={92} height={20} />
                  </td>
                  <td>
                    <DsSkeleton width={150} height={12} />
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <DsSkeleton width={64} height={12} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
