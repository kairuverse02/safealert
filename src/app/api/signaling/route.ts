import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const id = body?.id || globalThis.crypto?.randomUUID?.();
    if (!id) return NextResponse.json({ error: 'Missing id and crypto.randomUUID unsupported' }, { status: 400 })

    const supabase = createServiceClient()
    const { data, error } = await supabase.from('pairing_rooms').insert({ id, offer_signal: null, answer_signal: null }).select()
    if (error) {
      const msg = (error && error.message) || JSON.stringify(error)
      return NextResponse.json({ error: msg }, { status: 500 })
    }
    return NextResponse.json({ data }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function GET() {
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase.from('pairing_rooms').select('*')
    if (error) {
      const msg = (error && error.message) || JSON.stringify(error)
      return NextResponse.json({ error: msg }, { status: 500 })
    }
    return NextResponse.json({ data })
  } catch (err) {
    const msg = err instanceof Error ? err.message : JSON.stringify(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
