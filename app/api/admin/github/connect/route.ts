import { NextResponse } from "next/server";
import { env } from "@/app/lib/env";
import { getAdminContext } from "@/app/lib/admin-context";

export async function GET() {
  const { organization } = await getAdminContext();

  if (!env.GITHUB_APP_SLUG) {
    return NextResponse.json(
      {
        error: "GitHub private repo access is not configured yet.",
        setupRequired: true,
        setupUrl: "https://github.com/settings/apps/new",
        setupSteps: [
          "Create a GitHub App named Proofwork Local or Proofwork.",
          `Use ${env.NEXT_PUBLIC_APP_URL}/admin/invitations?github_install=complete as the setup URL.`,
          "Give it repository Contents read access so Daytona can clone selected repos.",
          "Install it only on the repositories employers should use for assessments.",
          "Copy the app slug into GITHUB_APP_SLUG in .env and restart the dev server."
        ]
      },
      { status: 501 }
    );
  }

  const setupUrl = `${env.NEXT_PUBLIC_APP_URL}/admin/invitations?github_install=complete`;
  const params = new URLSearchParams({
    state: organization.id,
    setup_url: setupUrl
  });

  return NextResponse.json({
    url: `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new?${params.toString()}`
  });
}
