import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminContext } from "@/app/lib/admin-context";
import { createRazorpayCreditOrder } from "@/app/lib/billing/razorpay";

const orderSchema = z.object({
  packId: z.string().min(2)
});

export async function POST(request: Request) {
  try {
    const input = orderSchema.parse(await request.json());
    const { organization, admin } = await getAdminContext();
    const order = await createRazorpayCreditOrder({
      organizationId: organization.id,
      organizationName: organization.name,
      adminEmail: admin.email,
      packId: input.packId
    });

    return NextResponse.json({
      purchaseId: order.purchase.id,
      keyId: order.keyId,
      orderId: order.orderId,
      amountPaise: order.pack.amountPaise,
      currency: "INR",
      credits: order.pack.credits,
      packName: order.pack.name,
      organizationName: organization.name,
      adminEmail: admin.email
    });
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
        : err instanceof Error
          ? err.message
          : "Unable to create payment order";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
