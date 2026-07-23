import { safeReturnTo } from "@/lib/return-to";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { returnTo } = await searchParams;
  return <LoginForm returnTo={safeReturnTo(returnTo) ?? ""} />;
}
