import type { Prisma } from "@prisma/client";
import { db } from "@/app/lib/db";

export async function logAttemptEvent(attemptId: string, type: string, message: string, metadata?: Record<string, unknown>) {
  return db.eventLog.create({
    data: {
      attemptId,
      type,
      message,
      metadata: metadata as Prisma.InputJsonValue | undefined
    }
  });
}
