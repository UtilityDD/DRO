# DRO Ops notes

## Free database

Use **Supabase Postgres free tier** for production. Local JSON under `server/data` is the default for development and demos.

## Consumer master (~5 lakh)

Keep columns lean: `consumer_id`, `name`, `ccc_code`, `division_code`, `consumer_class`, `status`, `meter_no`, `address`. Upload via Upload Center in chunks of 500.

## SS mapping

Substation (`ss`) office_type is supported in schema; import when SS↔CCC map is provided.
