// app/api/seed-demo/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// If your org table is named differently, change this:
const ORG_TABLE = "Org";

// ---- Types for helper returns (to satisfy isolatedModules) ----
type OrgResult = { orgId: string; created: boolean };
type ProjectResult = { projectId: string; created: boolean };
type EstimateResult = { estimateId: string; created: boolean };
type ItemsResult = { inserted: number; skipped: boolean };

const DEMO = {
  ORG_NAME: "Demo Org",
  PROJECT_NAME: "Warehouse Expansion",
  ESTIMATE_TITLE: "Phase 1 – Concrete & Mobilization",
  ITEMS: [
    { rank: 1, kind: "material", description: "Ready-mix concrete (4000 PSI)", unit: "yd³", quantity: 120, unitCost: 145, isMaterial: true, isLabor: false, isEquipment: false },
    { rank: 2, kind: "labor", description: "Formwork crew", unit: "hr", quantity: 160, unitCost: 55, isMaterial: false, isLabor: true, isEquipment: false },
    { rank: 3, kind: "equipment", description: "Concrete pump (47m)", unit: "day", quantity: 2, unitCost: 1800, isMaterial: false, isLabor: false, isEquipment: true },
    { rank: 4, kind: "material", description: "Rebar #4", unit: "lb", quantity: 2500, unitCost: 0.95, isMaterial: true, isLabor: false, isEquipment: false },
  ] as const,
  ORG_SETTINGS: {
    useMarkupTiers: true,
    defaultContingency: 5,            // percent (UI divides by 100 where needed)
    contingencyOrder: "AFTER_MARKUP", // uppercase to match your page.tsx logic
    mobilizationPrice: 2500,
    mobilizationAutoPerCrewDay: false,
    crewHoursPerDay: 10,
    logoUrl: null as string | null,
    validityDays: 30,
  },
  TAX_SCOPE: {
    rate: 7.5, // percent (UI divides by 100)
    taxMaterials: true,
    taxLabor: false,
    taxEquipment: true,
    taxMarkup: false,
    taxContingency: false,
  },
  MARKUP_TIERS: [
    { rank: 1, minAmount: 0,     maxAmount: 10000, percent: 15 },
    { rank: 2, minAmount: 10000, maxAmount: 50000, percent: 12 },
    { rank: 3, minAmount: 50000, maxAmount: null,  percent: 10 },
  ] as const,
  ESTIMATE_DEFAULTS: {
    overheadPct: 0,
    mobilizationCount: 1,
    overtimeHoursPerDay: 0,
    markupPct: 12,     // used if tiers disabled
    contingencyPct: 5, // percent
  },
};

