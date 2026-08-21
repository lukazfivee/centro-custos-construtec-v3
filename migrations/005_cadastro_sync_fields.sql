DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='public_id') THEN
    ALTER TABLE suppliers ADD COLUMN public_id UUID;
    UPDATE suppliers SET public_id = gen_random_uuid() WHERE public_id IS NULL;
    ALTER TABLE suppliers ALTER COLUMN public_id SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='revision') THEN
    ALTER TABLE suppliers ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='categories' AND column_name='public_id') THEN
    ALTER TABLE categories ADD COLUMN public_id UUID;
    UPDATE categories SET public_id = gen_random_uuid() WHERE public_id IS NULL;
    ALTER TABLE categories ALTER COLUMN public_id SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='categories' AND column_name='revision') THEN
    ALTER TABLE categories ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cost_centers' AND column_name='public_id') THEN
    ALTER TABLE cost_centers ADD COLUMN public_id UUID;
    UPDATE cost_centers SET public_id = gen_random_uuid() WHERE public_id IS NULL;
    ALTER TABLE cost_centers ALTER COLUMN public_id SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cost_centers' AND column_name='revision') THEN
    ALTER TABLE cost_centers ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS suppliers_public_id_unique ON suppliers (public_id);
CREATE UNIQUE INDEX IF NOT EXISTS categories_public_id_unique ON categories (public_id);
CREATE UNIQUE INDEX IF NOT EXISTS cost_centers_public_id_unique ON cost_centers (public_id);
