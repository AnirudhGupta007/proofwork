export function normalizedAssessmentRole(roleTitle: string, jobDescription: string) {
  const title = roleTitle.toLowerCase();
  const text = `${title} ${jobDescription.toLowerCase()}`;

  if (title.includes("product manager") || title === "pm" || title.includes(" product ")) return "product";
  if (title.includes("frontend")) return "frontend";
  if (title.includes("backend")) return "backend";
  if (title.includes("full")) return "fullstack";
  if (title.includes("software") || title.includes("engineer") || title.includes("developer") || title.includes("sde")) {
    return "software";
  }

  if (text.includes("product") || text.includes("pm")) return "product";
  if (text.includes("frontend")) return "frontend";
  if (text.includes("backend")) return "backend";
  if (text.includes("full")) return "fullstack";
  return "software";
}
