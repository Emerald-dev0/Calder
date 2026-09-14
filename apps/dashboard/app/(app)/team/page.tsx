import { PlanGate } from "../../../components/plan-gate";

export const metadata = { title: "Calder — Team" };

export default function TeamPage() {
  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Team</h1>
      <p style={{ color: "var(--color-muted)", fontSize: 13, margin: "0 0 16px" }}>Invite teammates without sharing credentials.</p>
      <PlanGate
        title="Team collaboration is available on Pro"
        description="Invite developers, designers, and operators with role-based access. 5 members on Pro, 15 on Premium."
        tier="PRO"
        features={["Roles: Viewer / Developer / Admin", "Project-scoped access", "Invite via email"]}
      />
    </div>
  );
}
