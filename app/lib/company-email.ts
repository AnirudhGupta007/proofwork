const personalEmailDomains = new Set([
  "aol.com",
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "icloud.com",
  "live.com",
  "mail.com",
  "me.com",
  "msn.com",
  "outlook.com",
  "pm.me",
  "proton.me",
  "protonmail.com",
  "yahoo.com",
  "yandex.com",
  "zoho.com"
]);

export function emailDomain(email: string) {
  const domain = email.split("@")[1]?.trim().toLowerCase();
  return domain && domain.includes(".") ? domain : null;
}

export function isCompanyEmail(email: string) {
  const domain = emailDomain(email);
  return Boolean(domain && !personalEmailDomains.has(domain));
}

export function slugifyCompanyName(name: string, fallback = "company") {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || fallback;
}

export function companyNameFromDomain(domain: string) {
  const root = domain.split(".")[0] ?? "Company";
  return root
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
