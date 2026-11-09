import { AdminShell } from "@/app/components/AdminShell";
import { BillingCheckout } from "@/app/components/BillingCheckout";
import { getAdminContext } from "@/app/lib/admin-context";
import { creditPacks } from "@/app/lib/billing/razorpay";
import { db } from "@/app/lib/db";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const { organization } = await getAdminContext();
  const purchases = await db.creditPurchase.findMany({
    where: { organizationId: organization.id },
    orderBy: { createdAt: "desc" },
    take: 20
  });

  return (
    <AdminShell>
      <div className="topbar">
        <div>
          <p className="eyebrow">Billing</p>
          <h1>Assessment credits</h1>
          <p className="muted">Razorpay checkout, signature verification, and credit top-ups for your hiring team.</p>
        </div>
      </div>

      <div className="grid">
        <BillingCheckout packs={creditPacks.map((pack) => ({ ...pack }))} currentCredits={organization.evaluationCredits} />
        <section className="card">
          <h2>Payment history</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Pack</th>
                <th>Status</th>
                <th>Credits</th>
                <th>Amount</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((purchase) => (
                <tr key={purchase.id}>
                  <td>
                    {purchase.packName}
                    <div className="muted">{purchase.razorpayOrderId}</div>
                  </td>
                  <td>
                    <span className={purchase.status === "paid" ? "status green" : "status amber"}>{purchase.status}</span>
                  </td>
                  <td>{purchase.credits}</td>
                  <td>Rs {Math.round(purchase.amountPaise / 100).toLocaleString("en-IN")}</td>
                  <td>{purchase.createdAt.toLocaleString()}</td>
                </tr>
              ))}
              {purchases.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">
                    No payments yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>
      </div>
    </AdminShell>
  );
}
