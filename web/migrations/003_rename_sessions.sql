DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sessions') THEN
    ALTER TABLE sessions RENAME TO orchid_sessions;
  END IF;
END $$;
