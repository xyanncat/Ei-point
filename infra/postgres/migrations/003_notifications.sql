-- NOTIFY on new jobs/outbox so workers wake immediately; reconciliation covers misses (§5).
CREATE OR REPLACE FUNCTION ops.notify_work() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('ei_jobs', NEW.job_id::text);
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS jobs_notify ON ops.jobs;
CREATE TRIGGER jobs_notify AFTER INSERT ON ops.jobs
  FOR EACH ROW EXECUTE FUNCTION ops.notify_work();

CREATE OR REPLACE FUNCTION ops.notify_outbox() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('ei_outbox', NEW.event_id::text);
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS outbox_notify ON ops.outbox;
CREATE TRIGGER outbox_notify AFTER INSERT ON ops.outbox
  FOR EACH ROW EXECUTE FUNCTION ops.notify_outbox();
