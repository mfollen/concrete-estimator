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

export function lineSubtotal(quantity: number, unitCost: number): Money {
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
  const {
    useMarkupTiers,
    tiers,
    lineMarkupPct = 0,
    contingencyPct = 0,
    contingencyOrder,
  } = options;

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
  return {
    mobilization: mob,
    totalWithMobilization: round2(currentTotal + mob),
  };
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

// ---------------------------------------------------------------------------
// Aggregate estimate totals (MVP helper used by the project page)
// ---------------------------------------------------------------------------

export type TotalsItemInput = {
  quantity?: number | null;
  unitCost?: number | null;
  isMaterial?: boolean | null;
  isLabor?: boolean | null;
  isEquipment?: boolean | null;
  markupPct?: number | null;
  contingencyPct?: number | null;
};

export type TotalsEstimateInput = {
  markupPct?: number | null;
  contingencyPct?: number | null;
  mobilizationCount?: number | null;
} | null;

export type TotalsSettingsInput = {
  useMarkupTiers?: boolean | null;
  defaultContingency?: number | null;
  contingencyOrder?: "AFTER_MARKUP" | "BEFORE_MARKUP" | null;
  mobilizationPrice?: number | null;
} | null;

export type TotalsTaxInput = {
  rate?: number | null;
  taxMaterials?: boolean | null;
  taxLabor?: boolean | null;
  taxEquipment?: boolean | null;
  taxMarkup?: boolean | null;
  taxContingency?: boolean | null;
} | null;

export type ComputeTotalsInput = {
  items: TotalsItemInput[];
  estimate: TotalsEstimateInput;
  settings: TotalsSettingsInput;
  tax: TotalsTaxInput;
  tiers: MarkupTier[];
};

export type ComputeTotalsResult = {
  subtotal: Money;
  markupPct: number; // percent, e.g. 15 = 15%
  contingencyPct: number; // percent
  markupAmount: Money;
  contingencyAmount: Money;
  afterMarkup: Money;
  afterContingency: Money;
  mobilization: Money;
  taxRate: number; // percent
  taxBase: Money;
  taxTotal: Money;
  grand: Money;
};

function sanitizeNumber(
  value: number | null | undefined,
  fallback = 0
): number {
  if (value === null || value === undefined || Number.isNaN(value)) return fallback;
  return Number(value);
}

/**
 * Compute all major monetary totals for an estimate.
 *
 * NOTE (MVP): still uses a simplified tax model:
 * if any tax flags in TaxScope are true, we apply the tax rate
 * to the full post-contingency total (before mobilization).
 */
export function computeTotals(input: ComputeTotalsInput): ComputeTotalsResult {
  const { items, estimate, settings, tax, tiers } = input;

  // Subtotal: sum of qty * unitCost across all items
  const subtotal = items.reduce((sum, it) => {
    const qty = sanitizeNumber(it.quantity);
    const unitCost = sanitizeNumber(it.unitCost);
    return sum + qty * unitCost;
  }, 0);

  // Markup %
  let markupRate = 0;
  const useTiers = !!settings?.useMarkupTiers && tiers.length > 0;

  if (useTiers) {
    const res = applyMarkupTiers(subtotal, tiers);
    // res.effectivePct is already the blended tier %,
    // but we want the actual markupRate (markup/base)
    markupRate = subtotal > 0 ? res.markup / subtotal : 0;
  } else {
    markupRate = sanitizeNumber(estimate?.markupPct) / 100;
  }

  // Contingency %
  const contingencyRate =
    sanitizeNumber(
      estimate?.contingencyPct,
      sanitizeNumber(settings?.defaultContingency)
    ) / 100;

  const markupAmount = subtotal * markupRate;
  const afterMarkup = subtotal + markupAmount;

  const contingencyBase =
    settings?.contingencyOrder === "BEFORE_MARKUP" ? subtotal : afterMarkup;

  const contingencyAmount = contingencyBase * contingencyRate;

  const afterContingency =
    settings?.contingencyOrder === "BEFORE_MARKUP"
      ? subtotal + markupAmount + contingencyAmount
      : afterMarkup + contingencyAmount;

  const mobilizationPrice = sanitizeNumber(settings?.mobilizationPrice);
  const mobilizationCount = sanitizeNumber(estimate?.mobilizationCount);
  const mobilization = mobilizationPrice * mobilizationCount;

  // Tax
  const taxRateDec = sanitizeNumber(tax?.rate) / 100;
  const anyTaxFlag =
    !!tax?.taxMaterials ||
    !!tax?.taxLabor ||
    !!tax?.taxEquipment ||
    !!tax?.taxMarkup ||
    !!tax?.taxContingency;

  // MVP: apply tax flags to the entire post-contingency total,
  // excluding mobilization.
  const taxBase = anyTaxFlag ? afterContingency : 0;
  const taxTotal = taxBase * taxRateDec;

  const grand = afterContingency + mobilization + taxTotal;

  return {
    subtotal: round2(subtotal),
    markupPct: round2(markupRate * 100),
    contingencyPct: round2(contingencyRate * 100),
    markupAmount: round2(markupAmount),
    contingencyAmount: round2(contingencyAmount),
    afterMarkup: round2(afterMarkup),
    afterContingency: round2(afterContingency),
    mobilization: round2(mobilization),
    taxRate: round2(taxRateDec * 100),
    taxBase: round2(taxBase),
    taxTotal: round2(taxTotal),
    grand: round2(grand),
  };
}
