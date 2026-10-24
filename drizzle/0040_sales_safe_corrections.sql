-- Private accounting correction metadata only. Additive; no historical row changes.
ALTER TABLE sales_installments ADD COLUMN cancelled_at TEXT;
ALTER TABLE sales_installments ADD COLUMN cancelled_by TEXT;
ALTER TABLE sales_installments ADD COLUMN cancellation_reason TEXT;
ALTER TABLE sale_documents ADD COLUMN archived_at TEXT;
ALTER TABLE sale_documents ADD COLUMN archived_by TEXT;
ALTER TABLE sale_documents ADD COLUMN archive_reason TEXT;
ALTER TABLE sales_adjustments ADD COLUMN reverses_adjustment_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_adjustment_one_undo
 ON sales_adjustments(project_id,reverses_adjustment_id)
 WHERE reverses_adjustment_id IS NOT NULL;
