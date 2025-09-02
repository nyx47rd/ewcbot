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

-- Create a function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create a trigger to automatically update updated_at on row modification
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

-- Add an index on telegram_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_telegram_id ON users(telegram_id);

-- Add a column to reset chance_today daily (or handle in application logic)
-- For simplicity, we will handle the reset logic in the application.
-- When a user invokes /chance, we'll check if last_chance_date is from a previous day.
-- If it is, we reset chance_today to 0 before proceeding.

COMMENT ON COLUMN users.telegram_id IS 'Unique identifier from Telegram.';
COMMENT ON COLUMN users.coins IS 'User''s coin balance.';
COMMENT ON COLUMN users.last_daily_claim IS 'Timestamp of the last daily reward claim.';
COMMENT ON COLUMN users.chance_today IS 'Counter for the daily chance game uses.';
COMMENT ON COLUMN users.last_chance_date IS 'Timestamp of the last chance game use, to check for day reset.';
