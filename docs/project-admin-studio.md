# Project Admin Studio (project-safe)

- The migration is additive and creates only new private tables, then enables only verified Metro City (project ID AND slug AND name guard).
- Does not mutate any current inventory, plot polygons, status, prices, bookings, financial records or public snapshots.
- Deal Progress never updates canonical Available / Booked / Sold. Token Received is NOT an actual payment. Sales & Accounts records remain authoritative.
- Registered requires an active Sale and Sold plot status.
- Super Admin controls stage/field configuration and per-project module flags. Client Admin can update only own project's current active plots, subject to optimistic concurrency.
- Custom fields: text, number, date, select and checkbox; user-provided scripts/HTML are not supported.
- Workflow history and old stage/field definitions survive disable. Hold date only displays overdue status; no automatic booking release or notifications.
- Deploy uses standard D1 migration and existing full regression pipeline. All other projects start with both modules disabled.
- Roll back the UI by disabling features in the Super Admin Admin Studio (preserves project data). No deletion of new D1 tables is needed.
