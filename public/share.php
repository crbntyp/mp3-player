<?php
/**
 * Share cards — server-rendered Open Graph tags for a single track.
 *
 * Why this exists at all: the app addresses tracks with a URL fragment
 * (#1998/12), and browsers never send fragments to a server. When Slack,
 * WhatsApp, Discord or Twitter unfurl a link they fetch the URL without it,
 * see the generic app shell, and have no idea which record was shared. They
 * don't run JavaScript either, so the player can't set the tags itself.
 *
 * So a shared link carries the track in the query string (?e=1998&t=12),
 * .htaccess routes those requests here, and this file serves the *same*
 * index.html with the right meta tags injected into the head. No redirect:
 * a person following the link gets the app, a crawler gets the card, and
 * the URL in the address bar stays the one worth sharing.
 *
 * Resolving which sleeve to show is only possible because the player picks
 * a track's sleeve by hashing its filename rather than at random — the
 * fnv1a() below is a port of scripts/utils/track-key.js, and it has to keep
 * agreeing with it or the card shows different artwork to the player.
 */

error_reporting(0);
ini_set('display_errors', 0);

$here = __DIR__;

// --- inputs -----------------------------------------------------------

$eraLabel = isset($_GET['e']) ? (string)$_GET['e'] : '';
$trackNum = isset($_GET['t']) ? (int)$_GET['t'] : 0;

// --- shared data ------------------------------------------------------

function readJson($path) {
    if (!is_file($path)) return null;
    $raw = @file_get_contents($path);
    if ($raw === false) return null;
    return json_decode($raw, true);
}

$eras     = readJson($here . '/data/eras.json');
$sleeves  = readJson($here . '/data/placeholders.json');

$folderId = null;
foreach (($eras['eras'] ?? []) as $era) {
    if (($era['label'] ?? null) === $eraLabel) { $folderId = $era['id']; break; }
}

// --- filename → sleeve ------------------------------------------------

// FNV-1a, 32-bit. Port of hashString() in scripts/utils/track-key.js.
//
// Two things have to match JavaScript exactly or the card shows different
// artwork to the player:
//
//   1. PHP ints are 64-bit, so every step is masked back to 32 bits to
//      match JavaScript's >>> 0.
//   2. The string is walked as UTF-16 code units, not bytes. JS
//      charCodeAt() yields one unit for "ë" (0xEB); iterating the UTF-8
//      bytes in PHP yields two (0xC3, 0xAB) and diverges. Two of the 395
//      Drive filenames are Tiësto tracks, so this was not hypothetical.
function fnv1a($str) {
    $u = function_exists('mb_convert_encoding')
        ? mb_convert_encoding($str, 'UTF-16LE', 'UTF-8')
        : null;

    if ($u === null || $u === false) {
        // No mbstring: fall back to bytes. Correct for ASCII filenames,
        // which is all but a couple of them, and never fatal.
        $units = array_map('ord', str_split($str));
    } else {
        $units = [];
        for ($i = 0; $i + 1 < strlen($u); $i += 2) {
            $units[] = ord($u[$i]) | (ord($u[$i + 1]) << 8);
        }
    }

    $h = 0x811c9dc5;
    foreach ($units as $code) {
        $h ^= $code;
        $h = ($h + (($h << 1) & 0xFFFFFFFF) + (($h << 4) & 0xFFFFFFFF)
                 + (($h << 7) & 0xFFFFFFFF) + (($h << 8) & 0xFFFFFFFF)
                 + (($h << 24) & 0xFFFFFFFF)) & 0xFFFFFFFF;
    }
    return $h;
}

// --- filename → { artist, title, version } ----------------------------
//
// Port of scripts/utils/format-track-name.js. Kept structurally identical
// to that file so the two can be diffed by eye; verified against it over
// every real Drive filename by scripts/verify-share-parser.mjs.

const MIX_KEYWORDS = '/(mix|remix|edit|version|dub|extended|original|club|radio|instrumental|acapella|bootleg|rework|reconstruction|reconstructed|refix|recut|rebuild|reinterpretation|reinterpreted|vip|flip|treatment|mashup|mash|live|session|rerub)/i';
const CREDIT_RE    = '/\b(feat|ft|featuring|with|prod|produced|presents|pres)\b\.?/i';
const AUDIO_EXT    = '/\.(mp3|wav|flac|ogg|opus|m4a|aac|webm)$/i';
const TRACK_NUM_PREFIX = '/^\s*\d{1,3}\s*[-_.\s]\s*/';

