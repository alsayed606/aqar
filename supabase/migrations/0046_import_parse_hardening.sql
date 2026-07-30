-- 0046_import_parse_hardening.sql
-- One malformed cell used to abort the whole import batch.
--
-- app.normalize_date leans on to_date(), which raises (22008) when a field is out of range. A
-- sheet written year-day-month normalizes to '2026/16/06' — month 16. app.import_validate
-- already has a per-row error path for an unparseable date, but the exception escaped the loop
-- before that path could run, so every other row in the file lost its validation too and the
-- caller saw a raw Postgres message with no row number.
--
-- Same shape in app.normalize_amount_halalas: the regexp strip keeps '-' and '.' wherever they
-- appear, so '1.2.3' and '5-3' still reach ::numeric and raise 22P02.
--
-- Both now return null on unparseable input, which is what every caller already treats as
-- "invalid — tell the user which field". Input that parsed before is unaffected.

create or replace function app.normalize_amount_halalas(p_input text) returns bigint
language plpgsql immutable as $$
declare
  s text;
begin
  if p_input is null then
    return null;
  end if;

  s := app.fold_digits(p_input);
  s := replace(s, '٫', '.');                    -- Arabic decimal separator
  s := regexp_replace(s, '[^0-9.\-]', '', 'g'); -- drop currency, commas, spaces
  -- 'ر.س' and 'د.إ' carry a dot, so the strip above leaves one stuck to the number ('1200.50.').
  -- Only a dot between digits can be a decimal separator; an edge dot is always leftover symbol.
  -- Dots in the middle are left alone so '1.2.3' stays ambiguous and is rejected below.
  s := regexp_replace(s, '^\.+|\.+$', '', 'g');

  if s = '' or s = '-' then
    return null;
  end if;

  -- The strip above cannot tell '1.234' from '1.2.3', and the halalas multiply can overflow
  -- bigint on a nonsense figure. Both are caller input, so neither may raise.
  begin
    return round(s::numeric * 100)::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    return null;
  end;
end;
$$;

create or replace function app.normalize_date(p_input text) returns date
language plpgsql immutable as $$
declare
  s text;
begin
  if p_input is null then
    return null;
  end if;

  s := trim(app.fold_digits(p_input));
  s := replace(replace(s, '.', '/'), '\', '/');
  s := replace(s, '-', '/');

  -- Matching the shape does not make the values valid: to_date() raises on month 16, day 32, or
  -- 30 February. Year-day-month sheets ('2026-16-06') are the common case in the field.
  begin
    if s ~ '^\d{4}/\d{1,2}/\d{1,2}$' then
      return to_date(s, 'YYYY/MM/DD');
    elsif s ~ '^\d{1,2}/\d{1,2}/\d{4}$' then
      return to_date(s, 'DD/MM/YYYY');
    end if;
  exception when datetime_field_overflow or invalid_datetime_format then
    return null;
  end;

  return null;
end;
$$;
