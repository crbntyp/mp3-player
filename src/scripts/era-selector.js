// Era selector — two-state popup anchored bottom-left of the viewport.
//
// State A (eras): Local Tracks + the configured Drive folders.
// State B (tracks): the chosen folder's track list, with search + a
// refresh button that busts the server-side listing cache.
//
// Picking a track switches the player source (if needed) and loads
// that specific index, then closes the popup. State A is restored on
// next open so the user lands back at the picker.

import { DriveSource } from './drive.js';
import { formatTrackName } from './utils/format-track-name.js';

const PROXY_URL = 'proxy.php';

export class EraSelector {
    constructor(player) {
        this.player = player;
        this.driveSource = null;
        this.viewingSource = null;   // 'local' | <folderId> currently shown in tracks view
        this.viewingTracks = [];     // tracks rendered in tracks view
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

    populateMenu() {
        const erasView = document.querySelector('.era-menu-view--eras');
        if (!erasView || !this.driveSource) return;

        const folders = this.driveSource.getFolders();
        folders.forEach((folder) => {
            const btn = document.createElement('button');
            btn.className = 'era-option';
            btn.dataset.source = 'drive';
            btn.dataset.folderId = folder.id;
            btn.innerHTML = `
                <svg class="era-option-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <rect x="3" y="5" width="18" height="16" rx="2" />
                    <path d="M3 10h18M8 3v4M16 3v4" />
                </svg>
                <span>${escapeHtml(folder.label)}</span>
            `;
            erasView.appendChild(btn);
        });
    }

    setup() {
        const eraBtn = document.getElementById('era-btn');
        const eraMenu = document.getElementById('era-menu');
        if (!eraBtn || !eraMenu) return;

        eraBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const willOpen = !eraMenu.classList.contains('open');
            eraMenu.classList.toggle('open');
            if (willOpen) this.#showErasView(); // always reset to State A on open
        });

        // Click-outside dismissal.
        document.addEventListener('click', (e) => {
            if (!eraMenu.contains(e.target) && !eraBtn.contains(e.target)) {
                eraMenu.classList.remove('open');
            }
        });

        // Era option click → enter tracks view for that source.
        eraMenu.addEventListener('click', async (e) => {
            const option = e.target.closest('.era-option');
            if (!option) return;
            e.preventDefault();

            const source = option.dataset.source;
            const folderId = option.dataset.folderId;
            const label = option.querySelector('span')?.textContent || 'Tracks';

            if (source === 'local') {
                await this.#enterTracksView('local', label);
            } else if (source === 'drive' && folderId) {
                await this.#enterTracksView(folderId, label);
            }
        });

        // Back arrow → state A.
        document.getElementById('era-back-btn')?.addEventListener('click', () => {
            this.#showErasView();
        });

        // Refresh listing — only meaningful for Drive sources.
        document.getElementById('era-refresh-btn')?.addEventListener('click', async () => {
            if (!this.viewingSource || this.viewingSource === 'local') return;
            try {
                await fetch(`${PROXY_URL}?action=refresh&folder=${encodeURIComponent(this.viewingSource)}`);
                this.driveSource?.cachedTracks?.delete(this.viewingSource);
                await this.#enterTracksView(this.viewingSource, this.#labelFor(this.viewingSource));
            } catch (err) {
                console.error('Refresh failed:', err);
            }
        });

        // Track click → play that index, switching source if needed.
        document.getElementById('era-tracks-list')?.addEventListener('click', async (e) => {
            const item = e.target.closest('.crate-row');
            if (!item) return;
            const idx = parseInt(item.dataset.index, 10);
            if (isNaN(idx)) return;
            await this.#playFromView(idx);
        });

