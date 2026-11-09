import { NextResponse } from "next/server";
import { markCreditPurchasePaid, verifyRazorpayWebhookSignature } from "@/app/lib/billing/razorpay";
import { db } from "@/app/lib/db";
import { env } from "@/app/lib/env";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature") ?? "";

  if (env.RAZORPAY_WEBHOOK_SECRET && !verifyRazorpayWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const payload = JSON.parse(rawBody) as {
    event?: string;
    payload?: {
      payment?: {
        entity?: {
          id?: string;
          order_id?: string;
          status?: string;
        };
      };
    };
  };
  const payment = payload.payload?.payment?.entity;
  const orderId = payment?.order_id;

  if (!orderId || !["payment.captured", "payment.authorized"].includes(payload.event ?? "")) {
    return NextResponse.json({ received: true, ignored: true });
  }

  const purchase = await db.creditPurchase.findUnique({ where: { razorpayOrderId: orderId } });
  if (!purchase) return NextResponse.json({ received: true, ignored: "unknown-order" });

  await markCreditPurchasePaid({
    orderId,
    paymentId: payment?.id,
    metadata: {
      verifiedFrom: "webhook",
      event: payload.event,
      paymentStatus: payment?.status,
      receivedAt: new Date().toISOString()
    }
  });

  return NextResponse.json({ received: true });
}
