ALTER TABLE users ADD COLUMN appearance_type text NOT NULL DEFAULT 'male' CHECK(appearance_type IN ('male','female'));
ALTER TABLE room_entries
 ADD COLUMN character_state text NOT NULL DEFAULT 'SEATED' CHECK(character_state IN ('SEATED','STANDING','WALKING_AWAY','RETURNING','INCENSE_PENDING','INCENSE_WALKING','INCENSE_WAITING','INCENSE_TO_STATION','INCENSE_ACTIVE','INCENSE_RETURNING')),
 ADD COLUMN position_node text,
 ADD COLUMN movement_path jsonb,
 ADD COLUMN move_started_at timestamptz,
 ADD COLUMN move_ends_at timestamptz,
 ADD COLUMN leave_deadline timestamptz,
 ADD COLUMN ritual_protected_until timestamptz;
UPDATE room_entries SET position_node='seat:'||seat_id WHERE seat_id IS NOT NULL;
ALTER TABLE ritual_actions
 ADD COLUMN phase text NOT NULL DEFAULT 'LEGACY',
 ADD COLUMN queue_slot integer CHECK(queue_slot BETWEEN 0 AND 11),
 ADD COLUMN station text CHECK(station IN ('A','B')),
 ADD COLUMN called_at timestamptz;
DROP INDEX one_incense_at_a_time;
UPDATE ritual_actions SET station='A',phase='ACTIVE',called_at=started_at WHERE type='incense' AND status='RUNNING';
UPDATE ritual_actions SET phase='PENDING' WHERE type='incense' AND status='QUEUED';
UPDATE room_entries e SET character_state='INCENSE_PENDING' FROM ritual_actions a WHERE a.entry_id=e.id AND a.type='incense' AND a.status='QUEUED' AND e.status='ACTIVE';
UPDATE room_entries e SET character_state='INCENSE_ACTIVE',position_node='station:A',ritual_protected_until=clock_timestamp()+interval '10 minutes' FROM ritual_actions a WHERE a.entry_id=e.id AND a.type='incense' AND a.status='RUNNING' AND e.status='ACTIVE';
CREATE UNIQUE INDEX one_incense_per_station ON ritual_actions(station) WHERE type='incense' AND station IS NOT NULL AND status IN ('RUNNING','QUEUED');
CREATE UNIQUE INDEX one_physical_queue_slot ON ritual_actions(queue_slot) WHERE type='incense' AND queue_slot IS NOT NULL AND status='QUEUED';
CREATE INDEX movement_deadlines ON room_entries(move_ends_at) WHERE status='ACTIVE';
CREATE TABLE movement_commands(user_id uuid REFERENCES users(id),request_key uuid NOT NULL,operation text NOT NULL,entry_id uuid REFERENCES room_entries(id),PRIMARY KEY(user_id,request_key));
-- Reduce only legacy stock scales, preserving IDs, custom layouts and ownership.
UPDATE config_revisions SET config=jsonb_set(config,'{seatLayout}',(
 SELECT jsonb_agg(CASE WHEN abs((s->>'scale')::numeric-(CASE WHEN (config->>'capacity')::int<=36 AND (s->>'id')::int<=36 THEN 5.7+floor(((s->>'id')::int-1)/6.0)*1.02 ELSE 3.2+floor(((s->>'id')::int-1)/6.0)*.22 END))<.00001
 THEN jsonb_set(s,'{scale}',to_jsonb(CASE WHEN (config->>'capacity')::int<=36 AND (s->>'id')::int<=36 THEN 4.2+floor(((s->>'id')::int-1)/6.0)*.35 ELSE 2.6+floor(((s->>'id')::int-1)/6.0)*.06 END)) ELSE s END ORDER BY (s->>'id')::int)
 FROM jsonb_array_elements(config->'seatLayout') s));
