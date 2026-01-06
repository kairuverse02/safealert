-- SQL to create the pairing_rooms table used by the app
CREATE TABLE IF NOT EXISTS public.pairing_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_signal jsonb,
  answer_signal jsonb,
  perimeter_json text,
  dependent_action text,
  created_at timestamptz DEFAULT now()
);

-- Optional: add an index for created_at if you do range queries
CREATE INDEX IF NOT EXISTS idx_pairing_rooms_created_at ON public.pairing_rooms (created_at);