type Supa = ReturnType<typeof createClient>;
function getServerSupabase(): Supa {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function findOrCreateOrg(supabase: Supa, userId: string): Promise<OrgResult> {
  // Reuse any org through membership
  const { data: membershipRaw, error: membershipErr } = await supabase
    .from("Membership")
    .select("orgId")
    .eq("userId", userId)
    .limit(1)
    .maybeSingle();
  if (membershipErr) throw membershipErr;

  const membership = membershipRaw as { orgId?: string } | null;
  if (membership?.orgId) return { orgId: membership.orgId, created: false };

  // Reuse Demo Org by name
  const { data: foundRaw, error: findErr } = await supabase
    .from(ORG_TABLE)
    .select("id")
    .eq("name", DEMO.ORG_NAME)
    .limit(1)
    .maybeSingle();
  if (findErr) throw findErr;

  const found = foundRaw as { id?: string } | null;
  if (found?.id) {
    const { error: upErr } = await supabase
      .from("Membership")
      .upsert([{ userId, orgId: found.id, role: "OWNER" }], { onConflict: "userId,orgId" });
    if (upErr) throw upErr;
    return { orgId: found.id, created: false };
  }

  // Create new Demo Org
  const { data: createdRaw, error: orgCreateErr } = await supabase
    .from(ORG_TABLE)
    .insert([{ name: DEMO.ORG_NAME }])
    .select("id")
    .single();
  if (orgCreateErr) throw orgCreateErr;

  const created = createdRaw as { id: string };
  const { error: memErr } = await supabase
    .from("Membership")
    .upsert([{ userId, orgId: created.id, role: "OWNER" }], { onConflict: "userId,orgId" });
  if (memErr) throw memErr;

  return { orgId: created.id, created: true };
}

async function upsertOrgSettings(supabase: Supa, orgId: string): Promise<void> {
  const { error } = await supabase.from("OrgSettings").upsert(
    [{ orgId, ...DEMO.ORG_SETTINGS }],
    { onConflict: "orgId" }
  );
  if (error) throw error;
}

async function upsertTaxScope(supabase: Supa, orgId: string): Promise<void> {
  const { error } = await supabase.from("TaxScope").upsert(
    [{ orgId, ...DEMO.TAX_SCOPE }],
    { onConflict: "orgId" }
  );
  if (error) throw error;
}

async function upsertMarkupTiers(supabase: Supa, orgId: string): Promise<void> {
  const { error: delErr } = await supabase.from("MarkupTier").delete().eq("orgId", orgId);
  if (delErr) throw delErr;

  const rows = DEMO.MARKUP_TIERS.map(t => ({
    orgId,
    minAmount: t.minAmount,
    maxAmount: t.maxAmount,
    percent: t.percent,
    rank: t.rank,
  }));
  const { error } = await supabase.from("MarkupTier").insert(rows);
  if (error) throw error;
}

async function findOrCreateProject(supabase: Supa, orgId: string): Promise<ProjectResult> {
  const { data: existingRaw, error: findErr } = await supabase
    .from("Project")
    .select("id")
    .eq("orgId", orgId)
    .eq("name", DEMO.PROJECT_NAME)
    .limit(1)
    .maybeSingle();
  if (findErr) throw findErr;

  const existing = existingRaw as { id?: string } | null;
  if (existing?.id) return { projectId: existing.id, created: false };

  const { data: createdRaw, error: createErr } = await supabase
    .from("Project")
    .insert([{ orgId, name: DEMO.PROJECT_NAME, clientName: "Acme Distribution LLC", location: "Cicero, IL" }])
    .select("id")
    .single();
  if (createErr) throw createErr;

  const created = createdRaw as { id: string };
  return { projectId: created.id, created: true };
}

async function findOrCreateEstimate(supabase: Supa, projectId: string): Promise<EstimateResult> {
  const { data: existingRaw, error: findErr } = await supabase
    .from("Estimate")
    .select("id")
    .eq("projectId", projectId)
    .order("createdat", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (findErr) throw findErr;

  const existing = existingRaw as { id?: string } | null;
  if (existing?.id) return { estimateId: existing.id, created: false };

  const { data: createdRaw, error: createErr } = await supabase
    .from("Estimate")
    .insert([{ projectId, title: DEMO.ESTIMATE_TITLE, ...DEMO.ESTIMATE_DEFAULTS }])
    .select("id")
    .single();
  if (createErr) throw createErr;

  const created = createdRaw as { id: string };
  return { estimateId: created.id, created: true };
}

async function seedItemsIfEmpty(supabase: Supa, estimateId: string): Promise<ItemsResult> {
  const { count, error: countErr } = await supabase
    .from("EstimateItem")
    .select("*", { count: "exact", head: true })
    .eq("estimateId", estimateId);
  if (countErr) throw countErr;

  const num = (count ?? 0) as number;
  if (num > 0) return { inserted: 0, skipped: true };

  const rows = DEMO.ITEMS.map(it => ({
    estimateId,
    kind: it.kind,
    description: it.description,
    unit: it.unit,
    quantity: it.quantity,
    unitCost: it.unitCost,
    markupPct: null,
    contingencyPct: null,
    durationHours: null,
    isMaterial: it.isMaterial,
    isLabor: it.isLabor,
    isEquipment: it.isEquipment,
    rank: it.rank,
  }));

  const { error } = await supabase.from("EstimateItem").insert(rows);
  if (error) throw error;
  return { inserted: rows.length, skipped: false };
}

export async function POST(req: Request) {
  try {
    const bodyUnknown = await req.json().catch(() => ({}));
    const body = bodyUnknown as { userId?: string };
    const userId = body.userId;

    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "Missing userId in request body. Post { userId } after sign-in for MVP." },
        { status: 400 }
      );
    }

    const supabase = getServerSupabase();

    const orgRes = await findOrCreateOrg(supabase, userId);
    await upsertOrgSettings(supabase, orgRes.orgId);
    await upsertTaxScope(supabase, orgRes.orgId);
    await upsertMarkupTiers(supabase, orgRes.orgId);

    const projRes = await findOrCreateProject(supabase, orgRes.orgId);
    const estRes = await findOrCreateEstimate(supabase, projRes.projectId);
    const itemsRes = await seedItemsIfEmpty(supabase, estRes.estimateId);

    return NextResponse.json({
      ok: true,
      summary: {
        org: orgRes.created ? "created" : "reused",
        project: projRes.created ? "created" : "reused",
        estimate: estRes.created ? "created" : "reused_latest",
        items: itemsRes.skipped ? "skipped_existing" : `inserted_${itemsRes.inserted}`,
      },
      ids: { orgId: orgRes.orgId, projectId: projRes.projectId, estimateId: estRes.estimateId },
    });
  } catch (e: any) {
    console.error("[/api/seed-demo] error", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
