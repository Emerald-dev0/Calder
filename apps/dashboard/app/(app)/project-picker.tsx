interface ProjectPickerProps {
  projects: Array<{ id: string; slug: string }>;
  currentId: string;
  basePath: string;
}

export function ProjectPicker({ projects, currentId, basePath }: ProjectPickerProps) {
  if (projects.length <= 1) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      {projects.map((p) => (
        <a
          key={p.id}
          href={`${basePath}?project=${p.id}`}
          style={{
            display: "inline-block",
            fontSize: 13,
            marginRight: 8,
            padding: "6px 12px",
            borderRadius: 999,
            textDecoration: "none",
            border: "1px solid #E5E5E5",
            background: p.id === currentId ? "#0B0C0E" : "#fff",
            color: p.id === currentId ? "#fff" : "#0B0C0E",
          }}
        >
          {p.slug}
        </a>
      ))}
    </div>
  );
}
