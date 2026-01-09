#!/usr/bin/env node
// Quick script to test guardian_event via local dev server
// Usage: node scripts/check_guardian_event.js <ROOM_ID> [--server=http://localhost:3000]

const [,, roomIdArg, serverArg] = process.argv;
if (!roomIdArg) {
  console.error('Usage: node scripts/check_guardian_event.js <ROOM_ID> [--server=http://localhost:3000]');
  process.exit(2);
}
const ROOM_ID = roomIdArg;
const SERVER = (serverArg && serverArg.startsWith('--server=')) ? serverArg.split('=')[1] : 'http://localhost:3000';

(async () => {
  try {
    console.log('Testing guardian_event on room:', ROOM_ID, 'server:', SERVER);

    // 1) Patch guardian_event
    const payload = { guardian_event: { type: 'info', message: 'test guardian_event', time: new Date().toISOString() } };
    const patchResp = await fetch(`${SERVER}/api/signaling/${ROOM_ID}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const patchJson = await patchResp.json().catch(() => null);
    console.log('PATCH response', patchResp.status, patchJson);

    // 2) GET the room
    const getResp = await fetch(`${SERVER}/api/signaling/${ROOM_ID}`);
    const getJson = await getResp.json().catch(() => null);
    console.log('GET response', getResp.status, getJson?.data?.guardian_event);

    // 3) Clear guardian_event
    const clearResp = await fetch(`${SERVER}/api/signaling/${ROOM_ID}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guardian_event: null }) });
    const clearJson = await clearResp.json().catch(() => null);
    console.log('Clear PATCH response', clearResp.status, clearJson);

    // 4) GET again
    const get2 = await fetch(`${SERVER}/api/signaling/${ROOM_ID}`);
    const get2Json = await get2.json().catch(() => null);
    console.log('GET after clear', get2.status, get2Json?.data?.guardian_event);

    console.log('\nDone. If you see the original guardian_event value in step 2, the column exists and API accepts it.');
  } catch (err) {
    console.error('Error running check script', err);
    process.exit(1);
  }
})();
