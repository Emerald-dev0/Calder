import { Reveal } from "./reveal";
import { COMPARISON, MARKETING_ALLOWANCES, PLANS, type ComparisonRow } from "../lib/plans";

/**
 * The full comparison. Two tables on purpose: sending and platform limits,
 * then marketing allowances. Mixing them is how "50,000 emails" quietly turns
 * into "50,000 emails minus your newsletter list".
 *
 * Availability state stays in the data (lib/plans.ts) for internal
 * entitlement, but the public page renders no "in development" marks.
 */

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
              Everything your application <em>needs to communicate.</em>
            </h2>
            <p className="lede" style={{ marginTop: "1.2rem" }}>
              You shouldn&apos;t have to assemble your communication stack feature by feature.
              Calder brings the infrastructure together.
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
            <h3 className="cmp-group-title">Marketing belongs to the platform.</h3>
            <p className="cmp-group-desc">
              Calder&apos;s communication layer isn&apos;t split into separate products. Your
              application mail, campaigns, audiences, templates, automations, suppression rules,
              and delivery history are designed to work together. Marketing capabilities are
              included across the Calder plans, with contact limits separate from your
              transactional email quota, so a growing audience doesn&apos;t consume the volume
              your application depends on.
            </p>
            <ComparisonTable rows={MARKETING_ALLOWANCES} label="Marketing allowances" />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
