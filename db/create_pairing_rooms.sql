-- SQL to create the pairing_rooms table used by the app
CREATE TABLE IF NOT EXISTS public.pairing_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_signal jsonb,
  answer_signal jsonb,
  perimeter_json text,
  dependent_action text,
  guardian_event jsonb,
  created_at timestamptz DEFAULT now()
);

-- Optional: add an index for created_at if you do range queries
CREATE INDEX IF NOT EXISTS idx_pairing_rooms_created_at ON public.pairing_rooms (created_at);

-- ENABLE Row Level Security
ALTER TABLE public.pairing_rooms ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to SELECT (read) all rows
CREATE POLICY "Allow authenticated users to read" 
ON public.pairing_rooms 
FOR SELECT 
USING (auth.role() = 'authenticated');

-- Allow authenticated users to UPDATE all rows
CREATE POLICY "Allow authenticated users to update" 
ON public.pairing_rooms 
FOR UPDATE 
USING (auth.role() = 'authenticated');

-- Allow authenticated users to INSERT
CREATE POLICY "Allow authenticated users to insert" 
ON public.pairing_rooms 
FOR INSERT 
WITH CHECK (auth.role() = 'authenticated');

-- Allow authenticated users to DELETE
CREATE POLICY "Allow authenticated users to delete" 
ON public.pairing_rooms 
FOR DELETE 
USING (auth.role() = 'authenticated');
