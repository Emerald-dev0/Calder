"use client";

import { useMemo, useState } from "react";

/**
 * Pick the people a broadcast goes to.
 *
 * The first shape of "specific people" was a box you pasted addresses into,
 * which asks an operator to remember who their customers are. This is the list
 * of accounts, filterable, with the ones already chosen ticked — the same
 * affordance as any other admin console, and one that cannot type an address
 * that belongs to nobody.
 *
 * It stays a plain checkbox list inside the compose form (a GET form, so the
 * preview is the gate), with one hidden field carrying the chosen addresses.
 * The client only filters and counts: no send happens here, and the server
 * re-resolves every address against `users` before anything is mailed.
 */

export interface PickablePerson {
  email: string;
  name: string | null;
  verified: boolean;
}

export interface PeoplePickerProps {
  people: PickablePerson[];
  /** Addresses already chosen, e.g. carried back from the preview step. */
  selected: string[];
  /** Total accounts in the database, so the cap can be stated honestly. */
  total: number;
  /** How many accounts were loaded into the list. */
  limit: number;
  readOnly?: boolean;
}

/**
 * Keep every address that was chosen, even one outside the loaded window:
 * dropping it because the list cannot show it would silently narrow the send.
 */
function dedupe(values: string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

export function PeoplePicker({ people, selected, total, limit, readOnly }: PeoplePickerProps) {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string[]>(() => dedupe(selected));

  const chosenSet = useMemo(() => new Set(chosen), [chosen]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return people;
    return people.filter(
      (person) =>
        person.email.toLowerCase().includes(needle) ||
        (person.name ?? "").toLowerCase().includes(needle)
    );
  }, [people, query]);

  const toggle = (email: string) => {
    setChosen((current) =>
      current.includes(email) ? current.filter((value) => value !== email) : [...current, email]
    );
  };

  const selectAllMatching = () => {
    setChosen((current) => {
      const next = new Set(current);
      for (const person of filtered) next.add(person.email);
      return [...next];
    });
  };

  const matchedChosen = filtered.filter((person) => chosenSet.has(person.email)).length;

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <input
        type="hidden"
        name="selected"
        value={chosen.join(",")}
        data-chosen-count={chosen.length}
      />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="search"
          className="cp-input"
          style={{ maxWidth: 320 }}
          placeholder="Search by email or name"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Filter accounts"
        />
        <button
          type="button"
          className="cp-btn"
          style={{ fontSize: 12, padding: "3px 10px" }}
          onClick={selectAllMatching}
          disabled={readOnly || filtered.length === 0}
        >
          Select all {query.trim() ? `matching (${filtered.length})` : `shown (${filtered.length})`}
        </button>
        <button
          type="button"
          className="cp-btn"
          style={{ fontSize: 12, padding: "3px 10px" }}
          onClick={() => setChosen([])}
          disabled={readOnly || chosen.length === 0}
        >
          Clear
        </button>
        <span style={{ fontSize: 12, color: "var(--cp-muted)" }}>
          {chosen.length === 0
            ? "Nobody selected yet"
            : `${chosen.length} selected${query.trim() ? ` · ${matchedChosen} match the search` : ""}`}
        </span>
      </div>

      <div
        role="group"
        aria-label="Accounts"
        style={{
          maxHeight: 280,
          overflowY: "auto",
          border: "1px solid var(--cp-border, #e5e7eb)",
          borderRadius: 6,
        }}
      >
        {filtered.length === 0 ? (
          <p style={{ margin: 0, padding: 12, fontSize: 12.5, color: "var(--cp-muted)" }}>
            No account matches “{query}”. Accounts only — an address with no account cannot be
            mailed from here.
          </p>
        ) : (
          filtered.map((person) => {
            const id = `person_${person.email.replace(/[^a-zA-Z0-9]/g, "_")}`;
            return (
              <label
                key={person.email}
                htmlFor={id}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  padding: "7px 12px",
                  borderBottom: "1px solid var(--cp-border, #f1f2f4)",
                  fontSize: 12.5,
                  cursor: readOnly ? "not-allowed" : "pointer",
                }}
              >
                <input
                  id={id}
                  type="checkbox"
                  checked={chosenSet.has(person.email)}
                  onChange={() => toggle(person.email)}
                  disabled={readOnly}
                />
                <span style={{ minWidth: 140 }}>{person.name ?? "—"}</span>
                <span className="mono" style={{ color: "var(--cp-muted)" }}>
                  {person.email}
                </span>
                {person.verified ? null : (
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: 11,
                      color: "var(--color-warning)",
                    }}
                  >
                    unverified
                  </span>
                )}
              </label>
            );
          })
        )}
      </div>

      <p style={{ margin: 0, fontSize: 12, color: "var(--cp-muted)" }}>
        {total > limit
          ? `Showing the ${limit} newest of ${total} accounts — paste an address below for anyone older.`
          : `${total} ${total === 1 ? "account" : "accounts"} in total.`}{" "}
        The list is a convenience; the server resolves every address against accounts before
        sending.
      </p>
    </div>
  );
}
