import { createHmac, timingSafeEqual } from "crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/app/lib/db";
import { env } from "@/app/lib/env";

export const creditPacks = [
  {
    id: "starter_10",
    name: "Starter Pack",
    credits: 10,
    amountPaise: 25_000,
    description: "10 assessment credits at Rs 250 per assessment"
  },
  {
    id: "growth_50",
    name: "Growth Pack",
    credits: 50,
    amountPaise: 100_000,
    description: "50 assessment credits at Rs 200 per assessment"
  },
  {
    id: "scale_200",
    name: "Scale Pack",
    credits: 200,
    amountPaise: 300_000,
    description: "200 assessment credits at Rs 150 per assessment"
  }
] as const;

export type CreditPackId = (typeof creditPacks)[number]["id"];

export function creditPackById(packId: string) {
  return creditPacks.find((pack) => pack.id === packId);
}

function razorpayAuthHeader() {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw new Error("Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.");
  }

  return `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString("base64")}`;
}

export function verifyRazorpayPaymentSignature(input: {
  orderId: string;
  paymentId: string;
  signature: string;
}) {
  if (!env.RAZORPAY_KEY_SECRET) {
    throw new Error("Razorpay secret is not configured.");
  }

  const expected = createHmac("sha256", env.RAZORPAY_KEY_SECRET)
    .update(`${input.orderId}|${input.paymentId}`)
    .digest("hex");
  const actualBuffer = Buffer.from(input.signature);
  const expectedBuffer = Buffer.from(expected);

  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function verifyRazorpayWebhookSignature(rawBody: string, signature: string) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) return false;
  const expected = createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest("hex");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export async function createRazorpayCreditOrder(input: {
  organizationId: string;
  organizationName: string;
  adminEmail: string;
  packId: string;
}) {
  const pack = creditPackById(input.packId);
  if (!pack) throw new Error("Unknown credit pack.");

  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw new Error("Razorpay is not configured yet. Add your Razorpay key id and secret to .env.");
  }

  const receipt = `pl_${Date.now().toString(36)}_${input.organizationId.slice(-8)}`.slice(0, 40);
  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: razorpayAuthHeader(),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      amount: pack.amountPaise,
      currency: "INR",
      receipt,
      notes: {
        organizationId: input.organizationId,
        organizationName: input.organizationName,
        adminEmail: input.adminEmail,
        packId: pack.id,
        credits: String(pack.credits)
      }
    })
  });

  const order = (await response.json()) as { id?: string; error?: { description?: string; reason?: string } };
  if (!response.ok || !order.id) {
    throw new Error(order.error?.description ?? order.error?.reason ?? "Unable to create Razorpay order.");
  }

  const purchase = await db.creditPurchase.create({
    data: {
      organizationId: input.organizationId,
      packId: pack.id,
      packName: pack.name,
      credits: pack.credits,
      amountPaise: pack.amountPaise,
      currency: "INR",
      razorpayOrderId: order.id,
      metadata: {
        receipt,
        description: pack.description
      } satisfies Prisma.InputJsonObject
    }
  });

  return { purchase, pack, orderId: order.id, keyId: env.RAZORPAY_KEY_ID };
}

export async function markCreditPurchasePaid(input: {
  orderId: string;
  paymentId?: string;
  signature?: string;
  metadata?: Prisma.InputJsonValue;
}) {
  return db.$transaction(async (tx) => {
    const purchase = await tx.creditPurchase.findUniqueOrThrow({
      where: { razorpayOrderId: input.orderId }
    });

    if (purchase.status === "paid") {
      return purchase;
    }

    const paid = await tx.creditPurchase.update({
      where: { id: purchase.id },
      data: {
        status: "paid",
        paidAt: new Date(),
        razorpayPaymentId: input.paymentId,
        razorpaySignature: input.signature,
        metadata: input.metadata ?? (purchase.metadata === null ? Prisma.JsonNull : (purchase.metadata as Prisma.InputJsonValue))
      }
    });

    await tx.organization.update({
      where: { id: purchase.organizationId },
      data: {
        evaluationCredits: { increment: purchase.credits },
        planName: "Paid credits"
      }
    });

    return paid;
  });
}
