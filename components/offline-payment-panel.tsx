"use client";

import { useState } from "react";
import { halalasToSar } from "@/lib/money";
import { declareOfflinePayment, cancelOfflinePayment } from "@/app/app/subscription/actions";

type Plan = { code: string; name_ar: string; price_halalas: number };
type Bank = { bank_name?: string; bank_account_name?: string; bank_iban?: string; note?: string } | null;
type Pending = {
  plan_code?: string;
  amount_halalas?: number;
  method?: string;
  reference?: string;
  created_at?: string;
} | null;

const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-neutral-700";

const METHOD_AR: Record<string, string> = { bank_transfer: "تحويل بنكي", cash: "نقداً" };

function Row({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-neutral-500">{label}</span>
      <span dir={label === "الآيبان" ? "ltr" : undefined} className="select-all font-medium">{value}</span>
    </div>
  );
}

export function OfflinePaymentPanel({ plans, bank, pending }: { plans: Plan[]; bank: Bank; pending: Pending }) {
  const [method, setMethod] = useState("bank_transfer");
  const [plan, setPlan] = useState(plans[0]?.code ?? "");
  const hasBank = Boolean(bank?.bank_iban);

  // One open request at a time, enforced in SQL. Showing the form alongside a pending request would
  // invite a second submission that the database is going to refuse anyway.
  if (pending) {
    return (
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-900/20">
        <h2 className="font-semibold text-amber-900 dark:text-amber-200">طلب تحويل قيد المراجعة</h2>
        <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
          سجّلنا طلبك بمبلغ <span dir="ltr">{halalasToSar(Number(pending.amount_halalas ?? 0))}</span> ر.س
          {pending.method ? ` (${METHOD_AR[pending.method] ?? pending.method})` : ""}
          {pending.reference ? ` — المرجع ${pending.reference}` : ""}.
          يُفعَّل اشتراكك بعد تأكيد وصول المبلغ.
        </p>
        <form action={cancelOfflinePayment} className="mt-3">
          <button className="rounded-lg border border-amber-400 bg-white px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 dark:bg-neutral-900 dark:text-amber-200">
            إلغاء الطلب
          </button>
        </form>
      </div>
    );
  }

  return (
    <form
      action={declareOfflinePayment}
      className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <h2 className="mb-1 font-semibold">الدفع بتحويل بنكي أو نقداً</h2>
      <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
        حوّل المبلغ ثم سجّل التحويل هنا. يُفعَّل اشتراكك بعد تأكيد وصول المبلغ — عادةً خلال يوم عمل.
      </p>

      {hasBank ? (
        <div className="mb-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-800/50">
          <p className="mb-1 text-xs font-medium text-neutral-500">حوّل إلى</p>
          <Row label="البنك" value={bank?.bank_name} />
          <Row label="اسم الحساب" value={bank?.bank_account_name} />
          <Row label="الآيبان" value={bank?.bank_iban} />
          {bank?.note && <p className="mt-2 text-xs text-neutral-500">{bank.note}</p>}
        </div>
      ) : (
        <p className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          لم تُنشر بيانات الحساب البنكي بعد. تواصل معنا لإتمام التحويل.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="offline_plan">الخطة</label>
          <select id="offline_plan" name="plan" value={plan} onChange={(e) => setPlan(e.target.value)} className={inputCls}>
            {plans.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name_ar} — {halalasToSar(p.price_halalas)} ر.س/شهرياً
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="offline_method">طريقة الدفع</label>
          <select id="offline_method" name="method" value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls}>
            <option value="bank_transfer">تحويل بنكي</option>
            <option value="cash">نقداً</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium" htmlFor="reference">
            رقم العملية أو المرجع
            <span className="mr-1 font-normal text-neutral-400">
              {method === "cash" ? "(اسم المستلم أو رقم السند)" : "(يساعدنا على مطابقة الحوالة)"}
            </span>
          </label>
          <input id="reference" name="reference" className={inputCls} />
        </div>
      </div>

      <button className="mt-4 rounded-lg bg-brand px-4 py-2.5 font-medium text-white hover:bg-brand-fg">
        تسجيل التحويل
      </button>
      <p className="mt-2 text-xs text-neutral-500">
        تسجيل التحويل لا يفعّل الاشتراك بنفسه — نراجع وصول المبلغ أولاً.
      </p>
    </form>
  );
}
