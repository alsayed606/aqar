import { safeReturnTo } from "@/lib/return-to";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; error?: string; notice?: string }>;
}) {
  const { returnTo, error, notice } = await searchParams;
  return (
    <LoginForm returnTo={safeReturnTo(returnTo) ?? ""} initialError={error} initialNotice={notice} />
  );
}
