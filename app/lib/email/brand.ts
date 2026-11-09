export const emailBrand = {
  product: "Proofwork",
  parent: "Proofwork",
  wordmark: "Proofwork",
  signature: "Proofwork",
  bg: "#F5F1E6",
  panel: "#ffffff",
  ink: "#0A0B0A",
  muted: "#4A4D48",
  soft: "#ECE7D8",
  line: "#D9D3C2",
  success: "#1E4D3A",
  warning: "#8a5a00",
  danger: "#9f1d1d",
  fontBody: "'Instrument Sans', Arial, Helvetica, sans-serif",
  fontDisplay: "'Instrument Serif', Georgia, 'Times New Roman', serif"
};

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function hiddenPreheader(preheader: string) {
  return `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeHtml(preheader)}</div>`;
}

export function emailShell(input: {
  preheader: string;
  eyebrow: string;
  title: string;
  intro: string;
  body: string;
  footerNote?: string;
}) {
  const brand = emailBrand;
  return `<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(input.title)}</title>
  </head>
  <body style="margin:0;padding:0;background:${brand.bg};color:${brand.ink};font-family:${brand.fontBody};">
    ${hiddenPreheader(input.preheader)}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${brand.bg};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:${brand.panel};border:1px solid ${brand.line};">
            <tr>
              <td style="padding:28px 32px 18px;border-bottom:1px solid ${brand.line};">
                <div style="font-size:13px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:${brand.ink};">${brand.wordmark}</div>
                <div style="margin-top:6px;font-size:12px;color:${brand.muted};">${brand.parent} hiring intelligence</div>
              </td>
            </tr>
            <tr>
              <td style="padding:34px 32px 16px;">
                <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:${brand.muted};">${escapeHtml(input.eyebrow)}</div>
                <h1 style="margin:10px 0 14px;font-family:${brand.fontDisplay};font-size:42px;line-height:0.98;font-weight:400;letter-spacing:0;color:${brand.ink};">${escapeHtml(input.title)}</h1>
                <p style="margin:0;font-size:16px;line-height:1.55;color:${brand.muted};">${input.intro}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:10px 32px 34px;">
                ${input.body}
              </td>
            </tr>
            <tr>
              <td style="padding:22px 32px;background:${brand.soft};border-top:1px solid ${brand.line};">
                <p style="margin:0;font-size:12px;line-height:1.55;color:${brand.muted};">${input.footerNote ?? "This message was sent by Proofwork, an assessment workflow for evaluating real-world work."}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function ctaButton(label: string, href: string) {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:${emailBrand.ink};color:#ffffff;border:1px solid ${emailBrand.ink};padding:14px 18px;text-decoration:none;font-size:14px;font-weight:700;">${escapeHtml(label)}</a>`;
}

export function metadataTable(rows: Array<[string, string]>) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid ${emailBrand.line};border-bottom:0;margin:24px 0 0;">
    ${rows
      .map(
        ([label, value]) => `<tr>
          <td style="width:34%;padding:13px 14px;border-bottom:1px solid ${emailBrand.line};background:${emailBrand.soft};font-size:11px;letter-spacing:0.1em;text-transform:uppercase;font-weight:700;color:${emailBrand.muted};">${escapeHtml(label)}</td>
          <td style="padding:13px 14px;border-bottom:1px solid ${emailBrand.line};font-size:14px;line-height:1.45;color:${emailBrand.ink};">${escapeHtml(value)}</td>
        </tr>`
      )
      .join("")}
  </table>`;
}

export function callout(content: string) {
  return `<div style="margin-top:24px;padding:18px 18px;border:1px solid ${emailBrand.line};background:${emailBrand.soft};font-size:14px;line-height:1.55;color:${emailBrand.ink};">${content}</div>`;
}
