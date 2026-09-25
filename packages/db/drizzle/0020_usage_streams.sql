-- Usage rows use a deterministic id per organization/project/metric/month;
-- this index makes the read path predictable while the id remains the atomic claim key.
CREATE INDEX "usage_records_project_metric_period_idx" ON "usage_records" USING btree ("project_id", "metric", "period_start");
