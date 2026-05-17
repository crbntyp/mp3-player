// Track-wheel library overlay: scrollable vertical list of tracks with a
// fish-eye depth effect, scroll-snap, and momentum.
//
// Scheduled for replacement by the library drawer in Phase 3. Kept whole
// here so the eventual swap is a single-file removal + rewire.

export class TrackWheel {
  constructor(player) {
    this.player = player;
    this.rendered = false;
    this.scrollSetup = false;
    this.itemHeight = 0;
    this.offset = 0;
    this.selectedIndex = 0;
    this.snapping = false;
  }

  // Called by anything that changes player.tracks (era switch). Forces a
  // re-render on the next openTrackWheel() call.
  markDirty() {
    this.rendered = false;
  }

  render() {
    const wheel = document.getElementById('track-wheel');
    if (!wheel || this.rendered) return;
    wheel.innerHTML = '';

    // Matches CSS: 140 desktop, 110 mobile.
    this.itemHeight = window.innerWidth <= 768 ? 110 : 140;

    this.player.tracks.forEach((track, index) => {
      const item = document.createElement('div');
      item.className = 'track-wheel-item';
      item.dataset.index = index;
      item.innerHTML = `
        <div class="track-wheel-content">
          <div class="track-wheel-name">${track.title}</div>
          <div class="track-wheel-artist">${track.artist}</div>
        </div>
      `;
      item.addEventListener('click', () => this.selectTrack(index));
      wheel.appendChild(item);
    });

    this.rendered = true;
    this.selectedIndex = this.player.currentTrackIndex;
    this.offset = -this.player.currentTrackIndex * this.itemHeight;
    this.updatePosition();
  }

  updatePosition() {
    const wheel = document.getElementById('track-wheel');
    if (wheel) {
      wheel.style.transform = `translateY(${this.offset}px)`;
      this.updateDepth();
    }
  }

  // Fish-eye scaling: items further from the centre shrink and fade. Only
  // the centre and its two neighbours are visible — anything further is
  // hidden so it doesn't fight pointer events.
  updateDepth() {
    const items = document.querySelectorAll('.track-wheel-item');
    const centerIndex = -this.offset / this.itemHeight;

    items.forEach((item) => {
      const idx = parseInt(item.dataset.index);
      const distance = Math.abs(idx - centerIndex);

      if (distance > 1.5) {
        item.style.opacity = '0';
        item.style.pointerEvents = 'none';
      } else {
        const scale = distance < 0.5 ? 1.3 : 1.3 - distance * 0.6;
        const opacity = distance < 0.5 ? 1 : 1 - distance * 0.6;
        item.style.transform = `scale(${Math.max(0.7, scale)})`;
        item.style.opacity = Math.max(0.4, opacity);
        item.style.pointerEvents = 'auto';
      }

      item.classList.toggle('active', idx === this.player.currentTrackIndex);
    });
  }

  setupScroll() {
    const overlay = document.getElementById('track-wheel-overlay');
    if (!overlay || this.scrollSetup) return;

    let scrollTimeout;
    let touchLastY = 0;
    let velocity = 0;

    overlay.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.snapping = false;
        this.scrollBy(e.deltaY * 0.15);
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => this.snap(), 200);
      },
      { passive: false },
    );

    overlay.addEventListener(
      'touchstart',
      (e) => {
        touchLastY = e.touches[0].clientY;
        velocity = 0;
      },
      { passive: true },
    );

    overlay.addEventListener(
      'touchmove',
      (e) => {
        e.preventDefault();
        this.snapping = false;
        const touchY = e.touches[0].clientY;
        const deltaY = touchLastY - touchY;
        velocity = deltaY;
        touchLastY = touchY;
        this.scrollBy(deltaY * 0.5);
      },
      { passive: false },
    );

    overlay.addEventListener(
      'touchend',
      () => {
        if (Math.abs(velocity) > 5) this.scrollBy(velocity * 0.8);
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => this.snap(), 200);
      },
      { passive: true },
    );

    this.scrollSetup = true;
  }

  scrollBy(delta) {
    this.offset -= delta;
    const maxOffset = 0;
    const minOffset = -(this.player.tracks.length - 1) * this.itemHeight;
    this.offset = Math.max(minOffset, Math.min(maxOffset, this.offset));
    this.updatePosition();
  }

  snap() {
    const nearest = Math.round(-this.offset / this.itemHeight);
    const clamped = Math.max(0, Math.min(this.player.tracks.length - 1, nearest));
    const targetOffset = -clamped * this.itemHeight;

    this.snapping = true;
    const wheel = document.getElementById('track-wheel');
    if (wheel) wheel.classList.add('snapping');

    this.offset = targetOffset;
    this.selectedIndex = clamped;
    this.updatePosition();

    setTimeout(() => {
      if (wheel) wheel.classList.remove('snapping');
      this.snapping = false;
    }, 400);
  }

  open() {
    const overlay = document.getElementById('track-wheel-overlay');
    if (!overlay) return;
    this.render();
    this.setupScroll();
    this.offset = -this.player.currentTrackIndex * this.itemHeight;
    this.selectedIndex = this.player.currentTrackIndex;
    this.updatePosition();
    overlay.classList.add('open');
  }

  close() {
    const overlay = document.getElementById('track-wheel-overlay');
    if (overlay) overlay.classList.remove('open');
  }

  toggle() {
    const overlay = document.getElementById('track-wheel-overlay');
    if (overlay && overlay.classList.contains('open')) this.close();
    else this.open();
  }

  // Slide-in/out on track switch only when the record is already visible —
  // matches the next/prev animation feel rather than swapping abruptly.
  async selectTrack(index) {
    this.close();
    const wasPlaying = this.player.isPlaying;

    if (wasPlaying && this.player.recordAnimator.visible) {
      await this.player.recordAnimator.slideIn();
      this.player.loadTrack(index, true);
      this.markActive();
      await this.player.recordAnimator.slideOut();
    } else {
      this.player.loadTrack(index, true);
      this.markActive();
    }
  }

  markActive() {
    document.querySelectorAll('.track-item').forEach((item) => {
      const idx = parseInt(item.dataset.index);
      item.classList.toggle('active', idx === this.player.currentTrackIndex);
    });
  }
}
