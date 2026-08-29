// One key in browser storage, written defensively.
//
// Extracted from Persistence because favourites need exactly the same
// treatment and a second hand-rolled localStorage path would have been a
// second set of quota bugs. Every crbntyp app is served from one origin
// (crbntyp.com/plyr/, /gld/, /trckr/ …), so they share a single ~5MB
// localStorage bucket — a neighbour that caches aggressively can fill it and
// starve this app's small payload. That has actually happened here.
//
// So a write walks a ladder: try it, drop our own key and retry, fall back to
// sessionStorage, and finally warn once rather than failing invisibly forever.

export class KeyedStore {
    // `label` appears in the warning when storage gives out, so the console
    // says which feature just lost its home rather than "something failed".
    constructor(key, label = 'state') {
        this.key = key;
        this.label = label;
        this.warned = false;
        this.store = this.#pick();
    }

    // localStorage throws on access outright in some privacy modes, so probe
    // it rather than assuming the property is usable.
    #pick() {
        try {
            localStorage.getItem(this.key);
            return localStorage;
        } catch (_) {
            try {
                sessionStorage.getItem(this.key);
                return sessionStorage;
            } catch (_) {
                return null;
            }
        }
    }

    // True when the key holds something. Used to decide whether a feature
    // has any stored history at all, without parsing it.
    exists() {
        try {
            return (sessionStorage.getItem(this.key) ?? this.store?.getItem(this.key)) != null;
        } catch (_) {
            return false;
        }
    }

    read() {
        try {
            // Prefer a session value if one exists — it's the fresher write
            // whenever we've previously fallen back.
            return sessionStorage.getItem(this.key) ?? this.store?.getItem(this.key) ?? null;
        } catch (_) {
            return null;
        }
    }

    readJson(fallback) {
        const raw = this.read();
        if (!raw) return fallback;
        try {
            return JSON.parse(raw);
        } catch (_) {
            return fallback; // corrupt value — behave as if unset
        }
    }

    // Returns 'local' | 'session' | false, so a caller that cares can tell
    // the user their data won't survive the tab closing.
    write(payload) {
        if (this.#trySet(this.store, payload)) {
            return this.store === sessionStorage ? 'session' : 'local';
        }

        // Quota. Dropping our own key first frees whatever we previously
        // held, which is enough whenever we're the one at fault.
        try {
            this.store?.removeItem(this.key);
        } catch (_) { /* storage unavailable entirely */ }

        if (this.#trySet(this.store, payload)) {
            return this.store === sessionStorage ? 'session' : 'local';
        }

        // Still no room: sessionStorage has its own quota. Narrower — the
        // value dies with the tab — but better than losing the write.
        if (this.store !== sessionStorage && this.#trySet(sessionStorage, payload)) {
            this.#warn(
                `plyr: localStorage is full (shared across crbntyp apps on this origin) — ` +
                `${this.label} has fallen back to sessionStorage and will not survive closing the tab.`
            );
            this.store = sessionStorage;
            return 'session';
        }

        this.#warn(`plyr: could not persist ${this.label} (storage full or unavailable).`);
        return false;
    }

    writeJson(value) {
        return this.write(JSON.stringify(value));
    }

    remove() {
        for (const s of [this.store, sessionStorage]) {
            try { s?.removeItem(this.key); } catch (_) { /* nothing to do */ }
        }
    }

    #trySet(store, payload) {
        try {
            store.setItem(this.key, payload);
            return true;
        } catch (_) {
            return false;
        }
    }

    #warn(message) {
        if (this.warned) return;
        console.warn(message);
        this.warned = true;
    }
}