function stopwords() {
    return ['a','an','and','as','at','but','by','for','in','of','on','or','the','to','vs','via','with'];
}
function acronyms() {
    return ['DJ','MC','FM','EP','LP','CD','NYC','LA','UK','USA','EU','NME','BBC','ID','OST','EDM'];
}

function titleCaseWord($word, $isFirst, $isLast) {
    if ($word === '') return $word;
    $up = strtoupper($word);
    if (in_array($up, acronyms(), true)) return $up;
    $lower = strtolower($word);
    if (!$isFirst && !$isLast && in_array($lower, stopwords(), true)) return $lower;
    if (preg_match('/^[a-z][A-Z]/', $word)) return $word;
    return strtoupper(substr($lower, 0, 1)) . substr($lower, 1);
}

// Split keeping separators, matching JS split(/(\s+|-)/).
function splitKeep($input) {
    return preg_split('/(\s+|-)/', $input, -1, PREG_SPLIT_DELIM_CAPTURE);
}

function wordIndexes($pieces) {
    $idx = [];
    foreach ($pieces as $i => $p) {
        if (preg_match('/^[A-Za-z0-9]+$/', $p)) $idx[] = $i;
    }
    return $idx;
}

function titleCaseStr($input) {
    if ($input === null) return '';
    $trimmed = trim($input);
    if ($trimmed === '') return '';
    $pieces = splitKeep($trimmed);
    $idx = wordIndexes($pieces);
    if (!$idx) return $trimmed;
    $first = $idx[0]; $last = $idx[count($idx) - 1];
    $out = '';
    foreach ($pieces as $i => $p) {
        if (!preg_match('/^[A-Za-z0-9]+$/', $p)) { $out .= $p; continue; }
        $out .= titleCaseWord($p, $i === $first, $i === $last);
    }
    return $out;
}

function sentenceCaseStr($input) {
    if ($input === null) return '';
    $trimmed = trim($input);
    if ($trimmed === '') return '';
    $pieces = splitKeep($trimmed);
    $idx = wordIndexes($pieces);
    if (!$idx) return $trimmed;
    $first = $idx[0];
    $out = '';
    foreach ($pieces as $i => $p) {
        if (!preg_match('/^[A-Za-z0-9]+$/', $p)) { $out .= $p; continue; }
        $up = strtoupper($p);
        if (in_array($up, acronyms(), true)) { $out .= $up; continue; }
        $out .= ($i === $first)
            ? strtoupper(substr($p, 0, 1)) . strtolower(substr($p, 1))
            : strtolower($p);
    }
    return $out;
}

function normalizeSeparators($s) {
    $s = str_replace('_', ' ', $s);
    $s = preg_replace('/\s+/', ' ', $s);
    $s = preg_replace('/\s+-\s+/', ' - ', $s);
    return trim($s);
}

function extractVersion($s) {
    preg_match_all('/[\(\[]([^()\[\]]+)[\)\]]/', $s, $m, PREG_SET_ORDER);
    $version = null;
    $stripped = $s;
    $hasMix = false;
    foreach ($m as $g) {
        if (preg_match(MIX_KEYWORDS, $g[1])) { $hasMix = true; break; }
    }
    foreach ($m as $g) {
        $inner = $g[1];
        if (preg_match(MIX_KEYWORDS, $inner)) {
            if ($version === null) $version = $inner;
            $pos = strpos($stripped, $g[0]);
            if ($pos !== false) $stripped = substr_replace($stripped, '', $pos, strlen($g[0]));
        } elseif ($hasMix && !preg_match(CREDIT_RE, $inner)) {
            $pos = strpos($stripped, $g[0]);
            if ($pos !== false) $stripped = substr_replace($stripped, '', $pos, strlen($g[0]));
        }
    }
    $stripped = preg_replace('/\s+/', ' ', $stripped);
    $stripped = preg_replace('/\s*[-–—]\s*$/u', '', $stripped);
    $stripped = trim($stripped);

    return [
        'stripped' => $stripped,
        'version'  => $version !== null ? sentenceCaseStr(normalizeSeparators($version)) : null,
    ];
}

