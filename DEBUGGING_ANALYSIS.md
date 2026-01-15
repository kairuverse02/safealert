# WebRTC Video Playback Analysis

## Symptoms Observed

### Guardian Console
- ✅ Tracks successfully received: `"Guardian: remoteStream now has 1 video and 1 audio tracks"`
- ✅ MonitoringSystem component receives stream: `"MonitoringSystem: remoteStream has 1 video and 1 audio tracks"`
- ✅ srcObject assigned: `"MonitoringSystem: setting srcObject to remoteStream and starting playback"`
- ✅ **onPlay event fires**: `"MonitoringSystem: video onPlay fired"`
- ❌ **readyState stuck at HAVE_NOTHING**: Hundreds of logs showing `"MonitoringSystem: video readyState is HAVE_NOTHING (0) - no data loaded yet"`
- ❌ **NO onLoadedMetadata event**: Never fires despite srcObject being set
- ❌ **NO onError event**: No explicit errors reported
- ❌ Canvas never draws (because readyState check fails)

### Dependent Console
- ✅ Answer sent with 3 m-lines (correct)
- ✅ Candidates sent to guardian
- ⚠️ **CRITICAL: 8-second timeout triggers**: `"[PC_TIMEOUT] 8s timeout reached without connection; attempting redirect anyway"`
- ✅ Guardian sends start_monitor command (received via polling)
- ✅ getUserMedia called, gets audio+video stream
- ✅ Dependent "started camera for monitoring"

## Root Cause Analysis

### The Problem Chain

1. **Dependent's connection times out** (8 seconds) before establishing a stable connection
2. **Despite timeout, dependent still sends tracks** via WebRTC (timing issue)
3. **Guardian receives tracks** and sets up MediaStream correctly
4. **BUT: Dependent's RTCPeerConnection closes** when it redirects to dashboard
5. **Video element stuck at HAVE_NOTHING** because the connection feeding it is dead
6. **No metadata loads** because the source connection is broken

### Why onPlay Fires But Playback Doesn't Start

- `onPlay` fires immediately when `videoElement.play()` is called
- `onLoadedMetadata` requires the browser to actually receive and parse video headers
- **If the connection is broken/timing out, no frames arrive → no metadata**
- The video element starts playing empty/no-data state

### Why Dependent Redirects at 8 Seconds

Looking at [PatientScanner.tsx](src/app/client/components/PatientScanner.tsx) lines 800-826:
```typescript
const timeoutId = setTimeout(() => {
  if (!hasRedirectedRef.current) {
    console.log('[PC_TIMEOUT] 8s timeout reached without connection; attempting redirect anyway');
    try {
      doRedirectToDashboard();
    } catch (err) {
      console.warn('[PC_TIMEOUT] Timeout redirect failed', err);
    }
  }
}, 8000); // 8-second timeout
```

This timeout redirects the dependent to dashboard **regardless of whether the connection succeeded**. When the dependent redirects and unmounts, its RTCPeerConnection closes, killing the media stream.

## Solution Strategy

### Issue 1: Dependent Timeout Redirects Too Aggressively
**Fix**: Don't redirect if connection is actually working (tracks are flowing)
- Listen for `ontrack` events on dependent's peer
- Only redirect after timeout **if** no tracks received
- Or: Increase timeout to allow more ICE gathering time

### Issue 2: Dependent Disconnects After Redirect
**Fix**: Keep connection alive after redirect
- Move the redirect delay to **after** monitoring starts
- Or: Don't redirect at all if monitoring is requested
- Guardian's `start_monitor` command should prevent redirect

### Issue 3: Guardian Can't Detect When Connection Dies
**Fix**: Add connection state monitoring
- Added: Connection state change logging (Guardian PCconnectionState transitions)
- Can trigger alerts/recovery if connection fails
- Can pause animation loop if connection dead

## Immediate Changes Made

1. **Enhanced Guardian Connection State Logging**
   - Now logs state transitions: `"connection state: connecting → established"` etc.
   - Tracks ICE state changes separately
   - Helps identify when/why connection fails

2. **Enhanced MediaStream Diagnostics**
   - Logs each track's readyState (live/ended/muted)
   - Shows which tracks are enabled
   - Helps identify if source stream is broken

3. **Fixed Animation Loop Logging**
   - Correctly distinguishes HAVE_NOTHING vs HAVE_CURRENT_DATA
   - Clearer diagnostics for readyState issues

## Next Steps

### High Priority
1. **Fix dependent timeout behavior**
   - Option A: Check if tracks are flowing before redirecting
   - Option B: Let guardian's start_monitor prevent/delay redirect
   - Option C: Increase timeout to 15-20 seconds for ICE gathering

2. **Keep connection alive through monitoring session**
   - Dependent should NOT disconnect after sending start_monitor response
   - Should stay connected until guardian stops monitoring

### Medium Priority
3. Test with the new diagnostics to confirm connection states
4. Add explicit "connection failed" detection on guardian side
5. Add connection recovery logic

### Debugging Checklist for Next Test
When you re-run this test, look for:
- [ ] Guardian PC connection state transitions (should see "new" → "connecting" → "connected")
- [ ] Guardian PC ICE state transitions (should see "new" → "checking" → "connected")
- [ ] MediaStream track details (should show enabled=true, readyState='live')
- [ ] When does video readyState first become HAVE_CURRENT_DATA?
- [ ] Does onLoadedMetadata eventually fire, or stay stuck?
- [ ] Does dependent's redirect happen before or after tracks sent?

## Technical Notes

### RTCPeerConnection States
- `new`: Initial state
- `connecting`: ICE gathering/checking candidates
- `connected`: At least one candidate pair working
- `completed`: ICE completed
- `failed`: No working candidate pairs found
- `disconnected`: Temporary loss of connectivity
- `closed`: Explicitly closed

### Video Element readyState Values
- `0` (HAVE_NOTHING): No data
- `1` (HAVE_METADATA): Metadata loaded but no frames yet
- `2` (HAVE_CURRENT_DATA): Has current frame data
- `3` (HAVE_FUTURE_DATA): Has frames to show
- `4` (HAVE_ENOUGH_DATA): Has enough to play through

### Why Metadata Never Loads
Video metadata (width, height, duration) comes from the first frame headers. If no frames arrive from source:
- ➜ readyState stays at 0
- ➜ onLoadedMetadata never fires
- ➜ videoWidth/videoHeight remain 0
- ➜ Canvas can't be sized properly
- ➜ Animation loop returns early

This is **NOT a codec/format issue** — it's a **data flow issue**.
