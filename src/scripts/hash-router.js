// URL hash routing: encode/decode the current track position so reloads and
// shared links land on the same place.
//
// Hash shape: #<source>/<track-number>  (1-based for human readability)
//   #local/3      → local tracks, track #3
//   #1998/12      → Drive folder labelled "1998", track #12

export class HashRouter {
  constructor(player) {
    this.player = player;
  }

  // Read the hash on init. Returns true if it loaded a track, false to let
  // the caller fall through to the default first-track behaviour.
  async load() {
    const hash = window.location.hash.slice(1);
    if (!hash) return false;

    const parts = hash.split('/');
    if (parts.length < 2) return false;

    const source = parts[0];
    const trackIndex = parseInt(parts[1]) - 1;
    if (isNaN(trackIndex) || trackIndex < 0) return false;

    console.log(`🔗 Loading from hash: ${source}/${trackIndex + 1}`);

    if (source === 'local') {
      if (trackIndex < this.player.tracks.length) {
        this.player.loadTrack(trackIndex);
        return true;
      }
    } else if (this.player.driveSource) {
      const folder = this.player.driveSource.getFolders().find((f) => f.label === source);
      if (folder) {
        await this.player.eraSelector.switchToDrive(folder.id);
        if (trackIndex < this.player.tracks.length) {
          this.player.loadTrack(trackIndex);
        }
        return true;
      }
    }
    return false;
  }

  // Rewrite the hash to match current state. Uses replaceState so the back
  // button isn't flooded with every track change.
  update() {
    let source = 'local';

    if (this.player.currentSource !== 'local' && this.player.driveSource) {
      const folder = this.player.driveSource
        .getFolders()
        .find((f) => f.id === this.player.currentSource);
      if (folder) source = folder.label;
    }

    const trackNum = this.player.currentTrackIndex + 1;
    history.replaceState(null, '', `#${source}/${trackNum}`);
  }
}
