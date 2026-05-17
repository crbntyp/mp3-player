// Era selector: the bolted-on dropdown that switches between local tracks
// and the Drive folder eras. Owns the Drive source initialisation and the
// source-switching logic.
//
// Scheduled for replacement by the library drawer in Phase 3 — isolated
// here so that future change is a single-file delete + rewire.

import { DriveSource } from './drive.js';

export class EraSelector {
  constructor(player) {
    this.player = player;
    this.driveSource = null;
  }

  init() {
    console.log('🔧 Initializing Drive source...');
    try {
      this.driveSource = new DriveSource();
      this.player.driveSource = this.driveSource;
      console.log('✓ Drive source initialized');
      console.log('📂 Folders:', this.driveSource.getFolders());
      this.populateMenu();
    } catch (error) {
      console.error('❌ Failed to create DriveSource:', error);
    }
  }

  populateMenu() {
    const menu = document.getElementById('era-menu');
    if (!menu) {
      console.error('❌ Era menu element not found');
      return;
    }
    if (!this.driveSource) return;

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
      menu.appendChild(btn);
    });

    console.log(`✓ Era menu populated with ${folders.length} folders`);
  }

  setup() {
    const eraBtn = document.getElementById('era-btn');
    const eraMenu = document.getElementById('era-menu');
    if (!eraBtn || !eraMenu) return;

    eraBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      eraMenu.classList.toggle('open');
    });

    // Click-outside dismissal.
    document.addEventListener('click', (e) => {
      if (!eraMenu.contains(e.target) && !eraBtn.contains(e.target)) {
        eraMenu.classList.remove('open');
      }
    });

    eraMenu.addEventListener('click', async (e) => {
      const option = e.target.closest('.era-option');
      if (!option) return;

      const source = option.dataset.source;
      const folderId = option.dataset.folderId;

      eraMenu.querySelectorAll('.era-option').forEach((opt) => opt.classList.remove('active'));
      option.classList.add('active');

      const label = document.getElementById('era-label');
      if (label) label.textContent = option.querySelector('span').textContent;

      eraMenu.classList.remove('open');

      if (source === 'local') {
        await this.switchToLocal();
      } else if (source === 'drive' && folderId) {
        await this.switchToDrive(folderId);
      }
    });
  }

  async switchToLocal() {
    if (this.player.currentSource === 'local') return;

    console.log('📂 Switching to local tracks...');
    this.player.currentSource = 'local';
    this.player.pause();
    this.player.tracks = [...this.player.localTracks];
    this.player.trackWheel.markDirty();

    if (this.player.tracks.length > 0) {
      this.player.loadTrack(0);
    }
    console.log(`✓ Loaded ${this.player.tracks.length} local track(s)`);
  }

  async switchToDrive(folderId) {
    if (this.player.currentSource === folderId) return;

    console.log(`📂 Switching to Drive folder: ${folderId}`);
    this.player.showLoadingState('Loading from Google Drive...');

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
      this.player.trackWheel.markDirty();
      this.player.loadTrack(0);

      console.log(`✓ Loaded ${this.player.tracks.length} track(s) from Drive`);
      this.player.showToast(`${this.player.tracks.length} songs loaded`);
    } catch (error) {
      console.error('Failed to load from Drive:', error);
      alert(`Failed to load tracks: ${error.message}`);
    }
    this.player.hideLoadingState();
  }
}
