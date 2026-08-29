// Drive integration — thin client talking to the server-side proxy.
//
// Listing and audio streaming go through proxy.php. The Drive API key lives
// only on the server (in proxy.config.php) so it never ships to browsers.
//
// Artwork does not come from here. The files' own embedded art is whatever the
// rip carried — low-resolution scans and wrong releases — so the player uses
// the generated sleeve set instead.

import { formatTrackName } from './utils/format-track-name.js';
import erasData from '../data/eras.json';

const PROXY_URL = 'proxy.php';

export class DriveSource {
    constructor() {
        // Folder configuration now lives in data/eras.json, because
        // share.php needs the same label → folder mapping to resolve a
        // shared link server-side. Two hardcoded copies of this list would
        // drift the moment an era was added, and the failure would be a
        // share card for the wrong record rather than an error.
        this.folders = erasData.eras;

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

        // The dev server has no PHP, so it happily serves proxy.php as a
        // static file: HTTP 200 with the raw source as the body. Parsing that
        // as JSON throws, and the old code let the empty-array fallback report
        // "No tracks found" — which blames the Drive folder for a missing
        // backend. Detect it and say what's actually wrong.
        const raw = await response.text();
        let data;
        try {
            data = JSON.parse(raw);
        } catch (_) {
            if (raw.trimStart().startsWith('<?php')) {
                throw new Error('proxy.php is not being executed — Drive needs a PHP server (see README).');
            }
            throw new Error('Drive listing returned a non-JSON response.');
        }

        if (data.error) throw new Error(data.error);

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
        return {
            id:        index + 1,
            title:     parsed.title,
            version:   parsed.version, // rendered on its own line by the player
            artist:    parsed.artist,
            album:     'Google Drive',
            duration:  '0:00',
            image:     null,
            audio:     `${PROXY_URL}?id=${encodeURIComponent(file.id)}`,
            // No artProbe. The MP3's own embedded art is never used — see the
            // note in Player. A null image means the player picks a sleeve.
            colors:    this.generateColors(),
            driveId:   file.id,
            fileName:  file.name,
        };
    }

    // Last-resort palette. In practice the player derives colour from whichever
    // sleeve a track is wearing, so this only applies if the sleeve set failed
    // to load at all.
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
