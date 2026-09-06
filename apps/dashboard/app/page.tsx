import Image from "next/image";
import { OnboardingPath } from "@avenor/ui";
import { ArrivalMoment } from "../components/arrival-moment";

export default function OverviewPage() {
  return (
    <div>
      <h1 style={{ fontSize: 28, margin: "0 0 8px" }}>Overview</h1>
      <p style={{ color: "#737373", margin: "0 0 24px" }}>
        Sending health at a glance. Full views land with feature work.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 16,
        }}
      >
        {[
          { label: "Delivery rate", value: "—" },
          { label: "Emails sent", value: "—" },
          { label: "Avg processing", value: "—" },
        ].map((s) => (
          <div
            key={s.label}
            style={{
              background: "#fff",
              border: "1px solid #E5E5E5",
              borderRadius: 12,
              padding: 20,
            }}
          >
            <p style={{ fontSize: 24, fontWeight: 700, margin: "0 0 4px" }}>{s.value}</p>
            <p style={{ fontSize: 12, color: "#737373", margin: 0 }}>{s.label}</p>
          </div>
        ))}
      </div>

      <div className="onboard-card" style={{ marginTop: 24 }}>
        <p style={{ fontWeight: 600, margin: "0 0 4px" }}>Your path to first delivery</p>
        <p style={{ color: "#737373", fontSize: 14, margin: "0 0 16px" }}>
          No emails yet — connect a project, send via the API, and this card becomes a delivery
          timeline.
        </p>
        <div className="onboard-grid">
          <div>
            <Image
              src="/illustrations/empty-state-narrative.webp"
              alt="Ink illustration of an empty mailbox with a blue glow at its opening"
              width={1254}
              height={1254}
              sizes="(max-width: 900px) 100vw, 400px"
              className="onboard-visual"
              priority={false}
            />
            <p style={{ color: "#737373", fontSize: 12, margin: "8px 0 0" }}>
              The mailbox is empty — for now.
            </p>
          </div>
          <div>
            <ArrivalMoment />
            <p style={{ color: "#737373", fontSize: 12, margin: "8px 0 16px" }}>
              What it looks like when the first one lands.
            </p>
            <OnboardingPath className="onboard-visual" />
          </div>
        </div>
      </div>
    </div>
  );
}
