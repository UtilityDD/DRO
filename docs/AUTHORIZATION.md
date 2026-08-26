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
| **Edit** | Patch planning fields (TAA, POs, parameters) from UI |

`admin` always has full View+Upload+Edit on every module.

**Tech Works** also has user-level rights:

- **Add new scheme** — admin, anyone with Tech Works **Edit**, or users ticked under Tech Works → Categories → “Who may add new schemes”
- **Update a work** — admin, Edit, scheme authors, or users assigned on that work (“Update authorised to”)
- Assigned users can also fill scheme details (TAA, value, POs) on works they are assigned to

Manage under **Users & Auth** in the app. On the Tech Works desk, admin can further authorize people to add schemes without giving them Edit on every module.

Manage under **Users & Auth** in the app. Supabase: run `supabase/sql/003_permissions.sql`. For the Tech Works desk also run `supabase/sql/018_tech_works.sql`.
