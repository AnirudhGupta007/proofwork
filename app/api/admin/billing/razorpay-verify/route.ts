import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminContext } from "@/app/lib/admin-context";
import { db } from "@/app/lib/db";
import { markCreditPurchasePaid, verifyRazorpayPaymentSignature } from "@/app/lib/billing/razorpay";

const verifySchema = z.object({
  razorpay_order_id: z.string().min(5),
  razorpay_payment_id: z.string().min(5),
  razorpay_signature: z.string().min(10)
});

export async function POST(request: Request) {
  try {
    const input = verifySchema.parse(await request.json());
    const { organization } = await getAdminContext();
    const purchase = await db.creditPurchase.findFirst({
      where: {
        organizationId: organization.id,
        razorpayOrderId: input.razorpay_order_id
      }
    });

    if (!purchase) {
      return NextResponse.json({ error: "Payment order not found" }, { status: 404 });
    }

    const valid = verifyRazorpayPaymentSignature({
      orderId: input.razorpay_order_id,
      paymentId: input.razorpay_payment_id,
      signature: input.razorpay_signature
    });

    if (!valid) {
      await db.creditPurchase.update({
        where: { id: purchase.id },
        data: {
          status: "signature_failed",
          razorpayPaymentId: input.razorpay_payment_id,
          razorpaySignature: input.razorpay_signature
        }
      });
      return NextResponse.json({ error: "Payment signature verification failed" }, { status: 400 });
    }

    const paid = await markCreditPurchasePaid({
      orderId: input.razorpay_order_id,
      paymentId: input.razorpay_payment_id,
      signature: input.razorpay_signature,
      metadata: {
        verifiedFrom: "checkout_handler",
        verifiedAt: new Date().toISOString()
      }
    });
    const updatedOrganization = await db.organization.findUniqueOrThrow({ where: { id: organization.id } });

    return NextResponse.json({
      purchase: paid,
      creditsRemaining: updatedOrganization.evaluationCredits
    });
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
        : err instanceof Error
          ? err.message
          : "Unable to verify payment";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
