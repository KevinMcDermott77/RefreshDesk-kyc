export type PlanId = "starter" | "pro";

export const PLAN_LIMITS: Record<PlanId, { maxClients: number | null; maxMembers: number | null }> = {
  starter: { maxClients: 10, maxMembers: 1 },
  pro: { maxClients: null, maxMembers: null },
};

export const PRO_PRICE_GBP_PER_MONTH = 49;
