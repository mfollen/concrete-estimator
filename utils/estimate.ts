export type Item = { quantity: number; unitCost: number; markupPct: number; isMaterial?: boolean; isLabor?: boolean; isEquipment?: boolean; };
export type MarkupTier = { minAmount: number; maxAmount?: number | null; percent: number; rank: number };

const pct = (n:number, p:number)=> (n * p) / 100;
const sum = (a:number[])=> a.reduce((x,y)=>x+y,0);

export function pickTier(tiers: MarkupTier[], lineBase: number): number {
  const sorted = [...tiers].sort((a,b)=> a.rank - b.rank);
  const tier = sorted.find(t => lineBase >= t.minAmount && (t.maxAmount == null || lineBase < t.maxAmount));
  return tier ? tier.percent : 0;
}

export function totals(opts: {
  items: Item[]; overheadPct: number; useMarkupTiers: boolean; tiers?: MarkupTier[];
  contingencyPct: number; contingencyOrder: "BEFORE_MARKUP" | "AFTER_MARKUP";
  taxRate: number; taxScope: { materials: boolean; labor: boolean; equipment: boolean; markup: boolean; contingency: boolean };
  mobilization: { count: number; price: number };
}) {
  const { items, overheadPct, useMarkupTiers, tiers = [], contingencyPct, contingencyOrder, taxRate, taxScope, mobilization } = opts;
  const lineBases = items.map(i => i.quantity * i.unitCost);
  const direct = sum(lineBases);
  const overhead = pct(direct, overheadPct);

  const lineMarkups = items.map((i, idx) => {
    if (useMarkupTiers) {
      const tierPct = pickTier(tiers, lineBases[idx]);
      return pct(lineBases[idx], tierPct);
    } else {
      return pct(lineBases[idx], i.markupPct);
    }
  });
  const markup = sum(lineMarkups);

  const mobilizationCost = (mobilization?.count||0) * (mobilization?.price||0);

  let baseBeforeCont = direct + overhead + markup + mobilizationCost;
  let contingency = 0;
  if (contingencyOrder === "BEFORE_MARKUP") {
    const pre = direct + overhead + mobilizationCost;
    contingency = pct(pre, contingencyPct);
    baseBeforeCont = pre + contingency + markup;
  } else {
    contingency = pct(baseBeforeCont, contingencyPct);
    baseBeforeCont += contingency;
  }

  let taxable = 0;
  if (taxScope.materials) taxable += sum(items.map((i,idx)=> i.isMaterial ? lineBases[idx] : 0));
  if (taxScope.labor) taxable += sum(items.map((i,idx)=> i.isLabor ? lineBases[idx] : 0));
  if (taxScope.equipment) taxable += sum(items.map((i,idx)=> i.isEquipment ? lineBases[idx] : 0)) + mobilizationCost;
  if (taxScope.markup) taxable += markup;
  if (taxScope.contingency) taxable += contingency;

  const tax = pct(taxable, taxRate);
  const grand = baseBeforeCont + tax;

  return { direct, overhead, markup, mobilization: mobilizationCost, contingency, tax, grand };
}
