# Authorization model

Each user in `portal_users` has:

1. **Office scope** — `role` + `region_code` / `division_code` / `ccc_code` (which rows they see)
2. **Module permissions** — JSON `permissions` matrix:

```json
{
  "nsc": { "view": true, "upload": true, "edit": true },
  "disco": { "view": true, "upload": false, "edit": true },
  "grievance": { "view": true, "upload": true, "edit": false },
  "tech_works": { "view": false, "upload": false, "edit": false },
  "spot_billing": { "view": true, "upload": false, "edit": false },
  "bulk": { "view": true, "upload": true, "edit": true },
  "consumers": { "view": true, "upload": true, "edit": false },
  "atc": { "view": true, "upload": false, "edit": false }
}
```

| Action | Meaning |
|--------|---------|
| **View** | Open module / list / KPI / export CSV |
| **Upload** | Publish Excel/CSV into that database |
| **Edit** | Patch row status / remarks from UI |

`admin` always has full View+Upload+Edit on every module.

Manage under **Users & Auth** in the app. Supabase: run `supabase/sql/003_permissions.sql`.
