// Turn a raw audio filename into a clean { artist, title, version }.
//
// Examples:
//   CM-Dream_Universe_original_mix.mp3
//     → { artist: "CM", title: "Dream Universe", version: "Original Mix" }
//   taiko_-_silence_(club_mix)-nme.mp3
//     → { artist: "Taiko", title: "Silence", version: "Club Mix", suffix: "NME" }
//   01 - Green Velvet - Flash (DJ Elite That Fuct Camera Mix).mp3
//     → { artist: "Green Velvet", title: "Flash", version: "DJ Elite That Fuct Camera Mix" }
//
// Used by drive.js (Drive filenames) and the local track flow when ID3
// tags are missing or weak. Returns a plain object — Player code can
// pick whichever fields it wants to render.

// Words that stay lower-case mid-title (English conjunctions / preps).
// First and last word are always capitalised regardless.
const STOPWORDS = new Set([
    'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of',
    'on', 'or', 'the', 'to', 'vs', 'via', 'with',
]);

// Tokens that should stay UPPERCASE no matter what (acronyms, labels).
const ACRONYMS = new Set([
    'DJ', 'MC', 'FM', 'EP', 'LP', 'CD', 'NYC', 'LA', 'UK', 'USA',
    'EU', 'NME', 'BBC', 'ID', 'OST', 'EDM',
]);

// Mix-version keywords that hint a phrase should be promoted into the
// `version` field if it appears at the end of the title.
const MIX_KEYWORDS = /(mix|remix|edit|version|dub|extended|original|club|radio|instrumental|acapella|bootleg|rework|reconstruction|reconstructed|refix|recut|rebuild|reinterpretation|reinterpreted|vip|flip|treatment|mashup|mash|live|session|rerub)/i;

const AUDIO_EXT = /\.(mp3|wav|flac|ogg|opus|m4a|aac|webm)$/i;
const TRACK_NUM_PREFIX = /^\s*\d{1,3}\s*[-_.\s]\s*/;

// Title-case one word with stoplist + acronym exceptions.
function titleCaseWord(word, isFirst, isLast) {
    if (!word) return word;
    const up = word.toUpperCase();
    if (ACRONYMS.has(up)) return up;
    const lower = word.toLowerCase();
    if (!isFirst && !isLast && STOPWORDS.has(lower)) return lower;
    // Preserve mid-word capitals if they look intentional (e.g. "iPad").
    if (/^[a-z][A-Z]/.test(word)) return word;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function titleCase(input) {
    if (!input) return '';
    const trimmed = input.trim();
    if (!trimmed) return '';
    // Split on whitespace AND on hyphens, but keep the hyphens so we can
    // reassemble: "rodd-y-ler" → "Rodd-Y-Ler", not "Roddyler".
    const pieces = trimmed.split(/(\s+|-)/);
    const wordIdxs = pieces
        .map((p, i) => (/^[A-Za-z0-9]+$/.test(p) ? i : -1))
        .filter((i) => i !== -1);

    return pieces
        .map((p, i) => {
            if (!/^[A-Za-z0-9]+$/.test(p)) return p;
            const isFirst = i === wordIdxs[0];
            const isLast = i === wordIdxs[wordIdxs.length - 1];
            return titleCaseWord(p, isFirst, isLast);
        })
        .join('');
}

// Replace underscores with spaces, collapse repeated separators, trim.
function normalizeSeparators(s) {
    return s
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\s+-\s+/g, ' - ') // tidy any "Artist  -  Title"
        .trim();
}

// Sentence-case for the mix-label sub-line: only the first word is
// capitalised, the rest go lowercase. Acronyms (DJ, FM, …) stay upper.
function sentenceCase(input) {
    if (!input) return '';
    const trimmed = input.trim();
    if (!trimmed) return '';
    const pieces = trimmed.split(/(\s+|-)/);
    const wordIdxs = pieces
        .map((p, i) => (/^[A-Za-z0-9]+$/.test(p) ? i : -1))
        .filter((i) => i !== -1);
    return pieces
        .map((p, i) => {
            if (!/^[A-Za-z0-9]+$/.test(p)) return p;
            const up = p.toUpperCase();
            if (ACRONYMS.has(up)) return up;
            const isFirst = i === wordIdxs[0];
            return isFirst
                ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
                : p.toLowerCase();
        })
        .join('');
}

// Phrases that ARE meaningful content even when sat alongside a mix label —
// usually featured-artist credits. We never strip these.
const CREDIT_RE = /\b(feat|ft|featuring|with|prod|produced|presents|pres)\b\.?/i;

// Pull mix labels out of the title. Once a mix-keyword parenthetical is
// found, ALL other parentheticals are stripped too (except featured-artist
// credits) — that's how we collapse jank like
// "Deep (I M Falling Deeper) (Ariel Vocal Mix).mp3" down to a clean
// title + version, rather than dragging the stray paren into the title.
function extractVersion(s) {
    const groups = [...s.matchAll(/[\(\[]([^()\[\]]+)[\)\]]/g)];
    let version = null;
    let stripped = s;
    const hasMix = groups.some((m) => MIX_KEYWORDS.test(m[1]));

    for (const m of groups) {
        const inner = m[1];
        if (MIX_KEYWORDS.test(inner)) {
            if (version === null) version = inner;
            stripped = stripped.replace(m[0], '');
        } else if (hasMix && !CREDIT_RE.test(inner)) {
            // Secondary paren with no mix term and no artist credit — drop it.
            stripped = stripped.replace(m[0], '');
        }
    }

    // Tidy whitespace AND trailing connector punctuation left behind after
    // stripping (e.g. "Foo (bar) - " → "Foo").
    stripped = stripped
        .replace(/\s+/g, ' ')
        .replace(/\s*[-–—]\s*$/, '')
        .trim();

    return {
        stripped,
        version: version ? sentenceCase(normalizeSeparators(version)) : null,
    };
}

export function formatTrackName(filename) {
    if (!filename) return { artist: 'Unknown Artist', title: '', version: null };

    // Strip extension and any leading "01 - " track number.
    let name = filename.replace(AUDIO_EXT, '').replace(TRACK_NUM_PREFIX, '');

    // Normalise underscores up front so the rest of the matching is
    // working on space-separated tokens.
    name = normalizeSeparators(name);

    // Pull parenthetical mix-name out before splitting Artist/Title so a
    // dash inside the mix label can't confuse the separator hunt.
    const { stripped: noVersion, version } = extractVersion(name);

    // Find a separator between artist and title. " - " is the canonical
    // form once we've normalised; also accept " – ", " — ".
    let artist = 'Unknown Artist';
    let title = noVersion;
    const sepMatch = noVersion.match(/\s+[-–—]\s+/);
    if (sepMatch) {
        const i = sepMatch.index;
        artist = noVersion.slice(0, i);
        title = noVersion.slice(i + sepMatch[0].length);
    } else {
        // No separator at all — try a single hyphen with no spaces
        // (e.g. "CM-Dream Universe"). Only first occurrence so artist
        // names with internal hyphens (Rodd-Y-Ler) survive when there
        // IS a real separator elsewhere.
        const dash = noVersion.indexOf('-');
        if (dash > 0 && dash < noVersion.length - 1) {
            artist = noVersion.slice(0, dash);
            title = noVersion.slice(dash + 1);
        }
    }

    return {
        artist: titleCase(artist),
        title:  titleCase(title),
        version,
    };
}
