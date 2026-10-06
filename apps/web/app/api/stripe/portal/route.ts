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
    .select("firms(stripe_customer_id)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .single();

  const firm = membership ? (Array.isArray(membership.firms) ? membership.firms[0] : membership.firms) : null;
  const customerId = firm?.stripe_customer_id as string | null | undefined;

  if (!customerId) {
    return NextResponse.json({ error: "No billing account found for this firm" }, { status: 400 });
  }

  const origin = process.env.APP_URL ?? new URL(request.url).origin;

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/settings`
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create billing portal session";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
