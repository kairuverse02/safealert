import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function GET(_req: Request, context: { params: { id: string } }) {
  try {
    const { id } = await context.params
    const supabase = createServiceClient()
    const { data, error } = await supabase.from('pairing_rooms').select('*').eq('id', id)
    if (error) {
      const msg = (error && (error.message || error.msg)) || JSON.stringify(error)
      return NextResponse.json({ error: msg }, { status: 500 })
    }
    if (!data || data.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ data: data[0] })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(req: Request, context: { params: { id: string } }) {
  try {
    const { id } = await context.params
    const body = await req.json()
    const supabase = createServiceClient()
    const { data, error } = await supabase.from('pairing_rooms').update(body).eq('id', id).select()
    if (error) {
      const msg = (error && (error.message || error.msg)) || JSON.stringify(error)
      return NextResponse.json({ error: msg }, { status: 500 })
    }
    return NextResponse.json({ data })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(_req: Request, context: { params: { id: string } }) {
  try {
    const { id } = await context.params
    const supabase = createServiceClient()
    const { data, error } = await supabase.from('pairing_rooms').delete().eq('id', id).select()
    if (error) {
      const msg = (error && (error.message || error.msg)) || JSON.stringify(error)
      return NextResponse.json({ error: msg }, { status: 500 })
    }
    return NextResponse.json({ data })
  } catch (err) {
    const msg = err instanceof Error ? err.message : JSON.stringify(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
