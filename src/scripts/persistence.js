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
        // Which backing store writes go to. Starts as localStorage and is
        // downgraded to sessionStorage only if the shared origin quota is
        // exhausted (see #write).
        this.store = this.#pickStore();
        this.warned = false;
        this.state = this.#load();
        this.pendingSave = null;
    }

    // localStorage throws on access outright in some privacy modes, so probe
    // it rather than assuming the property is usable.
    #pickStore() {
        try {
            localStorage.getItem(STORAGE_KEY);
            return localStorage;
        } catch (_) {
            try {
                sessionStorage.getItem(STORAGE_KEY);
                return sessionStorage;
            } catch (_) {
                return null;
            }
        }
    }

    #load() {
        try {
            // Prefer a session value if one exists — it's the fresher write
            // whenever we've previously fallen back.
            const raw = sessionStorage.getItem(STORAGE_KEY) ?? this.store?.getItem(STORAGE_KEY);
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
        const payload = JSON.stringify(this.state);

        if (this.#trySet(this.store, payload)) return;

        // Quota. Every crbntyp app is served from one origin
        // (crbntyp.com/plyr/, /gld/, /trckr/ ...), so they all share a single
        // ~5MB localStorage bucket — a neighbour that caches aggressively can
        // fill it and starve this app's ~150 byte payload. Dropping our own
        // key first frees whatever we previously held, which is enough
        // whenever we're the one at fault.
        try {
            this.store?.removeItem(STORAGE_KEY);
        } catch (_) { /* storage unavailable entirely */ }

        if (this.#trySet(this.store, payload)) return;

        // Still no room: fall back to sessionStorage, which has its own quota.
        // Narrower (state dies with the tab) but far better than losing
        // volume, shuffle and resume position on every single write.
        if (this.store !== sessionStorage && this.#trySet(sessionStorage, payload)) {
            if (!this.warned) {
                console.warn(
                    'plyr: localStorage is full (shared across crbntyp apps on this origin) — ' +
                    'falling back to sessionStorage. Settings will not survive closing the tab.'
                );
                this.warned = true;
            }
            this.store = sessionStorage;
            return;
        }

        // Nothing worked — say so once rather than failing invisibly forever.
        if (!this.warned) {
            console.warn('plyr: could not persist player state (storage full or unavailable).');
            this.warned = true;
        }
    }

    #trySet(store, payload) {
        try {
            store.setItem(STORAGE_KEY, payload);
            return true;
        } catch (_) {
            return false;
        }
    }
}
