import { createHash, randomBytes, timingSafeEqual } from "crypto";

export const inviteTokenBytes = 32;

export function createInviteToken() {
  return randomBytes(inviteTokenBytes).toString("base64url");
}

export function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function isInviteExpired(expiresAt: Date, now = new Date()) {
  return expiresAt.getTime() <= now.getTime();
}

export function verifyTokenHash(token: string, expectedHash: string) {
  const actual = Buffer.from(hashInviteToken(token));
  const expected = Buffer.from(expectedHash);

  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
