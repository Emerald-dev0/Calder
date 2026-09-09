/**
 * Founder intro: sent from Daniel@calder.click (or any authorized sender
 * chosen at send time via the broadcast `from` field). Personal, plain-spoken,
 * one ask at most. Trigger: POST /v1/admin/waitlist/broadcast with
 * {"campaign":"founder-intro","from":"Daniel@calder.click"}.
 */
export const FOUNDER_INTRO = {
 campaign: "founder-intro",
 subject: `I'm Daniel, I built Calder for developers like you`,
 html: [
 `<p>Hey,</p>`,
 `<p>I'm Daniel, the founder of Calder. Not a team, not a "we" hiding a mailing list, me, writing this email myself.</p>`,
 `<p>I started Calder because sending email from an app is absurdly harder than it should be. API keys, DNS records, queues you built yourself, webhooks that fire once into the void. I wanted one API where you POST, get a 202, and can prove every delivery afterwards.</p>`,
 `<p>You're on the waitlist, which means you'll get test keys before anyone else. When your batch opens, try breaking it, I read every failure personally while we're small.</p>`,
 `<p>If email infrastructure has ever wasted your week, reply to this email and tell me about it. I mean that, replies land in my actual inbox.</p>`,
 `<p>Daniel<br>Founder, Calder</p>`,
 ].join("\n"),
 text: [
 `Hey,`,
 ``,
 `I'm Daniel, the founder of Calder. Not a team, not a "we" hiding a mailing list, me, writing this email myself.`,
 ``,
 `I started Calder because sending email from an app is absurdly harder than it should be. API keys, DNS records, queues you built yourself, webhooks that fire once into the void. I wanted one API where you POST, get a 202, and can prove every delivery afterwards.`,
 ``,
 `You're on the waitlist, which means you'll get test keys before anyone else. When your batch opens, try breaking it, I read every failure personally while we're small.`,
 ``,
 `If email infrastructure has ever wasted your week, reply to this email and tell me about it. I mean that, replies land in my actual inbox.`,
 ``,
 `Daniel`,
 `Founder, Calder`,
 ].join("\n"),
};

export function getFounderIntro() {
 return FOUNDER_INTRO;
}
