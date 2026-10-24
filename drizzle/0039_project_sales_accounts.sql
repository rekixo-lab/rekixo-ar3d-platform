-- Phase 1: project-isolated optional sales ledger, strictly additive.
-- No backfill: historic "booking amount" is not a payment receipt.
CREATE TABLE IF NOT EXISTS sales_customers (
 project_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, mobile TEXT,
 address TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(project_id,id),
 FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT,
 CHECK(length(trim(name)) BETWEEN 2 AND 120),
 CHECK(mobile IS NULL OR length(mobile) <= 20),
 CHECK(address IS NULL OR length(address) <= 600)
);
CREATE INDEX IF NOT EXISTS idx_sales_customers_project_name ON sales_customers(project_id,name);
CREATE TABLE IF NOT EXISTS property_sales (
 project_id TEXT NOT NULL, id TEXT NOT NULL, plot_id TEXT NOT NULL, customer_id TEXT NOT NULL,
 agreement_paise INTEGER NOT NULL, sale_date TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'active',
 created_by TEXT NOT NULL, created_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(project_id,id),
 FOREIGN KEY(project_id,plot_id) REFERENCES plots(project_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY(project_id,customer_id) REFERENCES sales_customers(project_id,id) ON DELETE RESTRICT,
 CHECK(typeof(agreement_paise)='integer' AND agreement_paise BETWEEN 1 AND 100000000000000),
 CHECK(state IN ('active','void')), CHECK(length(sale_date)=10)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_property_sales_active_plot ON property_sales(project_id,plot_id) WHERE state='active';
CREATE INDEX IF NOT EXISTS idx_property_sales_project_date ON property_sales(project_id,sale_date);
CREATE TABLE IF NOT EXISTS sales_payments (
 project_id TEXT NOT NULL, id TEXT NOT NULL, sale_id TEXT NOT NULL,
 kind TEXT NOT NULL, amount_paise INTEGER NOT NULL, paid_on TEXT NOT NULL,
 payment_method TEXT NOT NULL, reference TEXT, note TEXT, reversed_payment_id TEXT,
 idempotency_key TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(project_id,id),
 UNIQUE(project_id,idempotency_key),
 FOREIGN KEY(project_id,sale_id) REFERENCES property_sales(project_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(project_id,reversed_payment_id) REFERENCES sales_payments(project_id,id) ON DELETE RESTRICT,
 CHECK(kind IN ('receipt','reversal')),
 CHECK(typeof(amount_paise)='integer' AND amount_paise BETWEEN 1 AND 100000000000000),
 CHECK(payment_method IN ('cash','bank','upi','cheque','other')),
 CHECK(length(paid_on)=10),
 CHECK(reference IS NULL OR length(reference)<=100),
 CHECK(note IS NULL OR length(note)<=400),
 CHECK((kind='receipt' AND reversed_payment_id IS NULL) OR
       (kind='reversal' AND reversed_payment_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_one_reversal_per_receipt ON sales_payments(project_id,reversed_payment_id) WHERE reversed_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_payments_sale_date ON sales_payments(project_id,sale_id,paid_on);
CREATE TABLE IF NOT EXISTS sales_adjustments (
 project_id TEXT NOT NULL, id TEXT NOT NULL, sale_id TEXT NOT NULL,
 kind TEXT NOT NULL, amount_paise INTEGER NOT NULL, note TEXT NOT NULL,
 created_by TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(project_id,id),
 FOREIGN KEY(project_id,sale_id) REFERENCES property_sales(project_id,id) ON DELETE RESTRICT,
 CHECK(kind IN ('discount','charge')),
 CHECK(typeof(amount_paise)='integer' AND amount_paise BETWEEN 1 AND 100000000000000),
 CHECK(length(trim(note)) BETWEEN 3 AND 400)
);
CREATE INDEX IF NOT EXISTS idx_sales_adjustments_sale ON sales_adjustments(project_id,sale_id);
CREATE TABLE IF NOT EXISTS sales_installments (
 project_id TEXT NOT NULL, id TEXT NOT NULL, sale_id TEXT NOT NULL,
 due_on TEXT NOT NULL, amount_paise INTEGER NOT NULL, note TEXT,
 created_by TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(project_id,id),
 FOREIGN KEY(project_id,sale_id) REFERENCES property_sales(project_id,id) ON DELETE RESTRICT,
 CHECK(length(due_on)=10),
 CHECK(typeof(amount_paise)='integer' AND amount_paise BETWEEN 1 AND 100000000000000),
 CHECK(note IS NULL OR length(note)<=400)
);
CREATE INDEX IF NOT EXISTS idx_sales_installments_due ON sales_installments(project_id,due_on);
CREATE TABLE IF NOT EXISTS sale_documents (
 project_id TEXT NOT NULL, id TEXT NOT NULL, sale_id TEXT NOT NULL,
 kind TEXT NOT NULL, file_name TEXT NOT NULL, content_type TEXT NOT NULL,
 size_bytes INTEGER NOT NULL, object_key TEXT NOT NULL, sha256 TEXT NOT NULL,
 uploaded_by TEXT NOT NULL, uploaded_at TEXT NOT NULL,
 PRIMARY KEY(project_id,id), UNIQUE(object_key),
 FOREIGN KEY(project_id,sale_id) REFERENCES property_sales(project_id,id) ON DELETE RESTRICT,
 CHECK(kind IN ('agreement','receipt','other')),
 CHECK(length(file_name) BETWEEN 1 AND 160),
 CHECK(content_type IN ('application/pdf','image/png','image/jpeg')),
 CHECK(size_bytes BETWEEN 1 AND 8388608),
 CHECK(length(sha256)=64)
);
CREATE INDEX IF NOT EXISTS idx_sale_documents_sale ON sale_documents(project_id,sale_id);
CREATE TABLE IF NOT EXISTS sales_permissions (
 project_id TEXT NOT NULL, user_id TEXT NOT NULL, level TEXT NOT NULL,
 granted_by TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(project_id,user_id),
 FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT,
 FOREIGN KEY(user_id) REFERENCES admin_users(id) ON DELETE RESTRICT,
 CHECK(level IN ('viewer','editor','approver'))
);
CREATE INDEX IF NOT EXISTS idx_sales_permissions_user ON sales_permissions(user_id,project_id);
-- A sale with financial entries is never silently deleted by inventory reconciliation.
-- Existing plots table is not changed, and no published customer tables are touched.
