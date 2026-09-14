import { Reveal } from "./reveal";
import { COMPARISON, MARKETING_ALLOWANCES, PLANS, type ComparisonRow } from "../lib/plans";

/**
 * The full comparison. Two tables on purpose: sending and platform limits,
 * then marketing allowances. Mixing them is how "50,000 emails" quietly turns
 * into "50,000 emails minus your newsletter list".
 */

function StatusTag({ status }: { status?: "today" | "dev" }) {
  if (status !== "dev") return null;
  return <span className="plan-tag">in development</span>;
}

function Cell({ value }: { value: string }) {
  const state = value === "✓" ? "yes" : value === "—" ? "no" : "text";
  return (
    <span className={`cmp-cell ${state}`} aria-hidden={value === "—" ? true : undefined}>
      {value}
    </span>
  );
}

function Row({ row }: { row: ComparisonRow }) {
  return (
    <tr>
      <th scope="row">
        <span className="cmp-label">{row.label}</span>
        {row.status === "dev" && (
          <>
            {" "}
            <StatusTag status={row.status} />
          </>
        )}
        {row.note && <span className="cmp-note">{row.note}</span>}
      </th>
      {row.values.map((v, i) => (
        <td key={i}>
          <Cell value={v} />
        </td>
      ))}
    </tr>
  );
}

function PlanHead() {
  return (
    <thead>
      <tr>
        <th scope="col">
          <span className="visually-hidden">Feature</span>
        </th>
        {PLANS.map((p) => (
          <th scope="col" key={p.id}>
            <span className="cmp-plan">{p.name}</span>
            <span className="cmp-price mono">
              {p.price.USD}
              {p.volumeRaw !== null ? " / mo" : ""}
            </span>
          </th>
        ))}
      </tr>
    </thead>
  );
}

function ComparisonTable({ rows, label }: { rows: ComparisonRow[]; label: string }) {
  return (
    <>
      <p className="cmp-hint">Swipe to compare all four plans</p>
      <div className="cmp-scroll">
        <table className="cmp-table">
          <PlanHead />
          <caption className="visually-hidden">{label}</caption>
          <tbody>
            {rows.map((row) => (
              <Row key={row.label} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function PlanComparison() {
  return (
    <section className="section" id="compare" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <Reveal>
          <p className="eyebrow">Every plan, line by line</p>
          <h2 className="h2">
            Compare properly, <em>not by checkmarks alone.</em>
          </h2>
          <p className="lede" style={{ marginTop: "1.2rem" }}>
            Anything marked <span className="plan-tag">in development</span> ships inside the plan
            you are already paying for. We would rather show you the roadmap than a checkmark we
            have not earned yet.
          </p>
        </Reveal>

        {COMPARISON.map((group) => (
          <Reveal key={group.group}>
            <div className="cmp-group">
              <h3 className="cmp-group-title">{group.group}</h3>
              {group.description && <p className="cmp-group-desc">{group.description}</p>}
              <ComparisonTable rows={group.rows} label={group.group} />
            </div>
          </Reveal>
        ))}

        <Reveal>
          <div className="cmp-group">
            <h3 className="cmp-group-title">
              Marketing allowances <span className="plan-tag">in development</span>
            </h3>
            <p className="cmp-group-desc">
              Counted in contacts, not sends, and kept apart from your transactional volume. A big
              list never eats the budget that keeps logins working.
            </p>
            <ComparisonTable rows={MARKETING_ALLOWANCES} label="Marketing allowances" />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
