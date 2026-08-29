// Favourite tracks — a saved list, kept in browser storage.
//
// Identity is the track's key from utils/track-key.js: the Drive filename,
// or artist/title for a bundled local track. Deliberately *not* the track
// number, because a Drive folder re-listing reorders files and renumbers
// every index — favouriting "#12 in 1998" would silently come to mean a
// different record. The filename is what actually names the song.
//
// Each entry also carries the era it came from and its display text, so the
// list renders instantly without fetching any listing. Those cached fields
// are a convenience, never the source of truth: playing a favourite resolves
// the key against the era's real listing.
//
// Storage is browser-local and therefore per-browser and per-device. That is
// the whole reason export/import exists — there is no account to sync to.

import { KeyedStore } from './utils/storage.js';
import { trackKey } from './utils/track-key.js';

const STORAGE_KEY = 'plyr:favourites:v1';

// Stamped into exported files so a future format change can be detected
// rather than silently mis-parsed.
const FORMAT = 'plyr.favourites';
const FORMAT_VERSION = 1;

export class Favourites {
    constructor() {
        this.store = new KeyedStore(STORAGE_KEY, 'favourites');
        this.items = this.#load();
        // 'local' | 'session' | false — set by the last write. Favourites are
        // the one thing here worth losing sleep over: player settings can be
        // recreated by using the player, a saved list can't. If storage has
        // degraded, the view says so rather than letting the list evaporate
        // when the tab closes.
        this.storageMode = 'local';
    }

    #load() {
        const raw = this.store.readJson(null);
        // Accept both the bare array and the wrapped export shape, so a file
        // someone exported can be pasted straight into storage if it ever
        // comes to that.
        const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.items) ? raw.items : []);
        return list.filter((e) => e && typeof e.k === 'string' && e.k !== '');
    }

    // Has this browser ever stored a list? Distinct from "is the list empty":
    // the export control keys off having something to export, and this keys
    // off the app having any stored history at all.
    hasStoredList() {
        return this.store.exists();
    }

    get count() {
        return this.items.length;
    }

    list() {
        return this.items;
    }

    keyFor(track) {
        return trackKey(track);
    }

    has(track) {
        const k = trackKey(track);
        return this.items.some((e) => e.k === k);
    }

    // `era` is the label the track was found under ("1998"), not a folder id
    // — labels are what hash links and share URLs already use, and an id in
    // storage would be meaningless if a folder were ever swapped.
    add(track, era) {
        const k = trackKey(track);
        if (!k || this.items.some((e) => e.k === k)) return false;

        // Newest first: a favourites list is a recent-interest list, and
        // scrolling to the bottom to find what you just saved is wrong.
        this.items.unshift({
            k,
            e: era || null,
            title: track.title || '',
            artist: track.artist || '',
            version: track.version || null,
            at: Date.now(),
        });
        this.#persist();
        return true;
    }

    remove(track) {
        const k = typeof track === 'string' ? track : trackKey(track);
        const before = this.items.length;
        this.items = this.items.filter((e) => e.k !== k);
        if (this.items.length === before) return false;
        this.#persist();
        return true;
    }

    // Returns the new state, so a caller can update a button without asking
    // again.
    toggle(track, era) {
        if (this.has(track)) {
            this.remove(track);
            return false;
        }
        this.add(track, era);
        return true;
    }

    #persist() {
        this.storageMode = this.store.writeJson(this.items);
        return this.storageMode;
    }

    // True when saving works but won't outlive the tab, or isn't working at
    // all. crbntyp.com serves every app from one origin, so a neighbour that
    // caches heavily can fill the shared ~5MB bucket and leave nothing for
    // this list.
    isAtRisk() {
        return this.storageMode !== 'local';
    }

    // ===== transfer between browsers =====

    exportPayload() {
        return {
            format: FORMAT,
            version: FORMAT_VERSION,
            exported: new Date().toISOString(),
            count: this.items.length,
            items: this.items,
        };
    }

    exportFilename() {
        const d = new Date().toISOString().slice(0, 10);
        return `plyr-favourites-${d}.json`;
    }

    // Merge rather than replace. Importing on a browser that already has
    // favourites should not silently destroy them — that would make moving a
    // list between two active browsers a one-way trip.
    //
    // Returns { added, skipped } or throws with a readable message.
    import(text) {
        let data;
        try {
            data = JSON.parse(text);
        } catch (_) {
            throw new Error("That doesn't look like a favourites file.");
        }

        const incoming = Array.isArray(data)
            ? data
            : (Array.isArray(data?.items) ? data.items : null);

        if (!incoming) throw new Error("That file has no favourites in it.");
        if (data && !Array.isArray(data) && data.format && data.format !== FORMAT) {
            throw new Error('That file was exported by a different app.');
        }

        const existing = new Set(this.items.map((e) => e.k));
        let added = 0;
        let skipped = 0;

        for (const raw of incoming) {
            if (!raw || typeof raw.k !== 'string' || raw.k === '') { skipped++; continue; }
            if (existing.has(raw.k)) { skipped++; continue; }
            existing.add(raw.k);
            this.items.push({
                k: raw.k,
                e: typeof raw.e === 'string' ? raw.e : null,
                title: typeof raw.title === 'string' ? raw.title : '',
                artist: typeof raw.artist === 'string' ? raw.artist : '',
                version: typeof raw.version === 'string' ? raw.version : null,
                at: Number.isFinite(raw.at) ? raw.at : Date.now(),
            });
            added++;
        }

        // Keep the whole list newest-first after a merge, so imported entries
        // sort into place by when they were saved rather than landing in a
        // block at the end.
        this.items.sort((a, b) => (b.at || 0) - (a.at || 0));
        this.#persist();
        return { added, skipped };
    }
}
