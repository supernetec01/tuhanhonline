ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(role IN ('USER','ADMIN','OPERATOR','MODERATOR'));
CREATE TABLE chat_messages(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),body text NOT NULL CHECK(length(body)<=150),normalized text NOT NULL,status text NOT NULL CHECK(status IN ('APPROVED','REJECTED','PENDING_REVIEW','DELETED')),reason text,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX chat_history ON chat_messages(created_at DESC) WHERE status='APPROVED';
CREATE INDEX chat_user ON chat_messages(user_id,created_at DESC);
CREATE TABLE chat_reports(message_id uuid REFERENCES chat_messages(id) ON DELETE CASCADE,reporter_id uuid REFERENCES users(id),reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(message_id,reporter_id));
CREATE TABLE chat_sanctions(id uuid PRIMARY KEY,user_id uuid REFERENCES users(id),actor_id uuid REFERENCES users(id),reason text NOT NULL,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE room_entries ADD COLUMN cultivated_minutes integer NOT NULL DEFAULT 0;
