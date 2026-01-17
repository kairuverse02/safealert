/**
 * Updates media tracks on an existing RTCPeerConnection by reusing transceivers
 * instead of repeatedly calling addTrack, which creates duplicate m-lines.
 * Fixes the "Ghost Transceiver" issue that causes InvalidAccessError on receiver.
 */
export function updateMediaTracks(
  peerConnection: RTCPeerConnection | null,
  localStream: MediaStream | null
): void {
  if (!peerConnection || !localStream) {
    console.log('[Fix] Skipping updateMediaTracks: missing peerConnection or localStream');
    return;
  }

  // Get existing transceivers
  const existingTransceivers = peerConnection.getTransceivers();
  console.log('[Fix] Found', existingTransceivers.length, 'existing transceiver(s)');

  // Process video tracks
  const videoTracks = localStream.getVideoTracks();
  const videoTrack = videoTracks.length > 0 ? videoTracks[0] : null;
  
  const videoTransceiver = existingTransceivers.find(
    (t) => t.sender.track?.kind === 'video' || t.receiver.track?.kind === 'video'
  );

  if (videoTransceiver) {
    console.log('[Fix] Reusing existing video transceiver');
    videoTransceiver.sender.replaceTrack(videoTrack).catch((err) => {
      console.error('[Fix] Failed to replace video track:', err);
    });
    if (videoTransceiver.direction !== 'sendrecv') {
      videoTransceiver.direction = 'sendrecv';
      console.log('[Fix] Set video transceiver direction to sendrecv');
    }
  } else if (videoTrack) {
    console.log('[Fix] No video transceiver found, calling addTrack for video');
    peerConnection.addTrack(videoTrack, localStream);
  } else {
    console.log('[Fix] No video track available');
  }

  // Process audio tracks
  const audioTracks = localStream.getAudioTracks();
  const audioTrack = audioTracks.length > 0 ? audioTracks[0] : null;

  const audioTransceiver = existingTransceivers.find(
    (t) => t.sender.track?.kind === 'audio' || t.receiver.track?.kind === 'audio'
  );

  if (audioTransceiver) {
    console.log('[Fix] Reusing existing audio transceiver');
    audioTransceiver.sender.replaceTrack(audioTrack).catch((err) => {
      console.error('[Fix] Failed to replace audio track:', err);
    });
    if (audioTransceiver.direction !== 'sendrecv') {
      audioTransceiver.direction = 'sendrecv';
      console.log('[Fix] Set audio transceiver direction to sendrecv');
    }
  } else if (audioTrack) {
    console.log('[Fix] No audio transceiver found, calling addTrack for audio');
    peerConnection.addTrack(audioTrack, localStream);
  } else {
    console.log('[Fix] No audio track available');
  }

  console.log('[Fix] updateMediaTracks completed');
}
