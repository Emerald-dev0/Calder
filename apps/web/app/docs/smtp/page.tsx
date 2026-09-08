import type { Metadata } from "next";
import { CodeBlock } from "../../../components/code";

export const metadata: Metadata = {
  title: "SMTP — Calder Docs",
  description:
    "Send through Calder with any SMTP client: host, port, credentials, and copy-paste examples.",
};

const NODemailer = `import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: "smtp.calder.com",
  port: 587,
  secure: false, // STARTTLS — upgraded automatically
  auth: {
    user: process.env.CALDER_SMTP_USER, // project SMTP username
    pass: process.env.CALDER_SMTP_PASSWORD, // generated secret, shown once
  },
});

await transporter.sendMail({
  from: "app@acme.com", // must belong to a verified project identity
  to: "ada@example.com",
  subject: "Verify your email",
  html: "<p>Your code is <b>482 915</b></p>",
});`;

const SMTPLIB = `import smtplib
from email.message import EmailMessage

msg = EmailMessage()
msg["From"] = "app@acme.com"  # verified project identity
msg["To"] = "ada@example.com"
msg["Subject"] = "Verify your email"
msg.set_content("Your code is 482 915")

with smtplib.SMTP("smtp.calder.com", 587) as s:
    s.starttls()  # mandatory — plaintext auth is rejected
    s.login("project-smtp-username", "generated-secret")
    s.send_message(msg)`;

export default function SmtpGuide() {
  return (
    <>
      <h1>SMTP</h1>
      <p className="docs-lede">
        Already speak SMTP? Keep your libraries. Point them at Calder and get the same pipeline —
        queue, retries, events, webhooks — as the REST API.
      </p>

      <div className="docs-note">
        <strong>Status: specified, rolling out.</strong> The gateway spec below is final;
        availability follows the phases in our engineering plan. Test keys will work over SMTP from
        day one of the rollout.
      </div>

      <h2>Settings</h2>
      <table className="docs-table">
        <thead>
          <tr>
            <th>Setting</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <b style={{ color: "var(--ink)" }}>Host</b>
            </td>
            <td className="mono">smtp.calder.com</td>
          </tr>
          <tr>
            <td>
              <b style={{ color: "var(--ink)" }}>Port</b>
            </td>
            <td className="mono">587 (STARTTLS)</td>
          </tr>
          <tr>
            <td>
              <b style={{ color: "var(--ink)" }}>Username</b>
            </td>
            <td>Project SMTP username (dashboard → SMTP)</td>
          </tr>
          <tr>
            <td>
              <b style={{ color: "var(--ink)" }}>Password</b>
            </td>
            <td>Generated secret — shown once, hashed at rest</td>
          </tr>
        </tbody>
      </table>

      <h2>Nodemailer</h2>
      <CodeBlock title="mailer.js" copyText={NODemailer}>
        <span className="tok-key">import</span> <span className="tok-path">nodemailer</span>{" "}
        <span className="tok-key">from</span>{" "}
        <span className="tok-str">&quot;nodemailer&quot;</span>;{"\n\n"}
        <span className="tok-key">const</span> <span className="tok-path">transporter</span>{" "}
        <span className="tok-dim">=</span>{" "}
        <span className="tok-path">nodemailer.createTransport</span>(
        <span className="tok-punct">{"{"}</span>
        {"\n"}
        &nbsp;&nbsp;<span className="tok-key">host</span>:{" "}
        <span className="tok-str">&quot;smtp.calder.com&quot;</span>,{"\n"}
        &nbsp;&nbsp;<span className="tok-key">port</span>: <span className="tok-num">587</span>,
        {"\n"}
        &nbsp;&nbsp;<span className="tok-key">secure</span>: <span className="tok-key">false</span>,{" "}
        <span className="tok-dim">{"// STARTTLS — upgraded automatically"}</span>
        {"\n"}
        &nbsp;&nbsp;<span className="tok-key">auth</span>: <span className="tok-punct">{"{"}</span>{" "}
        <span className="tok-dim">{"/* user + pass from env */"}</span>{" "}
        <span className="tok-punct">{"}"}</span>,{"\n"}
        <span className="tok-punct">{"}"}</span>);
        {"\n\n"}
        <span className="tok-key">await</span>{" "}
        <span className="tok-path">transporter.sendMail</span>(
        <span className="tok-punct">{"{"}</span>{" "}
        <span className="tok-dim">{"/* from, to, subject, html */"}</span>{" "}
        <span className="tok-punct">{"}"}</span>);
      </CodeBlock>

      <h2>Python smtplib</h2>
      <CodeBlock title="send.py" copyText={SMTPLIB}>
        <span className="tok-key">import</span> <span className="tok-path">smtplib</span>
        {"\n"}
        <span className="tok-key">from</span> <span className="tok-path">email.message</span>{" "}
        <span className="tok-key">import</span> <span className="tok-path">EmailMessage</span>
        {"\n\n"}
        <span className="tok-path">msg</span> <span className="tok-dim">=</span>{" "}
        <span className="tok-path">EmailMessage</span>()
        {"\n"}
        <span className="tok-path">msg</span>[<span className="tok-str">&quot;From&quot;</span>]{" "}
        <span className="tok-dim">=</span> <span className="tok-str">&quot;app@acme.com&quot;</span>
        {"\n"}
        <span className="tok-dim"># …To, Subject, set_content…</span>
        {"\n\n"}
        <span className="tok-key">with</span> <span className="tok-path">smtplib.SMTP</span>(
        <span className="tok-str">&quot;smtp.calder.com&quot;</span>,{" "}
        <span className="tok-num">587</span>) <span className="tok-key">as</span>{" "}
        <span className="tok-path">s</span>:{"\n"}
        &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-path">s.starttls</span>(){" "}
        <span className="tok-dim"># mandatory</span>
        {"\n"}
        &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-path">s.login</span>(
        <span className="tok-dim">…</span>){"\n"}
        &nbsp;&nbsp;&nbsp;&nbsp;<span className="tok-path">s.send_message</span>(
        <span className="tok-path">msg</span>)
      </CodeBlock>

      <h2>Rules of the road</h2>
      <ul>
        <li>TLS is mandatory — plaintext authentication is rejected, always.</li>
        <li>
          The <span className="mono">From</span> address must belong to a verified project identity,
          or the message is rejected with a <span className="mono">550</span> and a dashboard
          explanation.
        </li>
        <li>Same events, same webhooks, same usage meter as API sends — one pipeline.</li>
        <li>
          Supported subset: <span className="mono">STARTTLS</span>,{" "}
          <span className="mono">AUTH PLAIN/LOGIN</span>,{" "}
          <span className="mono">MAIL/RCPT/DATA</span>, MIME (HTML, text, attachments),
          CC/BCC/Reply-To, custom headers.
        </li>
      </ul>
    </>
  );
}
