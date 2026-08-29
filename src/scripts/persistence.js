// localStorage persistence — single key, single shape.
//
// Reads on construction so the Player can use defaults synchronously
// during boot. Writes are debounced so we don't thrash the disk on every
// timeupdate tick — and there's an explicit flush() the Player can call
// on pagehide/unload to capture the final audio position.

// Bumped to v2 alongside the repeat-default fix — older keys had stale
// repeat/shuffle state from feature-testing that re-enabled itself on
// every visit. v2 starts everyone fresh.
//
// `repeat` was later dropped as a feature (playback is always continuous).
// Saved keys from that era may still carry the field; load() spreads over
// DEFAULTS, so an unknown key is simply carried and never read. No migration
// needed, and no reason to burn a v3 on it.
import { KeyedStore } from './utils/storage.js';

const STORAGE_KEY = 'plyr:state:v2';
const DEBOUNCE_MS = 500;

const DEFAULTS = Object.freeze({
    source:         'local',   // 'local' or a Drive folder id
    trackIndex:     0,
    audioPosition:  0,         // seconds — best-effort restore on canplay
    volume:         1,         // 0..1
    muted:          false,
    shuffle:        false,
});

export class Persistence {
    constructor() {
        // The quota ladder lives in KeyedStore now — favourites need the
        // same handling, and two hand-rolled localStorage paths would have
        // been two sets of quota bugs.
        this.store = new KeyedStore(STORAGE_KEY, 'player settings');
        this.state = this.#load();
        this.pendingSave = null;
    }

    #load() {
        // Merge with defaults so newly-added fields don't show up undefined
        // on first load after a deploy.
        return { ...DEFAULTS, ...this.store.readJson({}) };
    }

    // Patch + debounced write. Returns the merged state for chaining.
    save(patch) {
        Object.assign(this.state, patch);
        if (this.pendingSave) clearTimeout(this.pendingSave);
        this.pendingSave = setTimeout(() => {
            this.store.writeJson(this.state);
            this.pendingSave = null;
        }, DEBOUNCE_MS);
        return this.state;
    }

    // Synchronous write — call on pagehide so the last position is
    // captured even if the user closes the tab between debounce ticks.
    flush() {
        if (this.pendingSave) {
            clearTimeout(this.pendingSave);
            this.pendingSave = null;
        }
        this.store.writeJson(this.state);
    }
}
