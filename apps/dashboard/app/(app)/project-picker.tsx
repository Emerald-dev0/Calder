import Link from "next/link";

interface ProjectPickerProps {
  projects: Array<{ id: string; slug: string }>;
  currentId: string;
  basePath: string;
}

export function ProjectPicker({ projects, currentId, basePath }: ProjectPickerProps) {
  if (projects.length <= 1) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <div className="ds-tabs" role="navigation" aria-label="Switch project">
        {projects.map((p) => {
          const active = p.id === currentId;
          return (
            <Link
              key={p.id}
              href={`${basePath}?project=${p.id}`}
              className={`ds-tab ${active ? "is-active" : ""}`}
            >
              {p.slug}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
