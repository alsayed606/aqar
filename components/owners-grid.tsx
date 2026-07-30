"use client";

import { useState } from "react";
import { OwnerCard, ownerBucket, type OwnerCardData, type OwnerBucket } from "@/components/owner-card";
import { FilterableCards } from "@/components/filterable-list";
import { StatusTabs, type StatusTab } from "@/components/status-tabs";

const TABS: StatusTab<OwnerBucket>[] = [
  { id: "all", label: "الكل" },
  { id: "individual", label: "أفراد" },
  { id: "company", label: "شركات" },
  { id: "self", label: "المنشأة" },
];

export function OwnersGrid({ owners }: { owners: OwnerCardData[] }) {
  const [tab, setTab] = useState<OwnerBucket | "all">("all");

  const counts = owners.reduce<Record<string, number>>((acc, owner) => {
    const bucket = ownerBucket(owner);
    acc[bucket] = (acc[bucket] ?? 0) + 1;
    return acc;
  }, {});

  const shown = tab === "all" ? owners : owners.filter((o) => ownerBucket(o) === tab);

  return (
    <div className="space-y-3">
      <StatusTabs tabs={TABS} active={tab} counts={counts} total={owners.length} onSelect={setTab} />

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-400 dark:border-slate-700">
          لا يوجد ملّاك في هذا التصنيف.
        </p>
      ) : (
        <FilterableCards
          className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
          placeholder="تصفية الملّاك… (الاسم أو الهوية أو الجوال)"
          items={shown.map((owner) => ({
            id: owner.id,
            search: [owner.is_self ? "المنشأة مالك ذاتي" : owner.display_name, owner.national_id, owner.phone_e164, owner.bank_name]
              .filter(Boolean)
              .join(" "),
            node: <OwnerCard owner={owner} />,
          }))}
        />
      )}
    </div>
  );
}
