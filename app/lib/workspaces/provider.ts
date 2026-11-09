import { DaytonaWorkspaceProvider } from "./daytona-provider";
import { FakeWorkspaceProvider } from "./fake-provider";
import type { WorkspaceProvider } from "./types";

export function getWorkspaceProvider(): WorkspaceProvider {
  if (process.env.WORKSPACE_PROVIDER === "fake" || !process.env.DAYTONA_API_KEY) {
    return new FakeWorkspaceProvider();
  }

  return new DaytonaWorkspaceProvider();
}
