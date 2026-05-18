// localStorage persistence — single key, single shape.
//
// Reads on construction so the Player can use defaults synchronously
// during boot. Writes are debounced so we don't thrash the disk on every
// timeupdate tick — and there's an explicit flush() the Player can call
// on pagehide/unload to capture the final audio position.

const STORAGE_KEY = 'plyr:state:v1';
const DEBOUNCE_MS = 500;

const DEFAULTS = Object.freeze({
    source:         'local',   // 'local' or a Drive folder id
    trackIndex:     0,
    audioPosition:  0,         // seconds — best-effort restore on canplay
    volume:         1,         // 0..1
    muted:          false,
    shuffle:        false,
    repeat:         'off',     // 'off' | 'one' | 'all'
});

export class Persistence {
    constructor() {
        this.state = this.#load();
        this.pendingSave = null;
    }

    #load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                // Merge with defaults so newly-added fields don't show up
                // undefined on first load after a deploy.
                return { ...DEFAULTS, ...parsed };
            }
        } catch (_) {
            // Corrupt JSON or storage disabled — fall through to defaults.
        }
        return { ...DEFAULTS };
    }

    // Patch + debounced write. Returns the merged state for chaining.
    save(patch) {
        Object.assign(this.state, patch);
        if (this.pendingSave) clearTimeout(this.pendingSave);
        this.pendingSave = setTimeout(() => {
            this.#write();
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
        this.#write();
    }

    #write() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
        } catch (_) {
            // Quota or privacy-mode storage — silently drop.
        }
    }
}
