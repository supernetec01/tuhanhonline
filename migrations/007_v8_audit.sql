-- Opening balances preserve existing wallets; earlier history remains in purchases.
INSERT INTO coin_ledger(user_id,amount,source) SELECT id,coins-COALESCE((SELECT sum(amount)::int FROM coin_ledger WHERE user_id=users.id),0),'opening:'||id FROM users ON CONFLICT(source) DO NOTHING;
CREATE TABLE chat_appeals(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),body text NOT NULL CHECK(length(body) BETWEEN 5 AND 500),status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','RESOLVED')),resolution text,created_at timestamptz NOT NULL DEFAULT now());
