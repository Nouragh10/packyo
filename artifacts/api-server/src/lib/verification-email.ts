// Packyo-branded "confirm your email" message (HTML + plain text).
// Table layout + inline styles so it renders the same in Gmail, Apple Mail and Outlook.

const C = {
  coral: "#F15A3A",
  ink: "#241F1B",
  body: "#5C5047",
  muted: "#8B7E75",
  faint: "#B0A49A",
  cream: "#F6F1EA",
  line: "#EFE7DD",
};
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function firstNameOf(displayName?: string | null): string {
  const n = (displayName ?? "").trim().split(/\s+/)[0];
  return n ? n.slice(0, 40) : "";
}

export const VERIFICATION_SUBJECT = "Confirm your email to start planning with Packyo";

export function verificationEmailText(verifyUrl: string, displayName?: string | null): string {
  const name = firstNameOf(displayName);
  return [
    `Welcome to the pack${name ? `, ${name}` : ""}!`,
    "",
    "Confirm your email to start planning trips with your friends on Packyo:",
    verifyUrl,
    "",
    "What's next: create a trip, invite your crew, vote on where to go and where to stay, and Packyo builds the itinerary.",
    "",
    "This link expires in 24 hours. If you didn't sign up for Packyo, you can ignore this email.",
    "",
    "— Packyo",
  ].join("\n");
}

export function verificationEmailHtml(verifyUrl: string, displayName: string | null | undefined, mascotUrl: string): string {
  const name = firstNameOf(displayName);
  const url = esc(verifyUrl);
  const step = (n: number, title: string, text: string) => `
              <tr>
                <td width="36" valign="top" style="padding:0 0 14px;">
                  <div style="width:26px;height:26px;border-radius:13px;background:${C.cream};color:${C.coral};font:700 13px/26px ${SANS};text-align:center;">${n}</div>
                </td>
                <td valign="top" style="padding:3px 0 14px;font:14px/1.5 ${SANS};color:${C.body};">
                  <strong style="color:${C.ink};">${title}</strong> ${text}
                </td>
              </tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light only" />
  <title>${VERIFICATION_SUBJECT}</title>
</head>
<body style="margin:0;padding:0;background:${C.cream};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">One tap and you're in. Your trips are waiting.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.cream};padding:36px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">

        <tr><td align="center" style="padding-bottom:22px;font:700 30px/1 ${SERIF};color:${C.coral};letter-spacing:-0.5px;">packyo</td></tr>

        <tr><td style="background:#FFFFFF;border-radius:24px;padding:36px 36px 30px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center" style="padding-bottom:18px;">
              <img src="${esc(mascotUrl)}" width="120" alt="" style="display:block;width:120px;height:auto;border:0;" />
            </td></tr>
            <tr><td align="center" style="font:700 26px/1.25 ${SERIF};color:${C.ink};padding-bottom:12px;">
              Welcome to the pack${name ? `, ${esc(name)}` : ""}!
            </td></tr>
            <tr><td align="center" style="font:16px/1.6 ${SANS};color:${C.body};padding:0 6px 28px;">
              One quick tap to confirm your email, and you're in. No more 300-message group chats.
            </td></tr>
            <tr><td align="center" style="padding-bottom:30px;">
              <a href="${url}" style="display:inline-block;background:${C.coral};color:#FFFFFF;font:600 16px/1 ${SANS};text-decoration:none;padding:17px 38px;border-radius:14px;">Confirm my email</a>
            </td></tr>
            <tr><td style="border-top:1px solid ${C.line};padding-top:24px;">
              <div style="font:600 12px/1 ${SANS};color:${C.muted};letter-spacing:1.2px;text-transform:uppercase;padding-bottom:16px;">What's next</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${step(1, "Create a trip", "and invite your crew with a link.")}${step(2, "Vote together", "on where to go and where to stay.")}${step(3, "Let Packyo plan it.", "Your itinerary is built from everyone's wishes.")}
              </table>
            </td></tr>
          </table>
        </td></tr>

        <tr><td align="center" style="padding:24px 18px 0;font:12px/1.6 ${SANS};color:${C.faint};">
          Button not working? Paste this link into your browser:<br />
          <a href="${url}" style="color:${C.muted};word-break:break-all;">${url}</a>
        </td></tr>
        <tr><td align="center" style="padding:16px 18px 0;font:12px/1.6 ${SANS};color:${C.faint};">
          This link expires in 24 hours. If you didn't sign up for Packyo, you can ignore this email.
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
