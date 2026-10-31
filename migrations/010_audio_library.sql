ALTER TABLE media_assets ADD COLUMN archived_at timestamptz;
CREATE INDEX ritual_completed_audio ON ritual_actions(user_id,ends_at DESC) WHERE status='COMPLETED';
