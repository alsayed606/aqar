// Tenant identity model tests (migration 0057): one primary identifier per entity type, a required
// establishment representative, grandfathering of pre-existing records, and the trade-name catalogue.
//
// Boots its own database on port 54353 and seeds only what it asserts on, the same way platform.mjs
// does — a fixture shared with the office suite would let an assertion pass by accident.
import { bootWithMigrations } from "./_pgutil.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  -> " + extra : "")); }
};

const { client, stop } = await bootWithMigrations(54353);
const q = (sql, params) => client.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

// Returns {ok:false, error} instead of throwing, so a rejection can be asserted on.
const attempt = async (sql, params) => {
  try { return { ok: true, rows: (await q(sql, params)).rows }; }
  catch (e) { return { ok: false, error: e.message }; }
};

async function asRole(sub, org, body) {
  await q("begin");
  try {
    await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub, role: "authenticated" })]);
    if (org) await q("select set_config('request.headers', $1, true)", [JSON.stringify({ "x-active-org": org })]);
    await q("set local role authenticated");
    const value = await body();
    await q("rollback");
    return { ok: true, value };
  } catch (e) {
    await q("rollback").catch(() => {});
    return { ok: false, error: e.message };
  }
}

const TENANT = "array['tenant']::app.party_role[]";
const mkParty = (org, cols, vals) =>
  attempt(`insert into app.party(org_id,display_name,roles,${cols}) values($1,'ت',${TENANT},${vals}) returning id, primary_id, identity_complete`, [org]);

