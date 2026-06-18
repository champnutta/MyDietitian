export type SubscriptionPlan = {
  planId: string;
  labelTh: string;
  days: number | null;
  priceThb: number | null;
  active: boolean;
  visible: boolean;
  sortOrder: number;
  promoTag?: string | null;
};

export type SubscriptionGrant = {
  planId: string | null;
  labelTh: string;
  days: number | null;
  priceThb: number | null;
  lifetime: boolean;
};

export type AdminSubscriptionCommand =
  | { action: "approve"; target: string; grantInput: string | null }
  | { action: "reject"; target: string; reason: string | null };

export const DEFAULT_SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  { planId: "30d", labelTh: "30 วัน", days: 30, priceThb: 59, active: true, visible: true, sortOrder: 10 },
  { planId: "90d", labelTh: "90 วัน", days: 90, priceThb: 150, active: true, visible: true, sortOrder: 20 }
] as const as SubscriptionPlan[];

export function parseAdminSubscriptionCommand(text: string): AdminSubscriptionCommand | null {
  const approve = text.match(/^(?:approve|อนุมัติ)\s+(\S+)(?:\s+(\S+))?/i);
  if (approve) {
    return {
      action: "approve",
      target: approve[1],
      grantInput: approve[2]?.trim() || null
    };
  }

  const reject = text.match(/^(?:reject|ปฏิเสธ|ไม่อนุมัติ)\s+(\S+)(?:\s+(.+))?/i);
  if (reject) {
    return {
      action: "reject",
      target: reject[1],
      reason: reject[2]?.trim() || null
    };
  }

  return null;
}

export function normalizeSubscriptionPlan(planId: string, data: Record<string, unknown>): SubscriptionPlan {
  const days = data.days === null || data.entitlementType === "lifetime" || data.lifetime === true
    ? null
    : Number(data.days ?? 0);
  return {
    planId,
    labelTh: String(data.labelTh ?? data.label ?? planId),
    days: days && Number.isFinite(days) ? days : null,
    priceThb: data.priceThb === null || data.priceThb === undefined ? null : Number(data.priceThb),
    active: data.active !== false,
    visible: data.visible !== false,
    sortOrder: Number(data.sortOrder ?? 999),
    promoTag: data.promoTag === undefined ? null : String(data.promoTag)
  };
}

export function subscriptionGrantFromPlan(plan: SubscriptionPlan): SubscriptionGrant | null {
  const lifetime = plan.days === null;
  if (!lifetime && (!plan.days || plan.days <= 0 || plan.days > 3660)) return null;
  return {
    planId: plan.planId,
    labelTh: plan.labelTh,
    days: plan.days,
    priceThb: plan.priceThb,
    lifetime
  };
}

export function subscriptionGrantFromRawInput(input: string | null): SubscriptionGrant | null {
  const token = (input ?? DEFAULT_SUBSCRIPTION_PLANS[0].planId).trim().toLowerCase();
  if (isLifetimeSubscriptionToken(token)) {
    return { planId: "lifetime", labelTh: "lifetime", days: null, priceThb: null, lifetime: true };
  }
  if (/^\d+$/.test(token)) {
    const days = Number(token);
    if (!Number.isFinite(days) || days <= 0 || days > 3660) return null;
    return { planId: null, labelTh: `${days} วัน`, days, priceThb: null, lifetime: false };
  }
  const fallbackPlan = DEFAULT_SUBSCRIPTION_PLANS.find((plan) => plan.planId.toLowerCase() === token);
  return fallbackPlan ? subscriptionGrantFromPlan(fallbackPlan) : null;
}

export function isLifetimeSubscriptionToken(token: string) {
  return ["lifetime", "infinite", "forever", "free", "vip"].includes(token.trim().toLowerCase());
}

export function formatSubscriptionPlanLine(plan: SubscriptionPlan) {
  const duration = plan.days === null ? "lifetime" : `${plan.days} วัน`;
  const price = plan.priceThb === null ? "free" : `${plan.priceThb} บาท`;
  const promo = plan.promoTag ? ` (${plan.promoTag})` : "";
  return `- ${plan.labelTh || duration}${promo} = ${price}`;
}
