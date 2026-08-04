import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/supabase/active-org";

export const dynamic = "force-dynamic";

// The logo bucket is private, and it stays private: the file is streamed through our own origin
// instead of being handed out as a public or signed Supabase URL. Three things follow from that —
// the page needs no third-party img-src (the CSP keeps `img-src 'self'`), no link to the object
// survives outside a session, and the read goes through the caller's own storage policy.
//
// The path is never taken from the request. It is read from the organization row the active-org
// cookie points at, so there is nothing here to traverse.
export async function GET() {
  const activeOrg = await getActiveOrg();
  if (!activeOrg) return new Response("No active organization", { status: 403 });

  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organization")
    .select("logo_path")
    .eq("id", activeOrg)
    .maybeSingle();

  if (!org?.logo_path) return new Response("No logo", { status: 404 });

  const { data: file, error } = await supabase.storage.from("org-assets").download(org.logo_path);
  if (error || !file) return new Response("No logo", { status: 404 });

  return new Response(file, {
    headers: {
      "Content-Type": file.type || "image/png",
      // Private: a shared cache must never hold one office's logo for another's request. The page
      // fetches this with a ?v= stamp, so a replaced logo is a new URL rather than a stale hit.
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": "inline",
    },
  });
}
