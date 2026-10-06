import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/client";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const sessionId = searchParams.get("session_id");
  const appOrigin = process.env.APP_URL ?? origin;

  if (!sessionId) {
    return NextResponse.redirect(`${appOrigin}/settings?upgrade=error`);
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${appOrigin}/login`);
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription"]
    });

    const subscription = session.subscription;
    const isActive =
      typeof subscription === "object" &&
      subscription !== null &&
      (subscription.status === "active" || subscription.status === "trialing");

    if (!isActive) {
      return NextResponse.redirect(`${appOrigin}/settings?upgrade=pending`);
    }

    const firmId = session.metadata?.firm_id;
    if (!firmId) {
      return NextResponse.redirect(`${appOrigin}/settings?upgrade=error`);
    }

    await supabase
      .from("firms")
      .update({
        plan: "pro",
        stripe_subscription_id:
          typeof subscription === "object" ? subscription.id : (subscription as unknown as string),
        stripe_customer_id:
          typeof session.customer === "string" ? session.customer : session.customer?.id ?? null
      })
      .eq("id", firmId);

    return NextResponse.redirect(`${appOrigin}/settings?upgraded=true`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to confirm checkout session";
    return NextResponse.redirect(`${appOrigin}/settings?upgrade=error&message=${encodeURIComponent(message)}`);
  }
}
