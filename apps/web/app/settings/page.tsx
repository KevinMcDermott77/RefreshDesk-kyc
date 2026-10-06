import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SupervisorEmailForm } from "./supervisor-email-form";
import { TeamSection } from "./team-section";
import { BillingSection } from "./billing-section";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: membership } = await supabase
    .from("firm_members")
    .select("firm_id, role, firms(name, country_code, mlr_supervisor, mlr_supervisor_email, firm_reference_number)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .single();

  if (!membership) {
    redirect("/onboarding");
  }

  const firm = Array.isArray(membership.firms)
    ? membership.firms[0]
    : membership.firms;

  const isAdmin = membership.role === "admin";

  let members: { user_id: string; full_name: string; role: string }[] = [];
  let joinCodes: {
    id: string;
    code: string;
    role: string;
    created_at: string;
    use_count: number;
    max_uses: number | null;
    expires_at: string | null;
    is_active: boolean;
  }[] = [];

  let plan: {
    plan: "starter" | "pro";
    client_count: number;
    member_count: number;
    limits: { max_clients: number | null; max_members: number | null };
  } | null = null;

  if (isAdmin) {
    const [{ data: memberRows }, { data: joinCodeRows }, { data: planData }] = await Promise.all([
      supabase
        .from("firm_members")
        .select("user_id, full_name, role")
        .eq("firm_id", membership.firm_id)
        .eq("status", "active")
        .order("full_name"),
      supabase
        .from("firm_join_codes")
        .select("id, code, role, created_at, use_count, max_uses, expires_at, is_active")
        .eq("firm_id", membership.firm_id)
        .order("created_at", { ascending: false }),
      supabase.rpc("get_firm_plan")
    ]);

    members = memberRows ?? [];
    joinCodes = joinCodeRows ?? [];
    plan = planData ?? null;
  }

  return (
    <main className="min-h-screen px-6 py-8">
      <section className="mx-auto max-w-3xl border border-[var(--line)] bg-[var(--panel)] p-6 md:p-8">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
          Settings
        </p>
        <h1 className="text-3xl font-semibold">{firm.name}</h1>

        {isAdmin ? (
          <>
            <dl className="mt-8 grid gap-4 text-sm">
              <div className="flex justify-between border-b border-[var(--line)] pb-3">
                <dt className="text-[var(--muted)]">Country</dt>
                <dd className="font-medium">{firm.country_code}</dd>
              </div>
              <div className="flex justify-between border-b border-[var(--line)] pb-3">
                <dt className="text-[var(--muted)]">MLR supervisor</dt>
                <dd className="font-medium">{firm.mlr_supervisor ?? "Not set"}</dd>
              </div>
              <div className="flex justify-between border-b border-[var(--line)] pb-3">
                <dt className="text-[var(--muted)]">Firm reference number</dt>
                <dd className="font-medium">
                  {firm.firm_reference_number ?? "Not set"}
                </dd>
              </div>
            </dl>

            <SupervisorEmailForm currentEmail={firm.mlr_supervisor_email ?? null} />

            <TeamSection
              currentUserId={user.id}
              members={members}
              joinCodes={joinCodes}
              atMemberLimit={
                plan?.plan === "starter" &&
                plan.limits.max_members !== null &&
                plan.member_count >= plan.limits.max_members
              }
            />

            {plan ? <BillingSection plan={plan} /> : null}
          </>
        ) : (
          <p className="mt-8 text-sm text-[var(--muted)]">
            Firm settings and team management are available to admins only.
          </p>
        )}
      </section>
    </main>
  );
}
