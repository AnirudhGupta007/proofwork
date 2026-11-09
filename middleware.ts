import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isClerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
const isProtectedRoute = createRouteMatcher(["/admin(.*)", "/api/admin(.*)", "/onboarding(.*)"]);

const passthroughMiddleware = () => NextResponse.next();

export default isClerkConfigured
  ? clerkMiddleware(async (auth, request) => {
      if (isProtectedRoute(request)) {
        await auth.protect({
          unauthenticatedUrl: new URL("/sign-in", request.url).toString()
        });
      }
    })
  : passthroughMiddleware;

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|png|gif|svg|webp|ico|woff2?|ttf|map)).*)", "/(api|trpc)(.*)"]
};
