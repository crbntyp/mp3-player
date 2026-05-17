// Media Session API integration — lock-screen / notification-shade controls
// and metadata. Wraps the navigator.mediaSession quirks (handlers that throw
// when unsupported, setPositionState being conditional) in one place.

export class MediaSession {
  constructor(player) {
    this.player = player;
    this.supported = 'mediaSession' in navigator;
  }

  setup() {
    if (!this.supported) {
      console.warn('Media Session API not supported');
      return;
    }

    const setHandler = (action, handler) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
        console.log(`✓ Media Session: ${action} supported`);
      } catch (e) {
        console.log(`✗ Media Session: ${action} not supported`);
      }
    };

    setHandler('play', () => this.player.play());
    setHandler('pause', () => this.player.pause());
    setHandler('previoustrack', () => this.player.previousTrack());
    setHandler('nexttrack', () => this.player.nextTrack());
    setHandler('seekto', (details) => {
      if (details.seekTime !== undefined) {
        this.player.audio.currentTime = details.seekTime;
      }
    });

    console.log('✓ Media Session API configured');
  }

  updateMetadata() {
    if (!this.supported) return;
    const track = this.player.tracks[this.player.currentTrackIndex];
    if (!track) return;

    let artworkUrl = track.image;
    if (this.player.currentPlaceholder) artworkUrl = this.player.currentPlaceholder.url;
    if (artworkUrl && !artworkUrl.startsWith('http')) {
      artworkUrl = new URL(artworkUrl, window.location.href).href;
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: 'plyr',
      artwork: artworkUrl ? [{ src: artworkUrl, sizes: '512x512', type: 'image/jpeg' }] : [],
    });
  }

  // Called from the audio timeupdate handler. Quietly swallows errors —
  // browsers throw if the position state is invalid (e.g. duration is 0),
  // and that's a non-fatal hiccup, not something users should ever see.
  updatePosition(duration) {
    if (!this.supported || !('setPositionState' in navigator.mediaSession)) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: this.player.audio.playbackRate,
        position: this.player.audio.currentTime,
      });
    } catch (e) {
      // ignore — invalid state, will retry next timeupdate
    }
  }
}
