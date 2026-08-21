import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// The fault photograph, streamed through our own origin (0079) — the same shape as the org logo.
//
// The path is never taken from the request. It is read from the maintenance_request row, THROUGH
// RLS, which is the point: those policies know what the bucket cannot. An office member confined to
// certain properties matches no row here and gets a 404, and a tenant matches only their own
// requests — while the storage policy alone would let any member of the org read any photo in it.
//
// So the bucket policy is the outer fence and this route is the exact one. Both have to pass: the
// download below still runs as the caller.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: row } = await supabase
    .from("maintenance_request")
    .select("photo_path")
    .eq("id", id)
    .maybeSingle();

  if (!row?.photo_path) return new Response("No photo", { status: 404 });

  const { data: file, error } = await supabase.storage
    .from("maintenance-photos")
    .download(row.photo_path);
  if (error || !file) return new Response("No photo", { status: 404 });

  return new Response(file, {
    headers: {
      "Content-Type": file.type || "image/jpeg",
      // Private: a shared cache must never hold one tenant's kitchen for another's request. The
      // photo is attached once and never replaced, so a long max-age is safe.
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": "inline",
    },
  });
}
