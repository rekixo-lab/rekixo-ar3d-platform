-- Additive private metadata only. No existing plot, project, price, or snapshot is rewritten.
-- Deploy this migration before the worker; old workers safely ignore the new table.
CREATE TABLE IF NOT EXISTS plot_admin_details (
  project_id TEXT NOT NULL,
  plot_id TEXT NOT NULL,
  owner_name TEXT,
  booking_amount_paise INTEGER,
  currency TEXT NOT NULL DEFAULT 'INR',
  broker_name TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY (project_id, plot_id),
  FOREIGN KEY (project_id, plot_id) REFERENCES plots(project_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT plot_admin_details_owner_length CHECK (owner_name IS NULL OR length(owner_name) <= 120),
  CONSTRAINT plot_admin_details_broker_length CHECK (broker_name IS NULL OR length(broker_name) <= 120),
  CONSTRAINT plot_admin_details_amount_bounds CHECK (
    booking_amount_paise IS NULL OR
    (typeof(booking_amount_paise) = 'integer' AND booking_amount_paise BETWEEN 0 AND 1000000000000)
  ),
  CONSTRAINT plot_admin_details_currency_inr CHECK (currency = 'INR'),
  CONSTRAINT plot_admin_details_revision_positive CHECK (
    typeof(revision) = 'integer' AND revision BETWEEN 1 AND 9007199254740991
  )
);
