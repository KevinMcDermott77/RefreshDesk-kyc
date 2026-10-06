import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/client";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: membership } = await supabase
    .from("firm_members")
    .select("firm_id, firms(id, name, stripe_customer_id)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .single();

  if (!membership) {
    return NextResponse.json({ error: "No active firm membership" }, { status: 400 });
  }

  const firm = Array.isArray(membership.firms) ? membership.firms[0] : membership.firms;
  if (!firm) {
    return NextResponse.json({ error: "Firm not found" }, { status: 400 });
  }

  const priceId = process.env.STRIPE_PRO_PRICE_ID;
  if (!priceId) {
    return NextResponse.json({ error: "Billing is not configured" }, { status: 500 });
  }

  const origin = process.env.APP_URL ?? new URL(request.url).origin;

  try {
    let customerId = firm.stripe_customer_id as string | null;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        name: firm.name,
        metadata: { firm_id: firm.id }
      });
      customerId = customer.id;

      await supabase
        .from("firms")
        .update({ stripe_customer_id: customerId })
        .eq("id", firm.id);
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/api/stripe/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/settings?upgrade=cancelled`,
      metadata: { firm_id: firm.id }
    });

    if (!session.url) {
      return NextResponse.json({ error: "Stripe did not return a checkout URL" }, { status: 502 });
    }

    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create checkout session";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