function formatTrackName($filename) {
    if (!$filename) return ['artist' => 'Unknown Artist', 'title' => '', 'version' => null];

    $name = preg_replace(AUDIO_EXT, '', $filename);
    $name = preg_replace(TRACK_NUM_PREFIX, '', $name);
    $name = normalizeSeparators($name);

    $ev = extractVersion($name);
    $noVersion = $ev['stripped'];

    $artist = 'Unknown Artist';
    $title  = $noVersion;

    if (preg_match('/\s+[-–—]\s+/u', $noVersion, $sm, PREG_OFFSET_CAPTURE)) {
        $i = $sm[0][1];
        $artist = substr($noVersion, 0, $i);
        $title  = substr($noVersion, $i + strlen($sm[0][0]));
    } else {
        $dash = strpos($noVersion, '-');
        if ($dash !== false && $dash > 0 && $dash < strlen($noVersion) - 1) {
            $artist = substr($noVersion, 0, $dash);
            $title  = substr($noVersion, $dash + 1);
        }
    }

    return [
        'artist'  => titleCaseStr($artist),
        'title'   => titleCaseStr($title),
        'version' => $ev['version'],
    ];
}

// --- resolve ----------------------------------------------------------

$origin = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off' ? 'https' : 'http')
        . '://' . ($_SERVER['HTTP_HOST'] ?? 'crbntyp.com');
$base   = rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/plyr/share.php'), '/') . '/';

$ogTitle = 'plyr__';
$ogDesc  = "Classics you can't find online";
$ogImage = $origin . $base . 'img/assets/fav.png';
$canonical = $origin . $base;

if ($folderId && $trackNum > 0) {
    $listing = readJson($here . '/cache/listings/' . $folderId . '.json');
    $files   = $listing['files'] ?? [];
    $entry   = $files[$trackNum - 1] ?? null;

    if ($entry && !empty($entry['name'])) {
        $parsed = formatTrackName($entry['name']);

        $ogTitle = $parsed['title'] !== '' ? $parsed['title'] : $entry['name'];
        if (!empty($parsed['version'])) $ogTitle .= ' (' . $parsed['version'] . ')';

        $ogDesc = $parsed['artist'] . ' / ' . $eraLabel;

        // Same sleeve the player will land on: hash the filename, mod the
        // pool size. Falls back to the app icon if the sleeve set is
        // unreadable rather than emitting a broken image URL.
        $pool = $sleeves['images'] ?? [];
        if ($pool) {
            $sleeve = $pool[fnv1a($entry['name']) % count($pool)];
            $ogImage = $origin . $base . $sleeve['url'];
        }

        $canonical = $origin . $base . '?e=' . rawurlencode($eraLabel) . '&t=' . $trackNum;
    }
}

// --- serve the app with the tags injected -----------------------------

$html = @file_get_contents($here . '/index.html');
if ($html === false) {
    http_response_code(500);
    exit('index.html missing');
}

function e($s) { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }

$tags = "\n"
    . '    <meta property="og:type" content="music.song">' . "\n"
    . '    <meta property="og:site_name" content="plyr__">' . "\n"
    . '    <meta property="og:title" content="' . e($ogTitle) . '">' . "\n"
    . '    <meta property="og:description" content="' . e($ogDesc) . '">' . "\n"
    . '    <meta property="og:image" content="' . e($ogImage) . '">' . "\n"
    . '    <meta property="og:image:width" content="1024">' . "\n"
    . '    <meta property="og:image:height" content="1024">' . "\n"
    . '    <meta property="og:url" content="' . e($canonical) . '">' . "\n"
    . '    <meta name="twitter:card" content="summary_large_image">' . "\n"
    . '    <meta name="twitter:title" content="' . e($ogTitle) . '">' . "\n"
    . '    <meta name="twitter:description" content="' . e($ogDesc) . '">' . "\n"
    . '    <meta name="twitter:image" content="' . e($ogImage) . '">' . "\n";

// Injected right after <head> so the tags sit above everything else and a
// crawler that reads only the first few KB still finds them.
$html = preg_replace('/<head>/i', '<head>' . $tags, $html, 1);

header('Content-Type: text/html; charset=UTF-8');
header('Cache-Control: no-cache');
echo $html;
