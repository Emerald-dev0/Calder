import { OnboardingWizard } from "../../(onboarding)/onboarding/wizard";

export default async function Page({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const q = await searchParams;
  return (
    <div className="onb-root">
      <OnboardingWizard
        userEmail="amara@northwind.dev"
        initialStep={(Number(q.step ?? 1) || 1) as 1 | 2 | 3 | 4 | 5 | 6}
        initialNotice={null}
        initialProfile={{ name: "Amara Okafor", username: "amara", role: "Developer" }}
        initialOrg={null}
        initialProject={null}
        initialDomain={null}
        initialTransports={[]}
        initialEmail={null}
      />
    </div>
  );
}
