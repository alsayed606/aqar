import { cookies } from "next/headers";

/** The active organization id from the request cookie (the value RLS proves against). */
export async function getActiveOrg(): Promise<string | null> {
  return (await cookies()).get("active-org")?.value ?? null;
}
