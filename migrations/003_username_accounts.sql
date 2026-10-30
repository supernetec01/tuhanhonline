ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD COLUMN username text;
UPDATE users SET username='u_'||left(replace(id::text,'-',''),20);
ALTER TABLE users ALTER COLUMN username SET DEFAULT ('u_'||left(replace(gen_random_uuid()::text,'-',''),20));
ALTER TABLE users ALTER COLUMN username SET NOT NULL;
ALTER TABLE users ADD CONSTRAINT username_format CHECK(username ~ '^[a-z0-9_]{3,24}$');
CREATE UNIQUE INDEX users_username_unique ON users(lower(username));
COMMENT ON COLUMN users.name IS 'Pháp danh (dharmaName trong API); giữ tên cột để tương thích dữ liệu cũ';
