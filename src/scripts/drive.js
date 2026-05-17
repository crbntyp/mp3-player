// Drive integration — thin client talking to the server-side proxy.
//
// Listing, audio streaming, and album-art fetching all go through
// proxy.php. The Drive API key lives only on the server (in
// proxy.config.php) so it never ships to browsers.

import { formatTrackName } from './utils/format-track-name.js';

const PROXY_URL = 'proxy.php';

export class DriveSource {
    constructor() {
        // Folder configuration. The IDs themselves aren't secret — they
        // identify *which* public Drive folder to read — but the key that
        // lets us read it stays server-side.
        this.folders = [
            { id: '1YiPSorLbLyYQ0yhDctUPvuldy5AuBO7N', label: '1993-97', years: '1993-97' },
            { id: '1jG4ecT8-rYbzAtjtODdsQJGZk-py8Xkp', label: '1998',    years: '1998' },
            { id: '1bxnKmycwXKgpq4cszhDCrin_GWrNiAgL', label: '1999',    years: '1999' },
            { id: '1IE0SIW5g2ASNW9alhjPY1vVSjQ1j_MZV', label: '2000',    years: '2000' },
            { id: '1ns2mhWgCZ7lJ_ZN23JfHlLhcljkJYiG5', label: '2001-04', years: '2001-04' },
        ];

        this.cachedTracks = new Map();
    }

    getFolders() {
        return this.folders;
    }

    async fetchTracks(folderId, { fresh = false } = {}) {
        if (!fresh && this.cachedTracks.has(folderId)) {
            return this.cachedTracks.get(folderId);
        }

        // If the caller asked for fresh data, bust the server-side TTL
        // cache before requesting the listing.
        if (fresh) {
            try {
                await fetch(`${PROXY_URL}?action=refresh&folder=${encodeURIComponent(folderId)}`);
            } catch (_) { /* non-fatal — list call below will still work */ }
        }

        console.log(`📂 Fetching tracks for folder: ${folderId}`);

        const url = `${PROXY_URL}?action=list&folder=${encodeURIComponent(folderId)}`;
        const response = await fetch(url);

        if (!response.ok) {
            let msg = `Listing failed (${response.status})`;
            try {
                const err = await response.json();
                if (err.error) msg = err.error;
            } catch (_) { /* response wasn't JSON */ }
            throw new Error(msg);
        }

        const data = await response.json();
        const files = data.files || [];
        if (files.length === 0) {
            console.warn('No audio files found in folder');
            return [];
        }

        const tracks = files.map((file, index) => this.fileToTrack(file, index));
        this.cachedTracks.set(folderId, tracks);
        return tracks;
    }

    fileToTrack(file, index) {
        const parsed = formatTrackName(file.name);
        // Mix label, when present, is appended to the title in italic via
        // a unicode word-joiner so the visible string stays one line.
        const title = parsed.version
            ? `${parsed.title} (${parsed.version})`
            : parsed.title;

        return {
            id:        index + 1,
            title,
            artist:    parsed.artist,
            album:     'Google Drive',
            duration:  '0:00',
            image:     null,
            audio:     `${PROXY_URL}?id=${encodeURIComponent(file.id)}`,
            // Art is lazy — Player will request it once the audio is
            // cached. 404 means "no embedded art", fall back to neon.
            artProbe:  `${PROXY_URL}?action=art&id=${encodeURIComponent(file.id)}`,
            colors:    this.generateColors(),
            driveId:   file.id,
            fileName:  file.name,
        };
    }

    // Random palette per track-listing. Intentional (per user) — tracks
    // without embedded art get a different neon look each load. Tracks
    // with embedded art will get their palette overridden by the Player
    // once the art has loaded.
    generateColors() {
        const palettes = [
            { primary: '#ff6b6b', secondary: '#4ecdc4', accent: '#ffe66d', muted: '#95a5a6', dark: '#2c3e50', light: '#ecf0f1' },
            { primary: '#a855f7', secondary: '#6366f1', accent: '#ec4899', muted: '#8b5cf6', dark: '#1e1b4b', light: '#e0e7ff' },
            { primary: '#22c55e', secondary: '#14b8a6', accent: '#84cc16', muted: '#10b981', dark: '#064e3b', light: '#d1fae5' },
            { primary: '#f97316', secondary: '#ef4444', accent: '#fbbf24', muted: '#fb923c', dark: '#7c2d12', light: '#ffedd5' },
            { primary: '#3b82f6', secondary: '#8b5cf6', accent: '#06b6d4', muted: '#60a5fa', dark: '#1e3a8a', light: '#dbeafe' },
            { primary: '#ec4899', secondary: '#f43f5e', accent: '#f472b6', muted: '#db2777', dark: '#831843', light: '#fce7f3' },
            { primary: '#14b8a6', secondary: '#0891b2', accent: '#2dd4bf', muted: '#0d9488', dark: '#134e4a', light: '#ccfbf1' },
            { primary: '#f59e0b', secondary: '#d97706', accent: '#fbbf24', muted: '#b45309', dark: '#78350f', light: '#fef3c7' },
        ];
        return palettes[Math.floor(Math.random() * palettes.length)];
    }

    clearCache() {
        this.cachedTracks.clear();
    }
}
