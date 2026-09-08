/**
 * Waitlist update #001 — "we're cooking". Placeholders per recipient:
 * {{email}}, {{position}}, {{referral_code}}, {{referral_link}}.
 * Content is versioned here so every send of a campaign is byte-identical
 * and reviewable. Trigger: POST /v1/admin/waitlist/broadcast (ADMIN_API_KEY).
 */
export const WAITLIST_UPDATE_001 = {
  campaign: "waitlist-update-001",
  subject: "We're cooking — Gmail sending, a CLI, and your ticket still counts",
  html: [
    "<p>Hello,</p>",
    "<p>You're getting this because you're on the Calder waitlist — position <b>#{{position}}</b>. This is update #001, and from here you hear from us when something real ships. No noise, unsubscribe anytime below.</p>",
    "<p><b>What we're cooking:</b></p>",
    "<ul>",
    "<li><b>Gmail Quickstart for junior devs.</b> No domain? No problem — connect the Gmail you already have and send through the same API as everyone else. Built for the 16-year-old learning Next.js and the founder validating on a weekend.</li>",
    "<li><b>A CLI that explains itself.</b> <code>calder doctor</code> will check your key, project, domain, DNS, and transport — and tell you what's wrong in plain English, not error codes.</li>",
    "<li><b>Deliverability you can watch.</b> Every send gets a trace from request to inbox, and a plain-English answer to “why didn't it arrive?”</li>",
    "</ul>",
    '<p>Your referral code is <b>{{referral_code}}</b> — friends join behind you here: <a href="{{referral_link}}">{{referral_link}}</a></p>',
    "<p>— The Calder team</p>",
  ].join("\n"),
  text: [
    "Hello,",
    "",
    "You're getting this because you're on the Calder waitlist — position #{{position}}. Update #001, sent only when something real ships.",
    "",
    "What we're cooking:",
    "- Gmail Quickstart for junior devs: no domain needed, same API as everyone else.",
    "- A CLI that explains itself: `calder doctor` checks key, project, domain, DNS.",
    "- Deliverability you can watch: per-email traces and plain-English bounce reasons.",
    "",
    "Referral code: {{referral_code}} — {{referral_link}}",
    "",
    "— The Calder team",
  ].join("\n"),
};

export function renderCampaign(
  template: { subject: string; html: string; text: string },
  vars: { email: string; position: number; referral_code: string; referral_link: string }
): { subject: string; html: string; text: string } {
  const fill = (s: string): string =>
    s
      .replaceAll("{{email}}", vars.email)
      .replaceAll("{{position}}", String(vars.position))
      .replaceAll("{{referral_code}}", vars.referral_code)
      .replaceAll("{{referral_link}}", vars.referral_link);
  return { subject: fill(template.subject), html: fill(template.html), text: fill(template.text) };
}
