CREATE TABLE media_assets(id uuid PRIMARY KEY,kind text NOT NULL CHECK(kind IN ('voice','sfx','music')),title text NOT NULL,file_name text NOT NULL,mime text NOT NULL,duration_ms integer NOT NULL CHECK(duration_ms>0),sha256 text NOT NULL,created_by uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),CHECK(kind<>'voice' OR duration_ms<=10000));
ALTER TABLE tts_jobs ADD COLUMN asset_id uuid REFERENCES media_assets(id);
CREATE INDEX coin_daily_rewards ON coin_ledger(user_id,created_at) WHERE source LIKE 'minute:%';
CREATE FUNCTION immutable_economy_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Economy ledgers are append-only'; END $$;
CREATE TRIGGER coin_ledger_immutable BEFORE UPDATE OR DELETE ON coin_ledger FOR EACH ROW EXECUTE FUNCTION immutable_economy_ledger();
CREATE TRIGGER merit_ledger_immutable BEFORE UPDATE OR DELETE ON merit_transactions FOR EACH ROW EXECUTE FUNCTION immutable_economy_ledger();
