// Stable identity for a track, and a stable number derived from it.
//
// Used to pick which fallback sleeve a track wears. The requirement is only
// that the same track maps to the same number on every load and in every
// caller — not that the distribution is cryptographically anything. FNV-1a is
// a few lines, has no dependencies, and spreads short strings well enough
// that 30 sleeves across a 40-track era don't visibly clump.

// A track's identity, in order of how reliably it survives a re-listing.
//
// fileName is the strongest: Drive re-listings can reorder files and renumber
// `id`, so keying on position would silently reassign every sleeve whenever a
// folder changed. Artist + title is the fallback for bundled local tracks,
// which have no fileName.
export function trackKey(track) {
    if (track.fileName) return track.fileName;
    const parts = [track.artist, track.title, track.version].filter(Boolean);
    if (parts.length) return parts.join(' - ');
    return String(track.id ?? '');
}

// FNV-1a, 32-bit. Returns a non-negative integer.
export function hashString(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        // The classic FNV prime multiply, written as shifts because a plain
        // `h * 16777619` overflows the float mantissa and loses low bits.
        h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
    }
    return h >>> 0;
}
