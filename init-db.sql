CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    telegram_id BIGINT UNIQUE NOT NULL,
    username VARCHAR(255),
    photo_url TEXT,
    auth_date BIGINT,
    coins INT DEFAULT 0,
    last_daily_claim TIMESTAMPTZ,
    chance_today INT DEFAULT 0,
    last_chance_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'set_timestamp' AND tgrelid = 'users'::regclass
    ) THEN
        CREATE TRIGGER set_timestamp
        BEFORE UPDATE ON users
        FOR EACH ROW
        EXECUTE PROCEDURE trigger_set_timestamp();
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_telegram_id ON users(telegram_id);
