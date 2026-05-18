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
                <i class="las la-calendar"></i>
                <span>${folder.label}</span>
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
            const item = e.target.closest('.era-track-item');
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
        if (this.player.currentSource === folderId && !this.driveSource?.cachedTracks?.has(folderId)) {
            return;
        }

        this.player.showLoadingState('Loading from Google Drive…');
        try {
            this.player.pause();
            const driveTracks = await this.driveSource.fetchTracks(folderId);
            if (driveTracks.length === 0) {
                this.player.hideLoadingState();
                alert('No audio files found in this folder.');
                return;
            }
            this.player.currentSource = folderId;
            this.player.tracks = driveTracks;
            this.player.loadTrack(startIndex, autoplay);
            this.player.showToast(`${driveTracks.length} songs loaded`);
        } catch (error) {
            console.error('Failed to load from Drive:', error);
            alert(`Failed to load tracks: ${error.message}`);
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
        try {
            return await this.driveSource.fetchTracks(folderId);
        } catch (err) {
            console.error('Failed to load Drive listing:', err);
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
            empty.textContent = 'No tracks found.';
            list.appendChild(empty);
            return;
        }

        const isCurrentSource = this.viewingSource === this.player.currentSource;

        this.viewingTracks.forEach((track, index) => {
            const item = document.createElement('button');
            item.className = 'era-track-item';
            item.dataset.index = String(index);
            // Stash searchable text so the filter doesn't keep
            // re-querying the DOM for it.
            item.dataset.search = `${track.title} ${track.artist || ''}`.toLowerCase();

            if (isCurrentSource && index === this.player.currentTrackIndex) {
                item.classList.add('era-track-item--current');
            }

            item.innerHTML = `
                <div class="era-track-item__title">${escapeHtml(track.title || '')}${
                    track.version ? `<span class="era-track-item__version"> (${escapeHtml(track.version)})</span>` : ''
                }</div>
                <div class="era-track-item__artist">${escapeHtml(track.artist || '')}</div>
            `;
            list.appendChild(item);
        });

        // Scroll the current track into view so the user lands on
        // where they are, not at the top of an arbitrary listing.
        const current = list.querySelector('.era-track-item--current');
        if (current) current.scrollIntoView({ block: 'center' });
    }

    #filterTracks(query) {
        const q = query.trim().toLowerCase();
        document.querySelectorAll('#era-tracks-list .era-track-item').forEach((item) => {
            item.hidden = q && !item.dataset.search.includes(q);
        });
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
