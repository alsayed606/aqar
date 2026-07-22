import Link from "next/link";
import { acceptPortalInvite } from "../actions";

export const dynamic = "force-dynamic";

export default async function PortalJoinPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h1 className="mb-1 text-lg font-semibold">ربط حسابك بالبوابة</h1>

        {!token ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            الرابط غير مكتمل. اطلب من مكتب الإدارة رابطاً جديداً.
          </p>
        ) : (
          <>
            <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
              بقبولك يُربط حسابك بملفك لدى المكتب، فتطّلع على بياناتك (كمالك: كشوفك وتوريداتك؛ كمستأجر: عقدك ودفعاتك).
            </p>
            {error && (
              <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
                {error}
              </p>
            )}
            <form action={acceptPortalInvite}>
              <input type="hidden" name="token" value={token} />
              <button className="w-full rounded-lg bg-brand px-4 py-2.5 font-medium text-white hover:bg-brand-fg">
                ربط الحساب والدخول
              </button>
            </form>
          </>
        )}

        <div className="mt-4 border-t border-neutral-100 pt-4 dark:border-neutral-800">
          <Link href="/portal" className="text-sm text-brand hover:underline">
            الذهاب إلى البوابة ←
          </Link>
        </div>
      </section>
    </div>
  );
}
