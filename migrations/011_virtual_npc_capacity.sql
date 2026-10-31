-- NPCs are never stored. Only extend the human seat range; keep existing IDs/codes/data.
ALTER TABLE seats DROP CONSTRAINT seats_id_check;
ALTER TABLE seats ADD CONSTRAINT seats_id_check CHECK(id BETWEEN 1 AND 72);
INSERT INTO seats(id,code) SELECT n,chr(65+(n-1)/6)||(((n-1)%6)+1)::text FROM generate_series(37,72) n;
