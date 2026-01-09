export async function sendDependentAction(action: string) {
  try {
    const roomId = typeof window !== 'undefined' ? window.localStorage.getItem('pairingRoomId') : null;
    if (!roomId) throw new Error('No pairing room ID available');

    const resp = await fetch(`/api/signaling/${roomId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dependent_action: action }),
    });

    const json = await resp.json().catch(() => null);
    return { ok: resp.ok, status: resp.status, json };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
