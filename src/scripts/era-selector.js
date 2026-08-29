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

const PROXY_URL = 'proxy.php';

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
        const target = this.#isKnownFolder(this.player.currentSource)
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
        const tracks = source === 'local'
            ? this.player.localTracks
            : await this.#loadDriveListing(source);

        this.viewingSource = source;
        this.viewingTracks = tracks;

        const titleEl = document.getElementById('records-title');
        if (titleEl) titleEl.textContent = this.#labelFor(source);

        const refreshBtn = document.getElementById('records-refresh-btn');
        if (refreshBtn) refreshBtn.hidden = (source === 'local');

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
            empty.textContent = this.listingError || 'No records in here.';
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
        const sameSource = this.viewingSource === this.player.currentSource;

        if (!sameSource) {
            if (this.viewingSource === 'local') {
                await this.switchToLocal({ startIndex: index, autoplay: true });
            } else {
                await this.switchToDrive(this.viewingSource, { startIndex: index, autoplay: true });
            }
        } else {
            this.player.loadTrack(index, /* autoplay */ true);
        }

        this.closeSheet();
    }

    #labelFor(source) {
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
