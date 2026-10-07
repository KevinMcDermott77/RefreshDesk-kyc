import { formatDistanceToNow } from "date-fns";
import { redirect } from "next/navigation";
import { LogOut, Network, Settings } from "lucide-react";
import Link from "next/link";
import { logout } from "@/app/actions";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: membership } = await supabase
    .from("firm_members")
    .select("full_name, role, firms(id, name, mlr_supervisor, retention_days)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .single();

  if (!membership) {
    redirect("/onboarding");
  }

  const firm = Array.isArray(membership.firms)
    ? membership.firms[0]
    : membership.firms;

  const { data: events } = await supabase
    .from("audit_events")
    .select("event_type, created_at")
    .eq("firm_id", firm.id)
    .order("created_at", { ascending: false })
    .limit(5);

  const { count: clientCount } = await supabase
    .from('clients')
    .select('id', { count: 'exact', head: true })
    .eq('firm_id', firm.id)
    .eq('status', 'active');

  return (
    <main className="min-h-screen px-6 py-8">
      <section className="mx-auto max-w-6xl">
        <header className="flex flex-col justify-between gap-5 border-b border-[var(--line)] pb-6 md:flex-row md:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
              RefreshDesk
            </p>
            <h1 className="mt-2 text-3xl font-semibold">{firm.name}</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Signed in as {membership.full_name} · {membership.role}
            </p>
          </div>
          <div className="flex gap-3">
            <Link
              className="inline-flex items-center gap-2 border border-[var(--line)] bg-[var(--panel)] px-4 py-2 text-sm font-semibold"
              href="/dashboard/ownership"
            >
              <Network className="h-4 w-4" />
              Ownership chain
            </Link>
            <Link
              className="inline-flex items-center gap-2 border border-[var(--line)] bg-[var(--panel)] px-4 py-2 text-sm font-semibold"
              href="/settings"
            >
              <Settings className="h-4 w-4" />
              Settings
            </Link>
            <form action={logout}>
              <button className="inline-flex items-center gap-2 border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold">
                <LogOut className="h-4 w-4" />
                Log out
              </button>
            </form>
          </div>
        </header>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          <div className="border border-[var(--line)] bg-[var(--panel)] p-5">
            <p className="text-sm text-[var(--muted)]">MLR supervisor</p>
            <p className="mt-2 text-xl font-semibold">
              {firm.mlr_supervisor ?? "Not set"}
            </p>
          </div>
          <div className="border border-[var(--line)] bg-[var(--panel)] p-5">
            <p className="text-sm text-[var(--muted)]">Record retention</p>
            <p className="mt-2 text-xl font-semibold">
              {firm.retention_days} days
            </p>
          </div>
          <Link
            href="/dashboard/clients"
            className="block border border-[var(--line)] bg-[var(--panel)] p-5 transition-colors hover:border-[var(--accent)]"
          >
            <p className="text-sm text-[var(--muted)]">Active clients</p>
            <p className="mt-2 text-xl font-semibold">{clientCount ?? 0}</p>
            <p className="mt-1 text-xs text-[var(--accent)]">Manage clients →</p>
          </Link>
        </div>
        <section className="mt-8 border border-[var(--line)] bg-[var(--panel)] p-5">
          <h2 className="text-lg font-semibold">Recent audit events</h2>
          <div className="mt-4 divide-y divide-[var(--line)]">
            {events?.length ? (
              events.map((event, i) => (
                <div
                  className="flex items-center justify-between gap-4 py-3 text-sm"
                  key={`${event.event_type}-${event.created_at}-${i}`}
                >
                  <span className="font-medium">{event.event_type}</span>
                  <span className="text-[var(--muted)]">
                    {formatDistanceToNow(new Date(event.created_at), {
                      addSuffix: true
                    })}
                  </span>
                </div>
              ))
            ) : (
              <p className="py-3 text-sm text-[var(--muted)]">
                No audit events yet.
              </p>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
