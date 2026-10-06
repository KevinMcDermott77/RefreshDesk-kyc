import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe/client";
import type Stripe from "stripe";

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function findFirmByCustomerId(
  supabase: ReturnType<typeof serviceClient>,
  customerId: string | null
) {
  if (!customerId) return null;
  const { data } = await supabase
    .from("firms")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return data;
}

function customerIdOf(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: "Missing signature or webhook secret" }, { status: 400 });
  }

  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid signature";
    return NextResponse.json({ error: `Webhook signature verification failed: ${message}` }, { status: 400 });
  }

  const supabase = serviceClient();

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = customerIdOf(subscription.customer);
        const firm = await findFirmByCustomerId(supabase, customerId);
        if (!firm) break;

        const isActive = subscription.status === "active" || subscription.status === "trialing";
        const newPlan = isActive ? "pro" : "starter";

        await supabase
          .from("firms")
          .update({
            plan: newPlan,
            stripe_subscription_id: subscription.id
          })
          .eq("id", firm.id);

        if (event.type === "customer.subscription.created") {
          await supabase.from("audit_events").insert({
            firm_id: firm.id,
            actor_user_id: null,
            event_type: "billing.subscription_created",
            entity_type: "firm",
            entity_id: firm.id,
            payload: { subscription_id: subscription.id, status: subscription.status }
          });
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = customerIdOf(subscription.customer);
        const firm = await findFirmByCustomerId(supabase, customerId);
        if (!firm) break;

        await supabase
          .from("firms")
          .update({ plan: "starter", stripe_subscription_id: null })
          .eq("id", firm.id);

        await supabase.from("audit_events").insert({
          firm_id: firm.id,
          actor_user_id: null,
          event_type: "billing.subscription_cancelled",
          entity_type: "firm",
          entity_id: firm.id,
          payload: { subscription_id: subscription.id }
        });
        break;
      }

      case "invoice.payment_failed":
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = customerIdOf(invoice.customer);
        const firm = await findFirmByCustomerId(supabase, customerId);
        if (!firm) break;

        const eventType =
          event.type === "invoice.payment_failed"
            ? "billing.payment_failed"
            : "billing.payment_succeeded";

        await supabase.from("audit_events").insert({
          firm_id: firm.id,
          actor_user_id: null,
          event_type: eventType,
          entity_type: "firm",
          entity_id: firm.id,
          payload: { invoice_id: invoice.id, amount_due: invoice.amount_due }
        });
        break;
      }

      default:
        break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process webhook event";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
