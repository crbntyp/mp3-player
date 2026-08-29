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

    // iOS was showing skip-back/skip-forward 10s on the lock screen instead
    // of previous/next track, even though neither seek action was ever
    // registered. Safari picks the ±10s pair by default for a lone <audio>
    // element and only gives up the slots once those actions are explicitly
    // declined — setting a handler to null is how you say "this media has no
    // such action", which is different from never having mentioned it.
    //
    // seekto stays: it drives the scrubber, which is worth keeping and does
    // not compete for the two button slots.
    setHandler('seekbackward', null);
    setHandler('seekforward', null);

    this.configured = true;
    console.log('✓ Media Session API configured');
  }

  // Re-assert the handlers when playback starts.
  //
  // Safari can drop or re-evaluate the action set around the first real play
  // and around audio route changes, and the lock screen then reverts to
  // whatever it would have shown by default. Re-running setup() is cheap and
  // idempotent, so it's easier to just say it again than to work out exactly
  // when it was forgotten.
  reassert() {
    if (!this.supported) return;
    this.setup();
    this.updateMetadata();
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
