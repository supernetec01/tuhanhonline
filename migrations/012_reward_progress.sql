-- Accumulate valid partial minutes across visits without changing existing wallets/ledgers.
CREATE TABLE coin_progress(
  user_id uuid NOT NULL REFERENCES users(id),
  day date NOT NULL,
  remainder_ms integer NOT NULL DEFAULT 0 CHECK(remainder_ms BETWEEN 0 AND 59999),
  PRIMARY KEY(user_id,day)
);
