CREATE TABLE users (
  id uuid PRIMARY KEY, email text UNIQUE NOT NULL, password_hash text NOT NULL,
  name text NOT NULL CHECK(length(name) BETWEEN 2 AND 32),
  role text NOT NULL DEFAULT 'USER' CHECK(role IN ('USER','ADMIN','OPERATOR')),
  verified_at timestamptz, banned boolean NOT NULL DEFAULT false,
  coins integer NOT NULL DEFAULT 300 CHECK(coins>=0), equipped text NOT NULL DEFAULT 'linen',
  accessory text NOT NULL DEFAULT 'none', mfa_secret text, mfa_last_counter bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL, admin_until timestamptz
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE user_tokens (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK(purpose IN ('verify','reset')), expires_at timestamptz NOT NULL
);
CREATE TABLE inventory(user_id uuid REFERENCES users(id) ON DELETE CASCADE, outfit_id text NOT NULL, PRIMARY KEY(user_id,outfit_id));
CREATE TABLE purchases(id uuid PRIMARY KEY, user_id uuid REFERENCES users(id), outfit_id text NOT NULL, amount integer NOT NULL CHECK(amount>=0), request_key uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,request_key));
CREATE TABLE rooms(id text PRIMARY KEY CHECK(id='main'), status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')), version bigint NOT NULL DEFAULT 0);
INSERT INTO rooms(id) VALUES('main');
CREATE TABLE seats(id integer PRIMARY KEY CHECK(id BETWEEN 1 AND 36), room_id text NOT NULL DEFAULT 'main' REFERENCES rooms(id), code text UNIQUE NOT NULL);
INSERT INTO seats(id,code) SELECT n,chr(65+(n-1)/6)||(((n-1)%6)+1)::text FROM generate_series(1,36) n;
-- One canonical membership table enforces uniqueness ACROSS active seats and both queue states.
CREATE TABLE room_entries(
  id uuid PRIMARY KEY, room_id text NOT NULL DEFAULT 'main' REFERENCES rooms(id), user_id uuid NOT NULL REFERENCES users(id),
  seat_id integer REFERENCES seats(id), status text NOT NULL CHECK(status IN ('ACTIVE','WAITING','INVITED','COMPLETED','CANCELLED','EXPIRED')),
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE, created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz, disconnect_deadline timestamptz, ended_at timestamptz,
  CHECK ((status IN ('ACTIVE','INVITED') AND seat_id IS NOT NULL AND expires_at IS NOT NULL) OR status NOT IN ('ACTIVE','INVITED')),
  CHECK(status<>'WAITING' OR seat_id IS NULL)
);
CREATE UNIQUE INDEX one_live_membership_per_user ON room_entries(user_id) WHERE status IN ('ACTIVE','WAITING','INVITED');
CREATE UNIQUE INDEX one_occupied_seat ON room_entries(seat_id) WHERE status IN ('ACTIVE','INVITED');
CREATE INDEX waiting_fifo ON room_entries(sequence) WHERE status='WAITING';
CREATE INDEX membership_expiry ON room_entries(expires_at) WHERE status IN ('ACTIVE','INVITED');
CREATE TABLE ritual_actions(
  id uuid PRIMARY KEY, entry_id uuid NOT NULL REFERENCES room_entries(id), user_id uuid NOT NULL REFERENCES users(id),
  type text NOT NULL CHECK(type IN ('bow','prostrate','incense')), status text NOT NULL CHECK(status IN ('QUEUED','RUNNING','COMPLETED','CANCELLED')),
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE, requested_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, ends_at timestamptz,
  duration_ms integer NOT NULL, cooldown_ms integer NOT NULL
);
CREATE UNIQUE INDEX one_pending_action_per_player ON ritual_actions(user_id) WHERE status IN ('QUEUED','RUNNING');
CREATE UNIQUE INDEX one_incense_at_a_time ON ritual_actions((1)) WHERE type='incense' AND status='RUNNING';
CREATE INDEX action_cooldown ON ritual_actions(user_id,type,requested_at DESC);
CREATE TABLE commands(user_id uuid REFERENCES users(id), request_key uuid NOT NULL, operation text NOT NULL, result_id uuid NOT NULL, PRIMARY KEY(user_id,request_key));
CREATE TABLE config_revisions(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, status text NOT NULL CHECK(status IN ('draft','published','archived')), config jsonb NOT NULL, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX one_published_config ON config_revisions((1)) WHERE status='published';
CREATE UNIQUE INDEX one_draft_config ON config_revisions((1)) WHERE status='draft';
CREATE TABLE audit_logs(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id uuid REFERENCES users(id), action text NOT NULL, before_json jsonb, after_json jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE outbox(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, room_version bigint, kind text NOT NULL, payload jsonb NOT NULL DEFAULT '{}', delivered_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE live_events(id uuid PRIMARY KEY, provider text NOT NULL, live_id text NOT NULL, source_event_id text NOT NULL, sender_key text NOT NULL,
  display_name text NOT NULL, gift_id text NOT NULL, quantity integer NOT NULL CHECK(quantity BETWEEN 0 AND 10000), streak_id text,
  cumulative_count integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(provider,live_id,source_event_id));
CREATE TABLE gift_streaks(provider text, live_id text, sender_key text, gift_id text, streak_id text, max_count integer NOT NULL, PRIMARY KEY(provider,live_id,sender_key,gift_id,streak_id));
CREATE TABLE tts_jobs(id uuid PRIMARY KEY, event_id uuid UNIQUE NOT NULL REFERENCES live_events(id), text text NOT NULL,
  status text NOT NULL CHECK(status IN ('QUEUED','GENERATING','READY','PLAYING','COMPLETED','FAILED','SKIPPED')), mode text NOT NULL DEFAULT 'mock',
  audio_file text, lease_until timestamptz, claimed_by text, error_code text, created_at timestamptz NOT NULL DEFAULT now(), played_at timestamptz);
CREATE INDEX tts_fifo ON tts_jobs(created_at) WHERE status IN ('QUEUED','READY');
CREATE TABLE broadcast_tokens(token_hash text PRIMARY KEY, expires_at timestamptz NOT NULL, created_by uuid REFERENCES users(id));
