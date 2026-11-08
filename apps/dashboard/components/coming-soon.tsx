import Link from "next/link";
import { ArrowRight, Lock } from "lucide-react";
import {
  featureAvailability,
  featureAvailabilityLabel,
  type FeatureId,
} from "@calder/config/features";
import { DsPageHeader, StatusPill } from "./design-system";

/**
 * The one rendering of "this product is not in the release".
 *
 * Requirements this encodes:
 *  - muted/grayscale, no active primary button, no upgrade CTA for a feature
 *    that cannot be bought or used;
 *  - an explicit `Coming Soon` label, not a suggestion that it is live;
 *  - an honest explanation and, when one exists, a link to what a customer can
 *    use today (e.g. the Usage page for analytics).
 *
 * It reads availability from `@calder/config/features`, so the same registry
 * that makes the API return `403 feature_not_available` decides this page.
 * If a feature is flipped to `ready`, the real page takes over — this
 * component is never the place a launch is decided.
 */
export function ComingSoon({
  feature,
  title,
  description,
  alternative,
  checklist,
}: {
  feature: FeatureId;
  title?: string;
  description?: string;
  alternative?: { href: string; label: string };
  checklist?: string[];
}) {
  const availability = featureAvailability(feature, null);
  const label = featureAvailabilityLabel(availability);

  return (
    <div>
      <DsPageHeader
        icon={<Lock size={18} />}
        title={title ?? availability.name}
        badge={<StatusPill status="pending" label={label} />}
        description={
          description ??
          availability.note ??
          "This capability is not available in the current release."
        }
      />

      <div
        className="ds-card"
        style={{
          padding: "28px 24px",
          /* Muted and grayscale on purpose: it must not read as an active
             product surface or compete with real capabilities. */
          filter: "grayscale(1)",
          opacity: 0.78,
          background: "var(--color-surface-sunken)",
          borderStyle: "dashed",
        }}
        aria-label={`${availability.name}: ${label}`}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span
            className="mono"
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              padding: "2px 8px",
              borderRadius: 999,
              border: "1px solid var(--color-border-strong)",
              color: "var(--color-muted)",
            }}
          >
            {label}
          </span>
        </div>

        <p
          style={{
            margin: "0 0 16px",
            maxWidth: 560,
            fontSize: 13.5,
            lineHeight: 1.6,
            color: "var(--color-ink-secondary)",
          }}
        >
          {availability.note ?? "This feature is not included in the current release."}
        </p>

        {checklist && checklist.length > 0 && (
          <ul
            style={{
              margin: "0 0 18px",
              paddingLeft: 18,
              maxWidth: 560,
              fontSize: 12.5,
              lineHeight: 1.7,
              color: "var(--color-muted)",
            }}
          >
            {checklist.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}

        {alternative ? (
          <Link
            href={alternative.href}
            className="ds-btn ds-btn-secondary"
            style={{ textDecoration: "none" }}
          >
            <span>{alternative.label}</span>
            <ArrowRight size={14} />
          </Link>
        ) : (
          <span className="mono" style={{ fontSize: 11.5, color: "var(--color-muted)" }}>
            No controls are enabled on this page.
          </span>
        )}
      </div>
    </div>
  );
}
