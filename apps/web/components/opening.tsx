import { Reveal } from "./reveal";

export function Opening() {
  return (
    <section className="section" id="opening">
      <div className="wrap">
        <Reveal>
          <p className="eyebrow">Communication that keeps moving</p>
          <h2 className="h2">
            Send it. Track it. <em>Know what happened.</em>
          </h2>
          <p className="lede" style={{ marginTop: "1.2rem" }}>
            A successful API request shouldn&rsquo;t be the end of the story. Calder takes every
            message from the moment your application creates it through processing, delivery, and
            everything that happens afterward.
          </p>
        </Reveal>

        <div
          className="pipeline-return"
          style={{ marginTop: "3rem", justifyContent: "flex-start", gap: "1.2rem" }}
        >
          <span className="event-pill">Created</span>
          <span>&rarr;</span>
          <span className="event-pill">Queued</span>
          <span>&rarr;</span>
          <span className="event-pill">Sending</span>
          <span>&rarr;</span>
          <span className="event-pill">Sent</span>
          <span>&rarr;</span>
          <span className="event-pill">Delivered</span>
        </div>

        <Reveal delay={120}>
          <div
            style={{ marginTop: "3rem", borderTop: "1px solid var(--border)", paddingTop: "3rem" }}
          >
            <p className="lede">
              And when something goes wrong, you don&rsquo;t get a mysterious error and a shrug.
              <strong> You get the record.</strong>
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
