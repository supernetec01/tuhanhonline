ALTER TABLE users ADD COLUMN merit integer NOT NULL DEFAULT 0 CHECK(merit>=0), ADD COLUMN merit_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN dots integer NOT NULL DEFAULT 0 CHECK(dots IN (0,2,4,6,8));
ALTER TABLE room_entries ADD COLUMN reward_cursor timestamptz NOT NULL DEFAULT clock_timestamp();
CREATE TABLE coin_ledger(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),amount integer NOT NULL,source text NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE merit_transactions(source_action_id uuid PRIMARY KEY REFERENCES ritual_actions(id),user_id uuid NOT NULL REFERENCES users(id),amount integer NOT NULL CHECK(amount>=0),created_at timestamptz NOT NULL);
CREATE TABLE dot_unlocks(user_id uuid REFERENCES users(id),pair integer CHECK(pair BETWEEN 1 AND 4),request_key uuid NOT NULL,price integer NOT NULL,PRIMARY KEY(user_id,pair),UNIQUE(user_id,request_key));
CREATE TABLE leaderboard_snapshots(kind text PRIMARY KEY,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE prayers(user_id uuid PRIMARY KEY REFERENCES users(id),template text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
-- Existing published/draft settings retain intentional overrides; migrate only legacy defaults.
UPDATE config_revisions SET config=config || jsonb_build_object('bowCooldown',CASE WHEN (config->>'bowCooldown')::int=5 THEN 60 ELSE (config->>'bowCooldown')::int END,'prostrateCooldown',CASE WHEN (config->>'prostrateCooldown')::int=8 THEN 180 ELSE (config->>'prostrateCooldown')::int END,'incenseCooldown',CASE WHEN (config->>'incenseCooldown')::int=180 THEN 300 ELSE (config->>'incenseCooldown')::int END,'incenseDuration',CASE WHEN (config->>'incenseDuration')::int=15 THEN 5 ELSE (config->>'incenseDuration')::int END);

ALTER TABLE ritual_actions ADD COLUMN merit_reward integer NOT NULL DEFAULT 0 CHECK(merit_reward>=0);
