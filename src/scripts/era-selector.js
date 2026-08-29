// Records sheet — a single-view track browser over the configured Drive folders.
//
// It used to be a two-state popup hinged to the bottom-left of the viewport:
// pick an era, then see its tracks, with a back arrow between them. That cost
// a tap on every visit and, once you were in the list, gave no indication of
// which era you were looking at. The eras are now a chip row pinned above
// the list, so there is one view: chips, search, tracks.
//
// The sheet itself is one component with two anchorings — a bottom sheet on
// mobile and a centred panel on desktop — which is handled entirely in CSS.
// Nothing here knows which one it's drawing.

import { DriveSource } from './drive.js';
import { trackKey } from './utils/track-key.js';

const PROXY_URL = 'proxy.php';

// The favourites view is addressed like an era, so one code path renders
// both. It isn't a folder, so anything folder-specific checks for it.
const FAVOURITES = 'favourites';

export class EraSelector {
    constructor(player) {
        this.player = player;
        this.driveSource = null;
        this.viewingSource = null;   // folder id currently rendered
        this.viewingTracks = [];
        this.listingError = null;
    }

    init() {
        try {
            this.driveSource = new DriveSource();
            this.player.driveSource = this.driveSource;
            this.populateMenu();
        } catch (error) {
            console.error('❌ Failed to create DriveSource:', error);
        }
    }

    // Era chips. Horizontally scrollable rather than wrapped, so adding a
    // sixth folder doesn't reflow the sheet — and a row that scrolls sideways
    // is a pattern a thumb already understands.
    populateMenu() {
        const rail = document.getElementById('records-eras');
        if (!rail || !this.driveSource) return;

        rail.innerHTML = '';

        // Favourites leads the rail. It's the one list that's yours rather
        // than a fixed slice of the collection, and putting it first means
        // it's the first thing under your thumb on a phone.
        const fav = document.createElement('button');
        fav.className = 'records-chip records-chip--fav';
        fav.dataset.folderId = FAVOURITES;
        fav.setAttribute('role', 'tab');
        fav.setAttribute('aria-selected', 'false');
        fav.innerHTML = `
            <svg class="records-chip__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 20.7l-1.5-1.35C5.4 14.75 2 11.7 2 7.95 2 5.4 4 3.4 6.5 3.4c1.4 0 2.8.66 3.7 1.7l1.8 2.06 1.8-2.06c.9-1.04 2.3-1.7 3.7-1.7 2.5 0 4.5 2 4.5 4.55 0 3.75-3.4 6.8-8.5 11.4L12 20.7z"/>
            </svg><span>Favourites</span>`;
        rail.appendChild(fav);

        this.driveSource.getFolders().forEach((folder) => {
            const chip = document.createElement('button');
            chip.className = 'records-chip';
            chip.dataset.folderId = folder.id;
            chip.setAttribute('role', 'tab');
            chip.setAttribute('aria-selected', 'false');
            chip.textContent = folder.label;
            rail.appendChild(chip);
        });
    }

