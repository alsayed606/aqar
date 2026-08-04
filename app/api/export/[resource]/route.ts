import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";
import { toCsv, csvResponse } from "@/lib/csv";
import { LIST_SPECS, resolveSort, applySort } from "@/lib/list-specs";

export const dynamic = "force-dynamic";

// An export is a read of the same rows the screen is showing, so it goes through the same client
// and the same RLS: the org comes from the active-org cookie and the policies re-prove membership.
// There is no service-role key anywhere near this route.
//
// The whole filtered set is exported, not the visible page — a one-page CSV would be useless — but
// it is capped so a request cannot be turned into an unbounded read.
const MAX_ROWS = 5000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string }> },
) {
  const { resource } = await params;
  // Whitelisted by construction: an unknown name never reaches a query.
  const spec = LIST_SPECS[resource];
  if (!spec) return new Response("Unknown export", { status: 404 });

  const activeOrg = await getActiveOrg();
  if (!activeOrg) return new Response("No active organization", { status: 403 });

  const searchParams = request.nextUrl.searchParams;
  const q = (searchParams.get("q") ?? "").trim();
  const sort = resolveSort(spec, searchParams.get("sort") ?? undefined);

  const supabase = await createClient();
  let query = supabase.from(spec.table).select(spec.select).is("deleted_at", null);
  if (q) query = spec.applySearch(query, q);

  const { data, error } = await applySort(query, sort).limit(MAX_ROWS);
  if (error) return new Response(`Export failed: ${error.message}`, { status: 500 });

  return csvResponse(toCsv(data ?? [], spec.columns), spec.filename);
}
