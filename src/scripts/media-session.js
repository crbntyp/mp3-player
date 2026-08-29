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

    // Whatever the player is actually showing, which for a Drive track is a
    // sleeve rather than anything on the track itself.
    //
    // This read player.currentPlaceholder, a field that stopped existing when
    // artwork resolution was rewritten — so it fell through to track.image,
    // which is null for every Drive track, and the lock screen and CarPlay
    // showed no artwork at all. Nothing threw; the art was simply absent.
    let artworkUrl = this.player.currentArt?.cover || track.image;
    if (artworkUrl && !artworkUrl.startsWith('http')) {
      artworkUrl = new URL(artworkUrl, window.location.href).href;
    }

    // The mix matters as much as the title on a record like these, and the
    // lock screen is the one place there's room to say so.
    const title = track.version ? `${track.title} (${track.version})` : track.title;

    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist: track.artist,
      album: 'plyr',
      artwork: artworkUrl ? [{ src: artworkUrl, sizes: '1024x1024', type: 'image/jpeg' }] : [],
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
