// URL routing: encode/decode the current track position so reloads and
// shared links land on the same place.
//
// Hash shape: #<source>/<track-number>  (1-based for human readability)
//   #local/3      → local tracks, track #3
//   #1998/12      → Drive folder labelled "1998", track #12
//
// The same position is mirrored into the query string (?e=1998&t=12), and
// that is the half that makes link previews possible. A fragment is never
// sent to a server, so an unfurling crawler asking for a #-only link sees
// the bare app and cannot know which record was shared. The query reaches
// share.php, which resolves the track and emits the right Open Graph tags.
//
// Both are written, so whichever half of the URL someone copies works, and
// links shared before the query existed still open correctly.

export class HashRouter {
  constructor(player) {
    this.player = player;
  }

  // Read the hash on init. Returns true if it loaded a track, false to let
  // the caller fall through to the default first-track behaviour.
  async load() {
    const target = this.#readHash() || this.#readQuery();
    if (!target) return false;

    const { source, trackIndex } = target;

    console.log(`🔗 Loading from hash: ${source}/${trackIndex + 1}`);

    if (source === 'favourites') {
      // Favourites is a queue like an era, so it round-trips through the URL
      // the same way — a link to your 3rd favourite is a real place.
      await this.player.eraSelector.switchToFavourites({ startIndex: trackIndex });
      return this.player.tracks.length > 0;
    } else if (source === 'local') {
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

    if (this.player.currentSource === 'favourites') {
      source = 'favourites';
    } else if (this.player.currentSource !== 'local' && this.player.driveSource) {
      const folder = this.player.driveSource
        .getFolders()
        .find((f) => f.id === this.player.currentSource);
      if (folder) source = folder.label;
    }

    const trackNum = this.player.currentTrackIndex + 1;

    // Query first, then hash. The query is what a crawler can read, so
    // copying straight from the address bar produces a link that previews
    // — which is the only way this helps anyone who doesn't hunt for a
    // share button.
    const query = `?e=${encodeURIComponent(source)}&t=${trackNum}`;
    history.replaceState(null, '', `${query}#${source}/${trackNum}`);
  }

  // #<source>/<n>
  #readHash() {
    const hash = window.location.hash.slice(1);
    if (!hash) return null;
    const parts = hash.split('/');
    if (parts.length < 2) return null;
    return this.#toTarget(parts[0], parts[1]);
  }

  // ?e=<source>&t=<n> — how share.php addresses a track, and therefore how
  // a link that came back from a preview is shaped.
  #readQuery() {
    const params = new URLSearchParams(window.location.search);
    const e = params.get('e');
    const t = params.get('t');
    if (!e || !t) return null;
    return this.#toTarget(e, t);
  }

  #toTarget(source, num) {
    const trackIndex = parseInt(num, 10) - 1;
    if (!source || isNaN(trackIndex) || trackIndex < 0) return null;
    return { source, trackIndex };
  }
}