try {
  // ---------------- Seed ----------------
  const org1 = (await one("insert into app.organization(name) values('مكتب أ') returning id")).id;
  const org2 = (await one("insert into app.organization(name) values('مكتب ب') returning id")).id;
  for (const o of [org1, org2])
    await q("insert into app.org_subscription(org_id,plan_code,status) values($1,'enterprise','comped')", [o]);

  const idA = (await one("insert into app.identity(phone_e164,phone_raw,full_name) values('+966500000701','+966500000701','عضو أ') returning id")).id;
  await q("insert into app.membership(identity_id,org_id,role,status,scope_all) values($1,$2,'owner','active',true)", [idA, org1]);

  // ==================== Individuals ====================
  const noId = await mkParty(org1, "entity_type", "'individual'");
  ok("individual with no identifier is refused", !noId.ok && /IDENTITY_INCOMPLETE/.test(noId.error || ""), noId.error);

  const nat = await mkParty(org1, "entity_type,national_id", "'individual','1011111110'");
  ok("individual with a national id is accepted", nat.ok, nat.error);
  ok("primary_id is the national id", nat.ok && nat.rows[0].primary_id === "1011111110");
  ok("identity_complete is true", nat.ok && nat.rows[0].identity_complete === true);

  const badNat = await mkParty(org1, "entity_type,national_id", "'individual','2011111110'");
  ok("a national id that does not start with 1 is refused",
    !badNat.ok && /INVALID_NATIONAL_ID/.test(badNat.error || ""), badNat.error);

  const iqama = await mkParty(org1, "entity_type,iqama_id", "'individual','2022222220'");
  ok("iqama is accepted and becomes the primary id", iqama.ok && iqama.rows[0].primary_id === "2022222220", iqama.error);

  const pass1 = await mkParty(org1, "entity_type,passport_no", "'individual','a1-234 567'");
  ok("passport is normalised to upper-case alphanumerics",
    pass1.ok && pass1.rows[0].primary_id === "A1234567", pass1.ok ? pass1.rows[0].primary_id : pass1.error);

  const both = await mkParty(org1, "entity_type,national_id,iqama_id", "'individual','1033333330','2033333330'");
  ok("two personal identifiers at once are refused",
    !both.ok && /party_one_personal_id/.test(both.error || ""), both.error);

  const spaced = await mkParty(org1, "entity_type,national_id", "'individual','1044 444-440'");
  ok("identifiers are stored digits-only so search matches either way",
    spaced.ok && spaced.rows[0].primary_id === "1044444440", spaced.ok ? spaced.rows[0].primary_id : spaced.error);

  // ==================== Establishments ====================
  const REP = "'خالد','1090909090','0500000801'";
  const noUnified = await mkParty(org1, "entity_type,rep_name,rep_id_number,rep_phone_raw", `'company',${REP}`);
  ok("company without a unified number is refused",
    !noUnified.ok && /IDENTITY_INCOMPLETE/.test(noUnified.error || ""), noUnified.error);

  const noRep = await mkParty(org1, "entity_type,unified_number", "'company','7001111110'");
  ok("company without a representative is refused",
    !noRep.ok && /IDENTITY_INCOMPLETE/.test(noRep.error || ""), noRep.error);

  const co = await mkParty(org1, "entity_type,unified_number,rep_name,rep_id_number,rep_phone_raw", `'company','7001111110',${REP}`);
  ok("complete company is accepted", co.ok, co.error);
  ok("primary_id of a company is its unified number", co.ok && co.rows[0].primary_id === "7001111110");
  ok("representative phone is normalised to E.164",
    co.ok && (await one("select rep_phone_e164 p from app.party where id=$1", [co.rows[0].id])).p === "+966500000801");

  const badUnified = await mkParty(org1, "entity_type,unified_number,rep_name,rep_id_number,rep_phone_raw", `'company','8001111110',${REP}`);
  ok("a unified number that does not start with 7 is refused",
    !badUnified.ok && /INVALID_UNIFIED_NUMBER/.test(badUnified.error || ""), badUnified.error);

  const badCr = await mkParty(org1, "entity_type,unified_number,cr_number,rep_name,rep_id_number,rep_phone_raw", `'company','7002222220','101010',${REP}`);
  ok("a commercial registration that is not 10 digits is refused",
    !badCr.ok && /INVALID_CR_NUMBER/.test(badCr.error || ""), badCr.error);

  const badVat = await mkParty(org1, "entity_type,unified_number,vat_number,rep_name,rep_id_number,rep_phone_raw", `'company','7003333330','300123',${REP}`);
  ok("a VAT number that is not 15 digits between 3s is refused",
    !badVat.ok && /INVALID_VAT_NUMBER/.test(badVat.error || ""), badVat.error);

  const exempt = await mkParty(org1, "entity_type,id_exempt_reason", "'company','جهة حكومية بلا رقم موحّد'");
  ok("an explicit exemption reason waives the requirement", exempt.ok && exempt.rows[0].identity_complete === true, exempt.error);

  // ==================== De-duplication ====================
  const dupSame = await mkParty(org1, "entity_type,national_id", "'individual','1011111110'");
  ok("the same identifier twice in one office is refused",
    !dupSame.ok && /DUPLICATE_IDENTIFIER/.test(dupSame.error || ""), dupSame.error);

  const dupOther = await mkParty(org2, "entity_type,national_id", "'individual','1011111110'");
  ok("the same identifier in a DIFFERENT office is allowed (offices are isolated)", dupOther.ok, dupOther.error);

  await q("update app.party set deleted_at = now() where id=$1", [dupOther.rows[0].id]);
  const reuseAfterDelete = await mkParty(org2, "entity_type,national_id", "'individual','1011111110'");
  ok("an identifier freed by a soft-delete can be reused", reuseAfterDelete.ok, reuseAfterDelete.error);

  // ==================== Grandfathering ====================
  // Pre-0057 rows are simulated by inserting with the rule trigger off — that is the only way a row
  // can be incomplete once the migration is in place.
  await q("alter table app.party disable trigger party_identity_rules");
  const legacy = (await one(`insert into app.party(org_id,display_name,roles,entity_type) values($1,'قديم',${TENANT},'individual') returning id`, [org1])).id;
  await q("alter table app.party enable trigger party_identity_rules");

  ok("a legacy row is flagged incomplete",
    (await one("select identity_complete c from app.party where id=$1", [legacy])).c === false);

  const editLegacy = await attempt("update app.party set phone_raw='0500000900', phone_e164='+966500000900' where id=$1", [legacy]);
  ok("a legacy incomplete row stays editable", editLegacy.ok, editLegacy.error);

  const emptyOut = await attempt("update app.party set national_id=null where id=$1", [nat.rows[0].id]);
  ok("a complete record cannot be emptied back out",
    !emptyOut.ok && /IDENTITY_INCOMPLETE/.test(emptyOut.error || ""), emptyOut.error);

  const completeLegacy = await attempt("update app.party set national_id='1055555551' where id=$1", [legacy]);
  ok("a legacy row can be completed", completeLegacy.ok, completeLegacy.error);

  // ==================== tenant_type / tenant_kind mirrors ====================
  const tCo = await one("insert into app.tenant(org_id,party_id) values($1,$2) returning id, tenant_type, tenant_kind", [org1, co.rows[0].id]);
  ok("tenant_type mirrors party.entity_type on insert", tCo.tenant_type === "company" && tCo.tenant_kind === "company", JSON.stringify(tCo));

  await q("update app.party set entity_type='sole_establishment' where id=$1", [co.rows[0].id]);
  const mirrored = await one("select tenant_type, tenant_kind from app.tenant where id=$1", [tCo.id]);
  ok("changing party.entity_type propagates to the tenant mirror",
    mirrored.tenant_type === "sole_establishment" && mirrored.tenant_kind === "individual", JSON.stringify(mirrored));

  // ==================== One person, several commercial registrations ====================
  const co2 = await mkParty(org1, "entity_type,unified_number,rep_name,rep_id_number,rep_phone_raw", `'company','7004444440',${REP}`);
  ok("a second establishment for the same representative is allowed", co2.ok, co2.error);
  const repCount = await one("select count(*)::int n from app.party where org_id=$1 and rep_id_number='1090909090' and deleted_at is null", [org1]);
  ok("establishments are findable by their representative's id", repCount.n === 2, JSON.stringify(repCount));

  // ==================== Trade-name catalogue ====================
  const coId = co.rows[0].id;
  const b1 = await attempt("insert into app.trade_name(org_id,party_id,name,municipal_license_no) values($1,$2,'مخابز الريان','40010001') returning id", [org1, coId]);
  const b2 = await attempt("insert into app.trade_name(org_id,party_id,name) values($1,$2,'سوبر ماركت الريان') returning id", [org1, coId]);
  ok("one registration can run several brand names", b1.ok && b2.ok, b1.error || b2.error);

  const dupBrand = await attempt("insert into app.trade_name(org_id,party_id,name) values($1,$2,'مخابز الريان')", [org1, coId]);
  ok("the same brand name twice for one party is refused", !dupBrand.ok, "insert unexpectedly succeeded");

  const sameNameOtherParty = await attempt("insert into app.trade_name(org_id,party_id,name) values($1,$2,'مخابز الريان')", [org1, co2.rows[0].id]);
  ok("the same brand name under a different party is allowed", sameNameOtherParty.ok, sameNameOtherParty.error);

  const selfParty = (await one("insert into app.party(org_id,display_name,roles) values($1,'مكتب أ',array['owner']::app.party_role[]) returning id", [org1])).id;
  const own1 = (await one("insert into app.owner(org_id,party_id,is_self) values($1,$2,true) returning id", [org1, selfParty])).id;
  const prop1 = (await one("insert into app.property(org_id,owner_id,name) values($1,$2,'مجمّع') returning id", [org1, own1])).id;
  const unit1 = (await one("insert into app.unit(org_id,property_id,unit_number,current_status) values($1,$2,'C1','vacant') returning id", [org1, prop1])).id;
  const ct = (await one(
    `insert into app.contract(org_id,property_id,unit_id,tenant_id,contract_number,contract_kind,status,start_date,end_date,annual_rent_halalas,payment_frequency,trade_name,trade_name_id)
     values($1,$2,$3,$4,'CT-B1','commercial','draft','2026-01-01','2026-12-31',2400000,'quarterly','مخابز الريان',$5) returning id`,
    [org1, prop1, unit1, tCo.id, b1.rows[0].id])).id;
  ok("a contract records which catalogue entry its trade name came from",
    (await one("select trade_name_id t from app.contract where id=$1", [ct])).t === b1.rows[0].id);

  await q("update app.contract set status='active', activated_at=now() where id=$1", [ct]);
  const retag = await attempt("update app.contract set trade_name_id=$1 where id=$2", [b2.rows[0].id, ct]);
  ok("trade_name_id stays correctable on an ACTIVE contract (outside the frozen set)", retag.ok, retag.error);

  const freeze = await attempt("update app.contract set annual_rent_halalas=1 where id=$1", [ct]);
  ok("the frozen financial fields are still immutable on an active contract",
    !freeze.ok && /CONTRACT_IMMUTABLE/.test(freeze.error || ""), freeze.error);

  // ==================== RLS on the new table ====================
  const mine = await asRole(idA, org1, () => client.query("select count(*)::int n from app.trade_name"));
  ok("a member reads their own office's brand names", mine.ok && mine.value.rows[0].n === 3, mine.error);

  const theirs = await asRole(idA, org2, () => client.query("select count(*)::int n from app.trade_name"));
  ok("brand names of another office are invisible", theirs.ok && theirs.value.rows[0].n === 0, theirs.error);

  // ==================== Tenants importer (0058) ====================
  // The importer is the second write path into app.party. If it does not enforce the same rules,
  // a sheet becomes a way around them — and an incomplete row would abort the whole commit.
  const runBatch = async (rows) => {
    const batch = (await one("insert into app.import_batch(org_id,kind,status,source_filename) values($1,'tenants','draft','t.xlsx') returning id", [org1])).id;
    let i = 0;
    for (const raw of rows)
      await q("insert into app.import_row(batch_id,org_id,row_number,raw) values($1,$2,$3,$4)", [batch, org1, ++i, JSON.stringify(raw)]);
    await q("select app.import_validate($1)", [batch]);
    return batch;
  };
  const rowsOf = (batch) => q("select row_number, is_valid, errors from app.import_row where batch_id=$1 order by row_number", [batch]).then((r) => r.rows);

  const bMissing = await runBatch([{ "الاسم": "بدون هوية", "النوع": "فرد" }]);
  const rMissing = (await rowsOf(bMissing))[0];
  ok("import: an individual with no identifier is reported, not committed",
    rMissing.is_valid === false && JSON.stringify(rMissing.errors).includes("رقم الهوية"), JSON.stringify(rMissing.errors));

  const bCo = await runBatch([
    { "الاسم": "مؤسسة النور", "النوع": "مؤسسة فردية", "الرقم الموحد": "7005555550" },
    { "الاسم": "شركة الأمل", "النوع": "شركة", "الرقم الموحد": "7006666660",
      "اسم الممثل": "منى", "رقم هوية الممثل": "1088888880", "جوال الممثل": "0500000803" },
  ]);
  const rCo = await rowsOf(bCo);
  ok("import: an establishment without a representative is reported",
    rCo[0].is_valid === false && JSON.stringify(rCo[0].errors).includes("اسم الممثل"), JSON.stringify(rCo[0].errors));
  ok("import: a complete establishment row validates", rCo[1].is_valid === true, JSON.stringify(rCo[1].errors));

  await q("select app.import_commit($1)", [bCo]);
  const imported = await one(
    "select entity_type, unified_number, rep_name, rep_phone_e164, primary_id from app.party where org_id=$1 and display_name='شركة الأمل'", [org1]);
  ok("import: the committed party carries type, unified number and representative",
    imported.entity_type === "company" && imported.unified_number === "7006666660" &&
    imported.rep_name === "منى" && imported.rep_phone_e164 === "+966500000803" &&
    imported.primary_id === "7006666660", JSON.stringify(imported));
  ok("import: only the valid row was committed",
    (await one("select count(*)::int n from app.party where org_id=$1 and display_name='مؤسسة النور'", [org1])).n === 0);
  ok("import: the tenant mirror follows the imported type",
    (await one("select t.tenant_type tt from app.tenant t join app.party p on p.id=t.party_id where p.display_name='شركة الأمل'")).tt === "company");

  const bDup = await runBatch([
    { "الاسم": "نسخة", "النوع": "شركة", "الرقم الموحد": "7006666660",
      "اسم الممثل": "منى", "رقم هوية الممثل": "1088888880", "جوال الممثل": "0500000803" },
    { "الاسم": "أ", "النوع": "فرد", "رقم الهوية": "1099999990" },
    { "الاسم": "ب", "النوع": "فرد", "رقم الهوية": "1099999990" },
  ]);
  const rDup = await rowsOf(bDup);
  ok("import: an identifier already in the platform is refused",
    rDup[0].is_valid === false && JSON.stringify(rDup[0].errors).includes("المنصة"), JSON.stringify(rDup[0].errors));
  ok("import: the first of two identical rows is accepted", rDup[1].is_valid === true, JSON.stringify(rDup[1].errors));
  ok("import: a duplicate WITHIN the file is refused",
    rDup[2].is_valid === false && JSON.stringify(rDup[2].errors).includes("مكرّر"), JSON.stringify(rDup[2].errors));

  const bFmt = await runBatch([{ "الاسم": "خطأ", "النوع": "فرد", "رقم الهوية": "2011111119" }]);
  ok("import: a malformed national id is reported per field",
    JSON.stringify((await rowsOf(bFmt))[0].errors).includes("تبدأ بـ 1"), JSON.stringify((await rowsOf(bFmt))[0].errors));

  const bIqama = await runBatch([{ "الاسم": "مقيم", "النوع": "فرد", "رقم الإقامة": "2044 444-449" }]);
  const bPass = await runBatch([{ "الاسم": "زائر", "النوع": "فرد", "رقم الجواز": "b9-88 777" }]);
  await q("select app.import_commit($1)", [bIqama]);
  await q("select app.import_commit($1)", [bPass]);
  ok("import: iqama is normalised to digits",
    (await one("select primary_id p from app.party where display_name='مقيم'")).p === "2044444449");
  ok("import: passport is normalised to upper-case alphanumerics",
    (await one("select primary_id p from app.party where display_name='زائر'")).p === "B988777");

  console.log(`\nIdentity: ${pass} passed, ${fail} failed`);
} catch (e) {
  fail++;
  console.error("FATAL", e);
} finally {
  await stop();
}
// exitCode rather than exit(): process.exit() can truncate a piped stdout before it is flushed.
process.exitCode = fail === 0 ? 0 : 1;
