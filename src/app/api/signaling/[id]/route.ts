import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const supabase = createServiceClient()
    const { data, error } = await supabase.from('pairing_rooms').select('*').eq('id', id)
    if (error) {
      const msg = (error && error.message) || JSON.stringify(error)
      console.error('GET /api/signaling/:id error', id, msg)
      return NextResponse.json({ error: msg }, { status: 500 })
    }
    if (!data || data.length === 0) {
      console.log('GET /api/signaling/:id not found', id)
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    // Log the row we are returning for debugging
    console.log('GET /api/signaling/:id return', id, data[0])
    return NextResponse.json({ data: data[0] })
  } catch (err) {
    console.error('GET /api/signaling/:id exception', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const body = await req.json()
    console.log('PATCH /api/signaling/:id incoming', id, body)
    const supabase = createServiceClient()

    // If the incoming body contains answer_signal that is candidate-only, candidates array,
    // or an 'answer' object that lacks an SDP, merge it safely with any existing answer_signal so
    // we don't accidentally overwrite an existing SDP with an empty answer object.
    const incomingAnswer = (body && body.answer_signal) || null
    const incomingHasNoSdp = incomingAnswer && !(typeof incomingAnswer.sdp === 'string' && incomingAnswer.sdp.length > 0)

    if (incomingAnswer && incomingHasNoSdp && (incomingAnswer.type === 'candidates' || incomingAnswer.type === 'candidate' || incomingAnswer.candidate || Array.isArray(incomingAnswer.candidates) || incomingAnswer.transceiverRequest)) {
      // Fetch existing row to merge safely
      const { data: curRows, error: curErr } = await supabase.from('pairing_rooms').select('answer_signal').eq('id', id).limit(1)
      if (curErr) {
        const msg = (curErr && curErr.message) || JSON.stringify(curErr)
        console.error('PATCH /api/signaling/:id fetch existing error', id, msg)
        return NextResponse.json({ error: msg }, { status: 500 })
      }

      type ExistingAnswer = { candidates?: RTCIceCandidateInit[]; candidate?: RTCIceCandidateInit; sdp?: string; type?: string; transceiverRequest?: unknown; [key: string]: unknown } | null;
      const existing = Array.isArray(curRows) && curRows.length > 0 ? (curRows[0] as { answer_signal?: unknown }).answer_signal as ExistingAnswer : null

      // Normalize incoming candidates to an array
      const incomingCandidates = Array.isArray(incomingAnswer.candidates)
        ? incomingAnswer.candidates.slice()
        : incomingAnswer.candidate
        ? [incomingAnswer.candidate]
        : []

      // Build merged answer that preserves existing SDP (if any) and concatenates candidates
      const prevCandidates = Array.isArray(existing?.candidates)
        ? existing.candidates.slice()
        : existing?.candidate
        ? [existing.candidate]
        : []

      const merged: { [k: string]: unknown } = {
        // start with existing fields so we preserve sdp and other metadata
        ...(existing || {}),
        // ensure candidates array contains previous + incoming
        candidates: [...prevCandidates, ...incomingCandidates],
      }

      // Also preserve transceiverRequest or other flags from incoming if present
      if (incomingAnswer.transceiverRequest && !merged.transceiverRequest) merged.transceiverRequest = incomingAnswer.transceiverRequest

      // Remove single 'candidate' field if present
      if (merged.candidate) delete merged.candidate

      // If there is no SDP present yet, keep type 'candidates', otherwise mark as 'answer'
      merged.type = merged.sdp ? 'answer' : 'candidates'

      // Merge other non-answer_signal fields from body (e.g., dependent_action) while ensuring answer_signal is the merged object
      const updateBody: Record<string, unknown> = { ...body, answer_signal: merged }

      // Do the update with the merged object
      const { data: updData, error: updErr } = await supabase
        .from('pairing_rooms')
        .update(updateBody)
        .eq('id', id)
        .select()

      if (updErr) {
        const msg = (updErr && updErr.message) || JSON.stringify(updErr)
        console.error('PATCH /api/signaling/:id error', id, msg)
        return NextResponse.json({ error: msg }, { status: 500 })
      }

      console.log('PATCH /api/signaling/:id persisted (merged)', id, updData)
      return NextResponse.json({ data: updData })
    }

    // Default: do a regular update for other payloads (including full answers with SDP)
    const { data, error } = await supabase.from('pairing_rooms').update(body).eq('id', id).select()
    if (error) {
      const msg = (error && error.message) || JSON.stringify(error)
      console.error('PATCH /api/signaling/:id error', id, msg)
      return NextResponse.json({ error: msg }, { status: 500 })
    }
    console.log('PATCH /api/signaling/:id persisted', id, data)
    return NextResponse.json({ data })
  } catch (err) {
    console.error('PATCH /api/signaling/:id exception', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const supabase = createServiceClient()
    const { data, error } = await supabase.from('pairing_rooms').delete().eq('id', id).select()
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
