// utils/estimate.ts
export type Money = number;
export type Unit = "SF" | "LF" | "CY" | "EA";

export type MarkupTier = {
  minAmount: number; // inclusive
  maxAmount: number | null; // null = no upper limit
  percent: number; // e.g. 20 = 20%
  rank: number;
};

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function applyMarkupTiers(
  base: Money,
  tiers: MarkupTier[]
): { markup: Money; effectivePct: number } {
  if (!tiers?.length) return { markup: 0, effectivePct: 0 };

  // Sort tiers by rank (1,2,3…)
  const sorted = [...tiers].sort((a, b) => a.rank - b.rank);

  let remaining = base;
  let markup = 0;

  for (const t of sorted) {
    if (remaining <= 0) break;

    const low = t.minAmount ?? 0;
    const high = t.maxAmount ?? Number.POSITIVE_INFINITY;
    const slice = Math.max(0, Math.min(remaining, high - low));
    if (slice > 0) {
      markup += slice * (t.percent / 100);
      remaining -= slice;
    }
  }

  const effectivePct = base > 0 ? (markup / base) * 100 : 0;
  return { markup: round2(markup), effectivePct: round2(effectivePct) };
}

export function lineSubtotal(
  quantity: number,
  unitCost: number
): Money {
  return round2(quantity * unitCost);
}

export function withMarkupAndContingency(
  base: Money,
  options: {
    useMarkupTiers: boolean;
    tiers: MarkupTier[];
    lineMarkupPct?: number; // per-line override when tiers are OFF
    contingencyPct?: number; // per-line contingency
    contingencyOrder: "AFTER_MARKUP" | "BEFORE_MARKUP";
  }
) {
  const { useMarkupTiers, tiers, lineMarkupPct = 0, contingencyPct = 0, contingencyOrder } =
    options;

  let subtotal = base;
  let markup = 0;

  if (useMarkupTiers) {
    const res = applyMarkupTiers(subtotal, tiers);
    markup = res.markup;
  } else {
    markup = round2(subtotal * (lineMarkupPct / 100));
  }

  let afterMarkup = subtotal + markup;

  let contingency = 0;
  if (contingencyOrder === "BEFORE_MARKUP") {
    // contingency applied to base; then markup applied to (base+contingency)
    const pre = round2(subtotal * (contingencyPct / 100));
    const newBase = subtotal + pre;
    let mk = 0;
    if (useMarkupTiers) mk = applyMarkupTiers(newBase, tiers).markup;
    else mk = round2(newBase * (lineMarkupPct / 100));
    return {
      base: subtotal,
      contingency: pre,
      markup: mk,
      total: round2(newBase + mk),
    };
  } else {
    contingency = round2(afterMarkup * (contingencyPct / 100));
    return {
      base: subtotal,
      contingency,
      markup,
      total: round2(afterMarkup + contingency),
    };
  }
}

export function addMobilization(
  currentTotal: Money,
  mobilizationPrice: Money,
  mobilizationCount: number
) {
  const mob = round2(mobilizationPrice * (mobilizationCount || 0));
  return { mobilization: mob, totalWithMobilization: round2(currentTotal + mob) };
}

export function applyTax(
  currentTotal: Money,
  tax: {
    rate: number; // e.g. 6.25 => 6.25%
    taxMaterials: boolean;
    taxLabor: boolean;
    taxEquipment: boolean;
    taxMarkup: boolean;
    taxContingency: boolean;
    taxableBreakdown: {
      materials: Money;
      labor: Money;
      equipment: Money;
      markup: Money;
      contingency: Money;
      other: Money;
    };
  }
) {
  const {
    rate,
    taxMaterials,
    taxLabor,
    taxEquipment,
    taxMarkup,
    taxContingency,
    taxableBreakdown,
  } = tax;

  const rateDec = rate / 100;
  let taxable = 0;
  if (taxMaterials) taxable += taxableBreakdown.materials;
  if (taxLabor) taxable += taxableBreakdown.labor;
  if (taxEquipment) taxable += taxableBreakdown.equipment;
  if (taxMarkup) taxable += taxableBreakdown.markup;
  if (taxContingency) taxable += taxableBreakdown.contingency;

  const taxAmt = round2(taxable * rateDec);
  return { tax: taxAmt, totalWithTax: round2(currentTotal + taxAmt) };
}
