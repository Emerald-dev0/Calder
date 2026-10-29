import type { EmailMessage } from "./provider.js";

const htmlFooter = `<div style="clear:both;padding:24px 16px 12px;text-align:center;font-family:Arial,sans-serif;font-size:12px;line-height:1.6;color:#8a8a8a">Sent with <a href="https://calder.click" style="color:inherit;text-decoration:underline">Calder</a> · calder.click<br><a href="https://calder.click/abuse" style="color:inherit;text-decoration:underline">Report abuse</a></div>`;
const textFooter =
  "--\nSent with Calder · https://calder.click\nReport abuse: https://calder.click/abuse";

/** Applied to the outbound copy only, before the provider signs or sends it. */
export function addCalderFooter(message: EmailMessage): EmailMessage {
  let html = message.html;
  if (html !== undefined) {
    // Put the footer inside a complete document's body; fragments remain fragments.
    const bodyEnd = /<\/body\s*>/i.exec(html);
    html = bodyEnd
      ? html.slice(0, bodyEnd.index) + htmlFooter + html.slice(bodyEnd.index)
      : html + htmlFooter;
  }
  return {
    ...message,
    html,
    text: message.text === undefined ? undefined : `${message.text}\n\n\n${textFooter}`,
  };
}
