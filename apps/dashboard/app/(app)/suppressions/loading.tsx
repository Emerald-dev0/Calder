import { DsSkeleton } from "../../../components/design-system";

/**
 * Skeleton matching the final layout: header, project picker, reason tabs,
 * search row, then the five-column table. Shapes are reserved so the page does
 * not shift when data lands.
 */
export default function SuppressionsLoading() {
  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <DsSkeleton width={220} height={26} />
        <div style={{ height: 8 }} />
        <DsSkeleton width={520} height={14} />
      </div>
      <div style={{ marginBottom: 20 }}>
        <DsSkeleton width={260} height={34} />
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[70, 110, 120, 100, 90].map((w, i) => (
          <DsSkeleton key={i} width={w} height={30} />
        ))}
      </div>
      <div style={{ marginBottom: 16 }}>
        <DsSkeleton width={420} height={38} />
      </div>
      <div className="ds-table-shell">
        <div className="ds-table-scroll">
          <table className="ds-table">
            <thead>
              <tr>
                <th>Suppressed address</th>
                <th style={{ width: 190 }}>Reason</th>
                <th style={{ width: 200 }}>Scope</th>
                <th style={{ width: 140 }}>Blocked</th>
                <th style={{ width: 150 }} />
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}>
                  <td>
                    <DsSkeleton width={220} height={13} />
                  </td>
                  <td>
                    <DsSkeleton width={90} height={20} />
                  </td>
                  <td>
                    <DsSkeleton width={150} height={12} />
                  </td>
                  <td>
                    <DsSkeleton width={70} height={12} />
                  </td>
                  <td>
                    <DsSkeleton width={80} height={26} />
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
