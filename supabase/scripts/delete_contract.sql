-- ===========================================================================
-- حذف نهائي (hard delete) لعقد وكل ما تفرّع عنه — لتصحيح إدخال خاطئ.
--
-- الاستعمال: عدّل :contract_number و :org_number أدناه ثم شغّل الملف كاملاً.
-- كل شيء داخل معاملة واحدة؛ في النهاية ROLLBACK افتراضياً — راجع التقرير
-- الذي يطبعه السكربت، وإذا كانت الأرقام صحيحة بدّل ROLLBACK إلى COMMIT.
--
-- ملاحظة: app.audit_log مانع للحذف بـ trigger (append-only بالتصميم)، فسجل
-- التدقيق يبقى كما هو ولا يُلمس. هذا مقصود ومطلوب نظاميًا.
-- ===========================================================================

begin;

do $$
declare
  v_contract_number text := 'CT-2026-00001';   -- ← رقم العقد المطلوب حذفه
  v_org            uuid;
  v_contract       uuid;
  v_charges        uuid[];
  v_invoices       uuid[];
  v_payments       uuid[];
  n_notif    int := 0; n_doc     int := 0; n_line   int := 0;
  n_inv      int := 0; n_alloc   int := 0; n_pay    int := 0;
  n_amend    int := 0; n_charge  int := 0; n_renew  int := 0;
begin
  -- 1) تحديد العقد. لو تكرر الرقم عبر أكثر من منظمة نتوقف بدل التخمين.
  select c.id, c.org_id into v_contract, v_org
    from app.contract c
   where c.contract_number = v_contract_number;

  if not found then
    raise exception 'لا يوجد عقد بالرقم %', v_contract_number;
  end if;

  if (select count(*) from app.contract where contract_number = v_contract_number) > 1 then
    raise exception 'الرقم % مكرر في أكثر من منظمة — حدّد org_id يدوياً', v_contract_number;
  end if;

  -- 2) جمع المعرّفات التابعة قبل الحذف.
  select coalesce(array_agg(id), '{}') into v_charges
    from app.charge where contract_id = v_contract;

  select coalesce(array_agg(id), '{}') into v_invoices
    from app.invoice where contract_id = v_contract;

  -- الدفعات التي كل تخصيصاتها تخص هذا العقد فقط → تُحذف معه.
  -- الدفعة المشتركة مع عقد آخر تبقى، ويُحذف تخصيصها فقط.
  select coalesce(array_agg(p.id), '{}') into v_payments
    from app.payment p
   where exists (select 1 from app.payment_allocation a
                  where a.payment_id = p.id and a.charge_id = any(v_charges))
     and not exists (select 1 from app.payment_allocation a
                      where a.payment_id = p.id and not (a.charge_id = any(v_charges)));

  -- 3) الإشعارات (مرجع متعدد الأنواع، بلا مفتاح أجنبي).
  delete from app.notification
   where (entity_type = 'contract' and entity_id = v_contract)
      or (entity_type = 'charge'   and entity_id = any(v_charges));
  get diagnostics n_notif = row_count;   -- notification_delivery يسقط بالـ cascade

  -- 4) المستندات (مرجع متعدد الأنواع أيضاً).
  --    الملفات في Supabase Storage تُحذف بشكل منفصل — انظر ملاحظة الأسفل.
  delete from app.document
   where (entity_type = 'contract' and entity_id = v_contract)
      or (entity_type = 'charge'   and entity_id = any(v_charges))
      or (entity_type = 'payment'  and entity_id = any(v_payments));
  get diagnostics n_doc = row_count;

  -- 5) الفواتير الضريبية وبنودها (invoice.contract_id = on delete set null،
  --    فلا تسقط تلقائياً — نحذفها صراحة).
  delete from app.invoice_line where invoice_id = any(v_invoices);
  get diagnostics n_line = row_count;

  update app.invoice set ref_invoice_id = null
   where ref_invoice_id = any(v_invoices) and not (id = any(v_invoices));

  delete from app.invoice where id = any(v_invoices);
  get diagnostics n_inv = row_count;

  -- 6) تخصيصات الدفعات ثم الدفعات الخاصة بهذا العقد وحده.
  delete from app.payment_allocation where charge_id = any(v_charges);
  get diagnostics n_alloc = row_count;

  delete from app.payment where id = any(v_payments);
  get diagnostics n_pay = row_count;

  -- 7) فك ارتباط أي عقد تجديد يشير لهذا العقد (وإلا منعنا FK من الحذف).
  update app.contract set renewed_from_contract_id = null
   where renewed_from_contract_id = v_contract;
  get diagnostics n_renew = row_count;

  -- 8) الملاحق والمطالبات — تسقط بالـ cascade، لكن نحذفها صراحة للعدّ.
  delete from app.contract_amendment where contract_id = v_contract;
  get diagnostics n_amend = row_count;

  delete from app.charge where contract_id = v_contract;
  get diagnostics n_charge = row_count;

  -- 9) العقد نفسه.
  delete from app.contract where id = v_contract;

  raise notice E'\n=== حُذف العقد % (org %) ===', v_contract_number, v_org;
  raise notice 'contract_id       : %', v_contract;
  raise notice 'إشعارات           : %', n_notif;
  raise notice 'مستندات           : %', n_doc;
  raise notice 'بنود فواتير       : %', n_line;
  raise notice 'فواتير            : %', n_inv;
  raise notice 'تخصيصات دفعات     : %', n_alloc;
  raise notice 'دفعات             : %', n_pay;
  raise notice 'عقود تجديد فُكّت  : %', n_renew;
  raise notice 'ملاحق             : %', n_amend;
  raise notice 'مطالبات           : %', n_charge;
  raise notice 'مسارات ملفات Storage تحتاج حذفاً يدوياً — نفّذ الاستعلام قبل COMMIT.';
end $$;

-- راجِع الأرقام أعلاه. إن كانت صحيحة بدّل السطر التالي إلى: commit;
rollback;
