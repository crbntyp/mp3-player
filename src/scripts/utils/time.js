// Time formatting helpers — pure functions, no DOM, no player state.

export function formatTime(seconds) {
  if (!seconds || isNaN(seconds) || !isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Parses a "M:SS" duration string to seconds. Returns 0 for empty or
// malformed input — callers should treat 0 as "unknown" and fall back to
// audio.duration once the file has loaded.
export function parseDuration(durationStr) {
  if (!durationStr) return 0;
  const parts = durationStr.split(':');
  if (parts.length === 2) {
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
  }
  return 0;
}
