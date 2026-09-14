import Link from "next/link";
import { notFound } from "next/navigation";
import { fmtAgo, fmtDate, fmtDateTime, fmtInt } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { waitlistPerson } from "@/lib/control/queries";
import { Badge, Dot, KV, PageHeader, Panel, Tag } from "@/control/_components/ui";
import { addWaitlistTag, removeWaitlistTag, setWaitlistNote, setWaitlistStatus } from "../actions";

export const dynamic = "force-dynamic";

export default async function WaitlistPersonPage({ params }: { params: { id: string } }) {
  await requireSection("growth");
  const data = await waitlistPerson(params.id);
  if (!data) notFound();
  const { person, position, invites, convertedUser, referrer } = data;

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/control/growth/waitlist" style={{ color: "inherit" }}>
              Waitlist
            </Link>{" "}
            / person
          </>
        }
        title={person.firstName ?? person.email}
        subtitle={
          <span className="mono" style={{ fontSize: 12.5 }}>
            {person.email} · <code>{person.referralCode}</code>
          </span>
        }
        right={
          <Badge
            tone={
              person.status === "removed"
                ? "bad"
                : person.status === "invited"
                  ? "accent"
                  : undefined
            }
          >
            <Dot
              tone={
                person.status === "waiting" ? "idle" : person.status === "removed" ? "bad" : "info"
              }
            />{" "}
            {person.status}
          </Badge>
        }
      />

      <div className="cp-grid cp-grid-2">
        <Panel title="Profile" caption="waitlist signup record">
          <KV k="Position" v={`#${fmtInt(position)}`} mono />
          <KV
            k="Joined"
            v={`${fmtDate(new Date(person.createdAt))} · ${fmtAgo(new Date(person.createdAt))}`}
            mono
          />
          <KV k="Source" v={person.source ?? "direct"} />
          <KV k="Country" v={person.country ?? "—"} />
          <KV k="Referral code" v={person.referralCode} mono />
          <KV
            k="Referred by"
            v={
              referrer ? (
                <Link href={`/control/growth/waitlist/${referrer.id}`}>{referrer.email}</Link>
              ) : (
                "organic"
              )
            }
          />
          <KV
            k="Invited"
            v={person.invitedAt ? fmtDateTime(new Date(person.invitedAt)) : "never"}
            mono
          />
          <KV
            k="Contacted"
            v={person.contactedAt ? fmtDateTime(new Date(person.contactedAt)) : "never"}
            mono
          />
          <KV
            k="Converted"
            v={
              convertedUser ? (
                <>
                  Joined Calder{" "}
                  <Link href={`/control/customers/users/${convertedUser.id}`}>view account →</Link>
                </>
              ) : (
                "not yet"
              )
            }
          />
        </Panel>

        <Panel title="Actions" caption="operator state — every change is audit-logged">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            <form action={setWaitlistStatus.bind(null, person.id, "invited")}>
              <button className="cp-btn primary" type="submit">
                Invite
              </button>
            </form>
            <form action={setWaitlistStatus.bind(null, person.id, "contacted")}>
              <button className="cp-btn" type="submit">
                Mark contacted
              </button>
            </form>
            <form action={setWaitlistStatus.bind(null, person.id, "waiting")}>
              <button className="cp-btn" type="submit">
                Back to waiting
              </button>
            </form>
            <form action={setWaitlistStatus.bind(null, person.id, "removed")}>
              <button className="cp-btn danger" type="submit">
                Remove
              </button>
            </form>
          </div>

          <div style={{ marginBottom: 14 }}>
            <p className="cp-panel-caption" style={{ marginBottom: 8 }}>
              Tags
            </p>
            <div style={{ marginBottom: 8 }}>
              {(person.tags ?? []).length === 0 ? (
                <span style={{ color: "var(--cp-faint)", fontSize: 13 }}>No tags yet.</span>
              ) : (
                (person.tags ?? []).map((t) => (
                  <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Tag>{t}</Tag>
                    <form
                      action={removeWaitlistTag.bind(null, person.id, t)}
                      style={{ display: "inline" }}
                    >
                      <button
                        type="submit"
                        aria-label={`Remove tag ${t}`}
                        style={{
                          background: "none",
                          border: "none",
                          color: "var(--cp-faint)",
                          cursor: "pointer",
                          fontSize: 12,
                          padding: "0 2px",
                        }}
                      >
                        ×
                      </button>
                    </form>
                  </span>
                ))
              )}
            </div>
            <form
              action={async (formData: FormData) => {
                "use server";
                await addWaitlistTag(person.id, String(formData.get("tag") ?? ""));
              }}
              style={{ display: "flex", gap: 8 }}
            >
              <input
                className="cp-input"
                name="tag"
                placeholder="Add a tag (e.g. design-partner)"
                maxLength={40}
                style={{ flex: 1 }}
              />
              <button className="cp-btn" type="submit">
                Add
              </button>
            </form>
          </div>

          <div>
            <p className="cp-panel-caption" style={{ marginBottom: 8 }}>
              Internal note — never shown to the person
            </p>
            <form
              action={async (formData: FormData) => {
                "use server";
                await setWaitlistNote(person.id, String(formData.get("note") ?? ""));
              }}
              style={{ display: "grid", gap: 8 }}
            >
              <textarea
                className="cp-input"
                name="note"
                rows={4}
                defaultValue={person.note ?? ""}
                placeholder="Context for the team…"
                style={{ resize: "vertical" }}
              />
              <button className="cp-btn" type="submit">
                Save note
              </button>
            </form>
          </div>
        </Panel>
      </div>

      <Panel
        title={`Referrals through this person`}
        caption={`${fmtInt(invites.length)} people joined with their code`}
        flush
      >
        {invites.length === 0 ? (
          <div className="cp-empty">
            <b>No referrals yet</b>
            Their link: <span className="mono">/waitlist?ref={person.referralCode}</span>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Joined</th>
                  <th>Source</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((inv) => (
                  <tr key={inv.id}>
                    <td className="mono" style={{ fontSize: 12.5 }}>
                      <Link href={`/control/growth/waitlist/${inv.id}`}>{inv.email}</Link>
                    </td>
                    <td className="mono" style={{ fontSize: 12.5 }}>
                      {fmtDate(new Date(inv.createdAt))}
                    </td>
                    <td>{inv.source ?? "direct"}</td>
                    <td>
                      <Badge>
                        <Dot tone={inv.status === "waiting" ? "idle" : "info"} /> {inv.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
