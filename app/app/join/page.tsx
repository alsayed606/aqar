import Link from "next/link";
import { acceptInvitation } from "../team/actions";

export const dynamic = "force-dynamic";

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h1 className="mb-1 text-lg font-semibold">دعوة للانضمام إلى منشأة</h1>

        {!token ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            رابط الدعوة غير مكتمل. اطلب من مسؤول المنشأة رابطاً جديداً.
          </p>
        ) : (
          <>
            <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
              دُعيت للانضمام إلى منشأة على منصة عقار. بقبولك تُضاف عضويتك بالدور المحدّد في الدعوة.
            </p>
            {error && (
              <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
                {error}
              </p>
            )}
            <form action={acceptInvitation}>
              <input type="hidden" name="token" value={token} />
              <button className="w-full rounded-lg bg-brand px-4 py-2.5 font-medium text-white hover:bg-brand-fg">
                قبول الدعوة والانضمام
              </button>
            </form>
          </>
        )}

        <div className="mt-4 border-t border-neutral-100 pt-4 dark:border-neutral-800">
          <Link href="/app" className="text-sm text-brand hover:underline">
            العودة إلى منشآتي ←
          </Link>
        </div>
      </section>
    </div>
  );
}
