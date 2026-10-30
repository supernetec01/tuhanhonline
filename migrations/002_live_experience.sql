CREATE TABLE effect_jobs(
 id uuid PRIMARY KEY, event_id uuid UNIQUE REFERENCES live_events(id), kind text NOT NULL CHECK(kind IN ('lotus','lantern','incense')),
 name text NOT NULL, show_name boolean NOT NULL, duration_ms integer NOT NULL CHECK(duration_ms BETWEEN 2000 AND 8000),
 status text NOT NULL CHECK(status IN ('QUEUED','RUNNING','COMPLETED','SKIPPED')), created_at timestamptz NOT NULL DEFAULT now(),
 starts_at timestamptz, ends_at timestamptz
);
CREATE UNIQUE INDEX one_visual_effect ON effect_jobs((1)) WHERE status='RUNNING';
CREATE TABLE ceremony_runs(id uuid PRIMARY KEY, source text NOT NULL CHECK(source IN ('manual','scheduled')),
 scheduled_at timestamptz UNIQUE NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 status text NOT NULL CHECK(status IN ('RUNNING','COMPLETED')), created_by uuid REFERENCES users(id));
CREATE UNIQUE INDEX one_ceremony ON ceremony_runs((1)) WHERE status='RUNNING';
CREATE TABLE ceremony_clock(id integer PRIMARY KEY CHECK(id=1), next_at timestamptz, config_version bigint);
INSERT INTO ceremony_clock(id) VALUES(1);
ALTER TABLE tts_jobs ADD COLUMN voice text NOT NULL DEFAULT 'coral';
