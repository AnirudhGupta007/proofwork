import { serve } from "inngest/next";
import { functions, inngest } from "@/app/lib/inngest";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions
});
