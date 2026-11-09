"use client";

import { useState } from "react";
import { CreditCard } from "lucide-react";

type CreditPack = {
  id: string;
  name: string;
  credits: number;
  amountPaise: number;
  description: string;
};

type RazorpayCheckoutResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill?: { email?: string };
  notes?: Record<string, string>;
  theme?: { color?: string };
  handler: (response: RazorpayCheckoutResponse) => void;
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open: () => void };
  }
}

function loadRazorpayScript() {
  return new Promise<void>((resolve, reject) => {
    if (window.Razorpay) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Unable to load Razorpay checkout."));
    document.body.appendChild(script);
  });
}

function formatInr(amountPaise: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amountPaise / 100);
}

export function BillingCheckout({ packs, currentCredits }: { packs: CreditPack[]; currentCredits: number }) {
  const [busyPack, setBusyPack] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [credits, setCredits] = useState(currentCredits);

  async function buy(packId: string) {
    setBusyPack(packId);
    setMessage(null);

    try {
      await loadRazorpayScript();
      const orderResponse = await fetch("/api/admin/billing/razorpay-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId })
      });
      const order = await orderResponse.json();

      if (!orderResponse.ok) {
        throw new Error(order.error ?? "Unable to create payment order.");
      }

      const checkout = new window.Razorpay!({
        key: order.keyId,
        amount: order.amountPaise,
        currency: order.currency,
        name: "Proofwork",
        description: `${order.packName} - ${order.credits} assessment credits`,
        order_id: order.orderId,
        prefill: { email: order.adminEmail },
        notes: {
          purchaseId: order.purchaseId,
          organizationName: order.organizationName
        },
        theme: { color: "#1E4D3A" },
        handler: async (response) => {
          const verifyResponse = await fetch("/api/admin/billing/razorpay-verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(response)
          });
          const verified = await verifyResponse.json();
          if (!verifyResponse.ok) {
            throw new Error(verified.error ?? "Payment verification failed.");
          }
          setCredits(verified.creditsRemaining);
          setMessage(`Payment verified. You now have ${verified.creditsRemaining} assessment credits.`);
          setBusyPack(null);
        }
      });

      checkout.open();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Payment failed.");
      setBusyPack(null);
    }
  }

  return (
    <section className="card grid">
      <div>
        <p className="eyebrow">Billing</p>
        <h2>{credits} assessment credits available</h2>
        <p className="muted">Buy prepaid assessment credits. Credits are consumed only when candidates start an assessment.</p>
      </div>
      <div className="pricing-grid">
        {packs.map((pack) => (
          <div className="pricing-card" key={pack.id}>
            <p className="eyebrow">{pack.name}</p>
            <h3>{formatInr(pack.amountPaise)}</h3>
            <p className="muted">{pack.description}</p>
            <strong>{pack.credits} credits</strong>
            <button className="button" type="button" onClick={() => void buy(pack.id)} disabled={Boolean(busyPack)}>
              <CreditCard size={16} />
              {busyPack === pack.id ? "Opening checkout" : "Buy credits"}
            </button>
          </div>
        ))}
      </div>
      {message ? <p className="muted">{message}</p> : null}
    </section>
  );
}