    setup() {
        const eraBtn = document.getElementById('records-btn');
        const sheet  = document.getElementById('records-sheet-el');
        if (!eraBtn || !sheet) return;

        eraBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.isOpen() ? this.closeSheet() : this.openSheet();
        });

        document.getElementById('records-close-btn')?.addEventListener('click', () => this.closeSheet());
        document.getElementById('records-scrim')?.addEventListener('click', () => this.closeSheet());

        // Chip → load that era in place. No navigation, no view swap.
        document.getElementById('records-eras')?.addEventListener('click', async (e) => {
            const chip = e.target.closest('.records-chip');
            if (!chip?.dataset.folderId) return;
            await this.showEra(chip.dataset.folderId);
        });

        // Refresh listing — busts the server-side TTL cache for this folder.
        document.getElementById('records-refresh-btn')?.addEventListener('click', async () => {
            if (!this.viewingSource || this.viewingSource === 'local') return;
            const btn = document.getElementById('records-refresh-btn');
            btn?.classList.add('is-spinning');
            try {
                await fetch(`${PROXY_URL}?action=refresh&folder=${encodeURIComponent(this.viewingSource)}`);
                this.driveSource?.cachedTracks?.delete(this.viewingSource);
                await this.showEra(this.viewingSource);
            } catch (err) {
                console.error('Refresh failed:', err);
            }
            btn?.classList.remove('is-spinning');
        });

        document.getElementById('records-list')?.addEventListener('click', async (e) => {
            const item = e.target.closest('.records-row');
            if (!item) return;
            const idx = parseInt(item.dataset.index, 10);
            if (isNaN(idx)) return;
            await this.#playFromView(idx);
        });

        document.getElementById('records-search-input')?.addEventListener('input', (e) => {
            this.#filterTracks(e.target.value);
        });

        this.#setupFavTools();
    }

    // ===== import / export =====
    //
    // Favourites live in this browser's storage, so there is no account to
    // sync through — a file is the transfer medium. Export writes one, import
    // merges one in rather than replacing, so moving a list between two
    // browsers you actually use isn't a one-way trip.
    #setupFavTools() {
        document.getElementById('fav-export-btn')?.addEventListener('click', () => {
            const favs = this.player.favourites;
            if (favs.count === 0) return;

            const blob = new Blob([JSON.stringify(favs.exportPayload(), null, 2)],
                { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = favs.exportFilename();
            document.body.appendChild(a);
            a.click();
            a.remove();
            // Revoked on a later turn of the loop: revoking synchronously
            // can cancel the download in some browsers before it starts.
            setTimeout(() => URL.revokeObjectURL(url), 10000);

            this.player.showToast(`Exported ${favs.count} favourite${favs.count === 1 ? '' : 's'}`);
        });

        const file = document.getElementById('fav-import-file');

        document.getElementById('fav-import-btn')?.addEventListener('click', () => file?.click());

        file?.addEventListener('change', async () => {
            const chosen = file.files?.[0];
            // Reset first, so picking the same file twice still fires change.
            file.value = '';
            if (!chosen) return;

            try {
                const text = await chosen.text();
                const { added, skipped } = this.player.favourites.import(text);
                await this.refreshFavouritesView();
                this.player.updateFavouriteButton();

                if (added === 0) {
                    this.player.showToast(
                        skipped ? 'Already had every favourite in that file.' : 'Nothing to import.');
                } else {
                    this.player.showToast(
                        `Imported ${added} favourite${added === 1 ? '' : 's'}` +
                        (skipped ? ` (${skipped} already saved)` : ''), 4000);
                }
            } catch (err) {
                this.player.showToast(err.message || "Couldn't read that file.", 5000);
            }
        });
    }

    // ===== sheet open/close =====

    isOpen() {
        return document.getElementById('records-sheet-el')?.classList.contains('open') === true;
    }

    async openSheet() {
        const sheet = document.getElementById('records-sheet-el');
        const scrim = document.getElementById('records-scrim');
        if (!sheet) return;

        // `hidden` comes off before the class goes on so the element has a
        // layout box to animate from — toggling both in the same frame would
        // paint it already-open.
        sheet.hidden = false;
        if (scrim) scrim.hidden = false;
        requestAnimationFrame(() => {
            sheet.classList.add('open');
            scrim?.classList.add('open');
        });
        document.getElementById('records-btn')?.setAttribute('aria-expanded', 'true');
        document.body.classList.add('records-open');

        // Land on the era you're actually listening to. Falling back to the
        // first folder matters on a cold boot, where currentSource may still
        // be 'local' from the offline fallback.
        const target = (this.player.currentSource === FAVOURITES
                || this.#isKnownFolder(this.player.currentSource))
            ? this.player.currentSource
            : this.driveSource?.getFolders()[0]?.id;

        if (target && target !== this.viewingSource) {
            await this.showEra(target);
        } else {
            this.#renderTracksList();
        }
    }

    closeSheet() {
        const sheet = document.getElementById('records-sheet-el');
        const scrim = document.getElementById('records-scrim');
        if (!sheet) return;

        sheet.classList.remove('open');
        scrim?.classList.remove('open');
        document.getElementById('records-btn')?.setAttribute('aria-expanded', 'false');
        document.body.classList.remove('records-open');

        // Wait out the slide-down before hiding, or the sheet vanishes
        // instead of leaving. Guarded by a class check so a rapid
        // close → open doesn't hide the sheet we've just reopened.
        setTimeout(() => {
            if (!sheet.classList.contains('open')) {
                sheet.hidden = true;
                if (scrim) scrim.hidden = true;
            }
        }, 280);
    }

    // ===== era rendering =====

    async showEra(source) {
        let tracks;
        if (source === FAVOURITES) {
            tracks = await this.#loadFavourites();
        } else if (source === 'local') {
            tracks = this.player.localTracks;
        } else {
            tracks = await this.#loadDriveListing(source);
        }

        this.viewingSource = source;
        this.viewingTracks = tracks;

        const titleEl = document.getElementById('records-title');
        if (titleEl) titleEl.textContent = this.#labelFor(source);

        const refreshBtn = document.getElementById('records-refresh-btn');
        if (refreshBtn) refreshBtn.hidden = (source === 'local' || source === FAVOURITES);

        this.#updateFavTools();

        // Clear search before render so we don't show a filtered list.
        const search = document.getElementById('records-search-input');
        if (search) search.value = '';

        this.#markActiveChip();
        this.#renderTracksList();
    }

    #markActiveChip() {
        document.querySelectorAll('.records-chip').forEach((chip) => {
            const on = chip.dataset.folderId === this.viewingSource;
            chip.classList.toggle('is-active', on);
            chip.setAttribute('aria-selected', String(on));
        });
    }

    #isKnownFolder(id) {
        return !!this.driveSource?.getFolders().some((f) => f.id === id);
    }

    // Turn stored favourites into playable tracks.
    //
    // A saved entry holds the filename, not a track number, because a Drive
    // re-listing renumbers everything. So each era that has favourites in it
    // gets its listing fetched once (DriveSource caches, so this is usually
    // free) and entries are matched by key.
    //
    // An entry whose file no longer exists is kept in the list rather than
    // dropped — a folder that failed to load would otherwise quietly delete
    // favourites — but rendered as unavailable and not playable.
    async #loadFavourites() {
        this.listingError = null;
        const saved = this.player.favourites.list();
        if (saved.length === 0) return [];

        const eras = [...new Set(saved.map((e) => e.e).filter(Boolean))];
        const byKey = new Map();

        for (const label of eras) {
            const folder = this.driveSource?.getFolders().find((f) => f.label === label);
            if (!folder) continue;
            try {
                const tracks = await this.driveSource.fetchTracks(folder.id);
                tracks.forEach((t, i) => {
                    // Carry the era and its index home with the track so
                    // playing from this list can switch source and land on
                    // the right record.
                    byKey.set(trackKey(t), { ...t, era: label, eraIndex: i });
                });
            } catch (err) {
                console.warn(`Favourites: couldn't read era ${label}:`, err.message);
            }
        }

        return saved.map((entry) => {
            const found = byKey.get(entry.k);
            if (found) return found;
            // Unresolved: render from the cached display text so the row
            // still says what it is.
            return {
                id: 0,
                title: entry.title || entry.k,
                artist: entry.artist || '',
                version: entry.version || null,
                album: 'Favourites',
                duration: '0:00',
                image: null,
                audio: null,
                colors: null,
                fileName: entry.k,
                era: entry.e || null,
                missing: true,
            };
        });
    }

    // Re-render in place after the list changed underneath us (the heart on
    // the artwork can remove the very row you're looking at).
    async refreshFavouritesView() {
        if (this.viewingSource !== FAVOURITES) return;
        this.viewingTracks = await this.#loadFavourites();
        this.#updateFavTools();
        this.#renderTracksList();
    }

    // Export only when there is something to export; import always, because
    // the browser that most needs to import is the one with nothing in it.
    #updateFavTools() {
        const tools = document.getElementById('fav-tools');
        if (!tools) return;
        const favs = this.player.favourites;
        const onFavs = this.viewingSource === FAVOURITES;
        tools.hidden = !onFavs;

        const exportBtn = document.getElementById('fav-export-btn');
        if (exportBtn) exportBtn.hidden = favs.count === 0;

        // Say it out loud when the list can't be kept. Every crbntyp app is
        // served from crbntyp.com, so they share one ~5MB localStorage
        // bucket — a neighbour that caches heavily can fill it and leave
        // nothing for this. Warning in the console only would mean the user
        // discovers it when their favourites are already gone.
        const warn = document.getElementById('fav-warning');
        if (!warn) return;
        const atRisk = onFavs && favs.count > 0 && favs.isAtRisk();
        warn.hidden = !atRisk;
        if (atRisk) {
            warn.textContent = favs.storageMode === 'session'
                ? "Storage on this site is full, so these are only held until you close the tab. Export to keep them."
                : "These couldn't be saved — storage on this site is full. Export to keep them.";
        }
    }

    async #loadDriveListing(folderId) {
        this.listingError = null;
        try {
            return await this.driveSource.fetchTracks(folderId);
        } catch (err) {
            console.error('Failed to load Drive listing:', err);
            // Kept so #renderTracksList can explain the empty state rather
            // than claiming the folder has no tracks in it.
            this.listingError = err.message;
            return [];
        }
    }

    #renderTracksList() {
        const list = document.getElementById('records-list');
        if (!list) return;
        list.innerHTML = '';

        if (this.viewingTracks.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'records-empty';
            empty.textContent = this.listingError
                || (this.viewingSource === FAVOURITES
                    ? 'No favourites yet. Tap the heart on a record to save it.'
                    : 'No records in here.');
            list.appendChild(empty);
            this.#updateCount();
            return;
        }

        const isCurrentSource = this.viewingSource === this.player.currentSource;

        this.viewingTracks.forEach((track, index) => {
            const isCurrent = isCurrentSource && index === this.player.currentTrackIndex;

            const item = document.createElement('button');
            item.className = 'records-row';
            item.dataset.index = String(index);
            // Stash searchable text so the filter doesn't keep
            // re-querying the DOM for it.
            item.dataset.search = `${track.title} ${track.artist || ''} ${track.version || ''}`.toLowerCase();
            if (track.missing) {
                item.classList.add('records-row--missing');
                item.title = 'This file is no longer in its era';
            }
            if (isCurrent) {
                item.classList.add('records-row--current');
                // Drives the equaliser. Paused shows the same sleeve, still —
                // the record is on the deck either way.
                if (this.player.isPlaying) item.classList.add('records-row--playing');
            }

            // The sleeve, at list size. Resolved through the same call the
            // turntable uses, so the thumbnail here and the artwork there are
            // guaranteed to be the same image — which only holds because the
            // sleeve is hashed from the track's identity rather than picked
            // at random (see Player.resolveArtwork).
            //
            // The track number stays, underneath: hash links are #<era>/<n>,
            // so that number is the track's address and is what you'd share.
            const art = this.player.resolveArtwork(track);
            const sleeve = art?.thumb
                ? `<img class="records-row__sleeve" src="${escapeHtml(art.thumb)}" alt="" loading="lazy" decoding="async" />`
                : '<span class="records-row__sleeve records-row__sleeve--blank" aria-hidden="true"></span>';

            // Drive listings have no duration until a file is streamed, so
            // they arrive as "0:00" — showing that in every row is worse than
            // showing nothing.
            const hasDuration = track.duration && track.duration !== '0:00';
            const tail = isCurrent && this.player.isPlaying
                ? '<span class="records-row__eq" aria-label="Now playing"><i></i><i></i><i></i></span>'
                : hasDuration
                    ? `<span class="records-row__time">${escapeHtml(track.duration)}</span>`
                    : '';

            // Mix version gets its own treatment rather than being swallowed
            // into the title — in this genre the remix *is* which record it is.
            const version = track.version
                ? `<span class="records-row__version">${escapeHtml(track.version)}</span>`
                : '';

            item.innerHTML = `
                <span class="records-row__art">
                    ${sleeve}
                    <span class="records-row__num">${String(index + 1).padStart(2, '0')}</span>
                </span>
                <span class="records-row__meta">
                    <span class="records-row__title">${escapeHtml(track.title || 'Untitled')}</span>
                    <span class="records-row__sub">
                        <span class="records-row__artist">${escapeHtml(track.artist || 'Unknown artist')}</span>
                        ${version}
                    </span>
                </span>
                ${tail}
            `;
            list.appendChild(item);
        });

        this.#updateCount();

        // Scroll the current track into view so the user lands on
        // where they are, not at the top of an arbitrary listing.
        const current = list.querySelector('.records-row--current');
        if (current) current.scrollIntoView({ block: 'center' });
    }

    // Track count doubles as search feedback: "47 tracks" normally, "12 of 47"
    // while filtering, "nothing matching" when a search excludes everything.
    #updateCount(matches = null) {
        const el = document.getElementById('records-count-el');
        if (!el) return;

        const total = this.viewingTracks.length;
        if (matches === null || matches === total) {
            el.textContent = total === 1 ? '1 track' : `${total} tracks`;
        } else if (matches === 0) {
            el.textContent = 'nothing matching';
        } else {
            el.textContent = `${matches} of ${total}`;
        }
    }

    #filterTracks(query) {
        const q = query.trim().toLowerCase();
        let matches = 0;

        document.querySelectorAll('#records-list .records-row').forEach((item) => {
            const hit = !q || item.dataset.search.includes(q);
            item.hidden = !hit;
            if (hit) matches++;
        });

        this.#updateCount(q ? matches : null);
    }

    // ===== source switching =====
    //
    // Public hooks used by hash-router on initial load and by
    // persistence-restore — they bypass the sheet entirely.

    async switchToLocal({ startIndex = 0, autoplay = false } = {}) {
        if (this.player.currentSource === 'local') return;

        this.player.currentSource = 'local';
        this.player.pause();
        this.player.tracks = [...this.player.localTracks];

        if (this.player.tracks.length > 0) {
            this.player.loadTrack(startIndex, autoplay);
        }
    }

    async switchToDrive(folderId, { startIndex = 0, autoplay = false } = {}) {
        // Already on this folder — nothing to switch to. The old condition
        // read `&& !cachedTracks.has(folderId)`, which inverted the meaning:
        // re-entering the folder you were already on, *while cached*, fell
        // through and reset you to track 0.
        if (this.player.currentSource === folderId) return;

        this.player.showLoadingState('Loading from Google Drive…');
        try {
            this.player.pause();
            const driveTracks = await this.driveSource.fetchTracks(folderId);
            if (driveTracks.length === 0) {
                this.player.hideLoadingState();
                this.player.showToast('No audio files found in this folder.');
                return;
            }
            this.player.currentSource = folderId;
            this.player.tracks = driveTracks;
            this.player.loadTrack(startIndex, autoplay);
            this.player.showToast(`${driveTracks.length} songs loaded`);
        } catch (error) {
            console.error('Failed to load from Drive:', error);
            this.player.showToast(`Couldn't load tracks: ${error.message}`, 5000);
        }
        this.player.hideLoadingState();
    }

    async #playFromView(index) {
        const track = this.viewingTracks[index];
        if (track?.missing) {
            this.player.showToast("That file isn't in its era any more.");
            return;
        }

        const sameSource = this.viewingSource === this.player.currentSource;

        if (!sameSource) {
            if (this.viewingSource === FAVOURITES) {
                await this.switchToFavourites({ startIndex: index, autoplay: true });
            } else if (this.viewingSource === 'local') {
                await this.switchToLocal({ startIndex: index, autoplay: true });
            } else {
                await this.switchToDrive(this.viewingSource, { startIndex: index, autoplay: true });
            }
        } else {
            this.player.loadTrack(index, /* autoplay */ true);
        }

        this.closeSheet();
    }

    // Playing a favourite makes the favourites the queue, so next and prev
    // walk your list. Dropping you into the track's own era instead would
    // mean a saved list you can open but never actually listen through.
    async switchToFavourites({ startIndex = 0, autoplay = false } = {}) {
        const tracks = (this.viewingSource === FAVOURITES && this.viewingTracks.length)
            ? this.viewingTracks
            : await this.#loadFavourites();

        const playable = tracks.filter((t) => !t.missing);
        if (playable.length === 0) {
            this.player.showToast('Nothing in favourites to play yet.');
            return;
        }

        // The clicked index refers to the rendered list, which may include
        // unavailable rows; map it onto the playable queue.
        const clicked = tracks[startIndex];
        const target = Math.max(0, playable.findIndex((t) => trackKey(t) === trackKey(clicked || {})));

        this.player.pause();
        this.player.currentSource = FAVOURITES;
        this.player.tracks = playable;
        this.player.loadTrack(target, autoplay);
    }

    #labelFor(source) {
        if (source === FAVOURITES) return 'Favourites';
        if (source === 'local') return 'Local Tracks';
        const folder = this.driveSource?.getFolders().find((f) => f.id === source);
        return folder?.label || 'Records';
    }
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