        // Search filter.
        document.getElementById('era-tracks-search')?.addEventListener('input', (e) => {
            this.#filterTracks(e.target.value);
        });
    }

    // Public source-switch hooks. Used by hash-router on initial load and
    // by persistence-restore — they bypass the popup entirely.
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

    // ===== popup view-state internals =====

    #showErasView() {
        const eras = document.querySelector('.era-menu-view--eras');
        const tracks = document.querySelector('.era-menu-view--tracks');
        if (eras) eras.hidden = false;
        if (tracks) tracks.hidden = true;
        // Mark the currently-active source so the user can see where they are.
        const activeSource = this.player.currentSource;
        document.querySelectorAll('.era-menu-view--eras .era-option').forEach((opt) => {
            const id = opt.dataset.folderId || opt.dataset.source;
            opt.classList.toggle('active', id === activeSource);
        });
    }

    async #enterTracksView(source, label) {
        const tracks = source === 'local'
            ? this.player.localTracks
            : await this.#loadDriveListing(source);

        this.viewingSource = source;
        this.viewingTracks = tracks;

        const titleEl = document.getElementById('era-tracks-title');
        if (titleEl) titleEl.textContent = label;

        // Hide refresh button for local — no server cache to bust.
        const refreshBtn = document.getElementById('era-refresh-btn');
        if (refreshBtn) refreshBtn.hidden = (source === 'local');

        // Clear search before render so we don't show a filtered list.
        const search = document.getElementById('era-tracks-search');
        if (search) search.value = '';

        this.#renderTracksList();
        document.querySelector('.era-menu-view--eras').hidden = true;
        document.querySelector('.era-menu-view--tracks').hidden = false;
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
        const list = document.getElementById('era-tracks-list');
        if (!list) return;
        list.innerHTML = '';

        if (this.viewingTracks.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'era-tracks-empty';
            empty.textContent = this.listingError || 'No tracks in this crate.';
            list.appendChild(empty);
            return;
        }

        const isCurrentSource = this.viewingSource === this.player.currentSource;

        this.viewingTracks.forEach((track, index) => {
            const isCurrent = isCurrentSource && index === this.player.currentTrackIndex;

            const item = document.createElement('button');
            item.className = 'crate-row';
            item.dataset.index = String(index);
            // Stash searchable text so the filter doesn't keep
            // re-querying the DOM for it.
            item.dataset.search = `${track.title} ${track.artist || ''} ${track.version || ''}`.toLowerCase();
            if (isCurrent) {
                item.classList.add('crate-row--current');
                // Drives the spinning label + equaliser. Paused shows the same
                // disc, still — the record is on the deck either way.
                if (this.player.isPlaying) item.classList.add('crate-row--playing');
            }

            // The index isn't decoration — it's the track's address. Hash
            // links are #<era>/<n>, so the number in this column is exactly
            // what you'd share. On the playing row it gives way to a spinning
            // label instead, because that's where the needle is.
            const slot = isCurrent
                ? '<span class="crate-row__disc" aria-hidden="true"></span>'
                : `<span class="crate-row__num">${String(index + 1).padStart(2, '0')}</span>`;

            // Drive listings have no duration until a file is streamed, so
            // they arrive as "0:00" — showing that in every row is worse than
            // showing nothing.
            const hasDuration = track.duration && track.duration !== '0:00';
            const tail = isCurrent && this.player.isPlaying
                ? '<span class="crate-row__eq" aria-label="Now playing"><i></i><i></i><i></i></span>'
                : hasDuration
                    ? `<span class="crate-row__time">${escapeHtml(track.duration)}</span>`
                    : '';

            // Mix version gets its own treatment rather than being swallowed
            // into the title — in this genre the remix *is* which record it is.
            const version = track.version
                ? `<span class="crate-row__version">${escapeHtml(track.version)}</span>`
                : '';

            item.innerHTML = `
                <span class="crate-row__slot">${slot}</span>
                <span class="crate-row__meta">
                    <span class="crate-row__title">${escapeHtml(track.title || 'Untitled')}</span>
                    <span class="crate-row__sub">
                        <span class="crate-row__artist">${escapeHtml(track.artist || 'Unknown artist')}</span>
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
        const current = list.querySelector('.crate-row--current');
        if (current) current.scrollIntoView({ block: 'center' });
    }

    // Track count doubles as search feedback: "47 tracks" normally, "12 of 47"
    // while filtering, "nothing matching" when a search excludes everything.
    #updateCount(matches = null) {
        const el = document.getElementById('era-tracks-count');
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

        document.querySelectorAll('#era-tracks-list .crate-row').forEach((item) => {
            const hit = !q || item.dataset.search.includes(q);
            item.hidden = !hit;
            if (hit) matches++;
        });

        this.#updateCount(q ? matches : null);
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

        // Dismiss the popup so the user is back to the player chrome.
        document.getElementById('era-menu')?.classList.remove('open');
    }

    #labelFor(source) {
        if (source === 'local') return 'Local Tracks';
        const folder = this.driveSource?.getFolders().find((f) => f.id === source);
        return folder?.label || 'Tracks';
    }
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
