<?php
/**
 * Plyr backend proxy — audio streaming, Drive listing, art extraction.
 *
 * Actions (selected by ?action= query):
 *   stream  (default — backwards-compat with ?id=X)
 *     Downloads a Google Drive audio file via the public uc?export=download
 *     URL, caches locally, serves with Range support.
 *
 *   list    ?action=list&folder=<driveFolderId>
 *     Calls the Drive v3 API server-side using DRIVE_API_KEY from
 *     proxy.config.php (gitignored). Returns the folder's audio file list
 *     as JSON. Response cached at cache/listings/<folder>.json with a 24h
 *     TTL so we don't burn quota on every page load.
 *
 *   refresh ?action=refresh&folder=<driveFolderId>
 *     Bust the listing cache for one folder. Returns {ok:true}.
 *
 *   art     ?action=art&id=<driveFileId>
 *     Lazily extract the embedded cover image from the cached audio file
 *     (must have been streamed once first) using ffmpeg. Cached as
 *     cache/art/<fileId>.jpg. 404 when no embedded art — client falls
 *     back to a neon placeholder.
 */

// Suppress PHP errors from output. Without this, any warning becomes HTML
// in the response and breaks JSON parsing / mid-stream audio. Global rule
// from CLAUDE.md.
error_reporting(0);
ini_set('display_errors', 0);

// === Config ===========================================================

$DRIVE_API_KEY = '';
if (file_exists(__DIR__ . '/proxy.config.php')) {
    $cfg = require __DIR__ . '/proxy.config.php';
    $DRIVE_API_KEY = $cfg['DRIVE_API_KEY'] ?? '';
}

$cacheDir        = __DIR__ . '/cache';
$listingCacheDir = $cacheDir . '/listings';
$artCacheDir     = $cacheDir . '/art';
foreach ([$cacheDir, $listingCacheDir, $artCacheDir] as $d) {
    if (!is_dir($d)) @mkdir($d, 0755, true);
}

$maxCacheSize = 2 * 1024 * 1024 * 1024;  // 2 GB
$cacheExpiry  = 30 * 24 * 60 * 60;        // 30 days for streamed audio
$listingTtl   = 24 * 60 * 60;              // 24h for Drive listings

// === CORS =============================================================

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, HEAD, OPTIONS');
header('Access-Control-Allow-Headers: Range');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// === Action dispatch ==================================================

$action = $_GET['action'] ?? 'stream';

switch ($action) {
    case 'stream':  handleStream($cacheDir, $cacheExpiry, $maxCacheSize); break;
    case 'list':    handleList($listingCacheDir, $listingTtl, $DRIVE_API_KEY); break;
    case 'refresh': handleRefresh($listingCacheDir); break;
    case 'art':     handleArt($cacheDir, $artCacheDir); break;
    default:
        http_response_code(400);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'Unknown action']);
        exit;
}

// ======================================================================
// Handlers
// ======================================================================

function validFileId($id) {
    return $id && preg_match('/^[a-zA-Z0-9_-]+$/', $id);
}

function jsonResponse($data, $status = 200) {
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($data);
}

// ----------------------------------------------------------------------
// stream — original Drive download+cache+serve flow
// ----------------------------------------------------------------------

function handleStream($cacheDir, $cacheExpiry, $maxCacheSize) {
    $fileId = $_GET['id'] ?? null;
    if (!validFileId($fileId)) {
        http_response_code(400);
        die('Invalid file ID');
    }

    $cacheFile = $cacheDir . '/' . $fileId . '.mp3';
    $metaFile  = $cacheDir . '/' . $fileId . '.meta';

    // Cache hit — serve immediately.
    if (file_exists($cacheFile) && file_exists($metaFile)) {
        $meta = json_decode(file_get_contents($metaFile), true);
        if ($meta && (time() - $meta['cached_at']) < $cacheExpiry) {
            serveFile($cacheFile, $meta['content_type'] ?? 'audio/mpeg', $meta['filename'] ?? 'audio.mp3');
            exit;
        }
    }

    // Cache miss — fetch via Drive's public download endpoint.
    $driveUrl    = "https://drive.google.com/uc?export=download&id=" . $fileId;
    $cookieJar   = '/tmp/drive_cookies_' . $fileId;

    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL            => $driveUrl,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 5,
        CURLOPT_HEADER         => true,
        CURLOPT_USERAGENT      => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        CURLOPT_COOKIEJAR      => $cookieJar,
        CURLOPT_COOKIEFILE     => $cookieJar,
    ]);
    $response   = curl_exec($ch);
    $headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $httpCode   = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $contentType= curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    curl_close($ch);

    $body = substr($response, $headerSize);

    // Drive's virus-scan interstitial for large files: a confirm= token
    // gates the actual download. Re-hit with the token to get the bytes.
    if (strpos($body, 'confirm=') !== false || strpos($body, 'download_warning') !== false) {
        preg_match('/confirm=([0-9A-Za-z_-]+)/', $body, $matches);
        if (!empty($matches[1])) {
            $ch = curl_init();
            curl_setopt_array($ch, [
                CURLOPT_URL            => $driveUrl . '&confirm=' . $matches[1],
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_MAXREDIRS      => 5,
                CURLOPT_USERAGENT      => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                CURLOPT_COOKIEFILE     => $cookieJar,
            ]);
            $body        = curl_exec($ch);
            $contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
            $httpCode    = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
        }
    }
    @unlink($cookieJar);

    if ($httpCode !== 200 || empty($body)) {
        http_response_code(404);
        die('File not found or inaccessible');
    }
    if (strpos($contentType, 'text/html') !== false || strpos($body, '<!DOCTYPE') !== false) {
        http_response_code(403);
        die('File not accessible - check sharing settings');
    }

    file_put_contents($cacheFile, $body);
    file_put_contents($metaFile, json_encode([
        'cached_at'    => time(),
        'content_type' => $contentType ?: 'audio/mpeg',
        'filename'     => $fileId . '.mp3',
        'size'         => strlen($body),
    ]));

    cleanCache($cacheDir, $maxCacheSize);

    serveFile($cacheFile, $contentType ?: 'audio/mpeg', $fileId . '.mp3');
}

// ----------------------------------------------------------------------
// list — Drive folder listing with 24h cache
// ----------------------------------------------------------------------

function handleList($listingCacheDir, $listingTtl, $apiKey) {
    $folder = $_GET['folder'] ?? null;
    if (!validFileId($folder)) {
        jsonResponse(['error' => 'Invalid folder ID'], 400);
        return;
    }
    if (!$apiKey) {
        jsonResponse(['error' => 'Server misconfigured (no DRIVE_API_KEY)'], 500);
        return;
    }

    $cacheFile = $listingCacheDir . '/' . $folder . '.json';
    if (file_exists($cacheFile) && (time() - filemtime($cacheFile)) < $listingTtl) {
        header('X-Cache: HIT');
        readfile($cacheFile);
        return;
    }

    // Cache miss / stale — hit Drive API.
    $q = "'{$folder}' in parents and (mimeType contains 'audio/')";
    $url = 'https://www.googleapis.com/drive/v3/files'
        . '?q='      . urlencode($q)
        . '&fields=' . urlencode('files(id,name,mimeType,size)')
        . '&key='    . $apiKey
        . '&pageSize=100';

    // The API key has an HTTP-referrer restriction allowing crbntyp.com.
    // Server-side curl sends no Referer by default, which Google rejects
    // with 403. Setting it explicitly satisfies the restriction without
    // having to widen the key's allowed origins to "any".
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL            => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_REFERER        => 'https://crbntyp.com/',
    ]);
    $body     = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode !== 200) {
        // Fall back to stale cache if we have one — better to show old data
        // than nothing when Drive is briefly down.
        if (file_exists($cacheFile)) {
            header('X-Cache: STALE');
            readfile($cacheFile);
            return;
        }
        jsonResponse(['error' => 'Drive API error', 'status' => $httpCode], 502);
        return;
    }

    file_put_contents($cacheFile, $body);
    header('X-Cache: MISS');
    header('Content-Type: application/json');
    echo $body;
}

// ----------------------------------------------------------------------
// refresh — bust one folder's listing cache
// ----------------------------------------------------------------------

function handleRefresh($listingCacheDir) {
    $folder = $_GET['folder'] ?? null;
    if (!validFileId($folder)) {
        jsonResponse(['error' => 'Invalid folder ID'], 400);
        return;
    }
    $cacheFile = $listingCacheDir . '/' . $folder . '.json';
    if (file_exists($cacheFile)) @unlink($cacheFile);
    jsonResponse(['ok' => true]);
}

// ----------------------------------------------------------------------
// art — extract embedded cover from cached audio
// ----------------------------------------------------------------------

function handleArt($cacheDir, $artCacheDir) {
    $fileId = $_GET['id'] ?? null;
    if (!validFileId($fileId)) {
        http_response_code(400);
        die('Invalid file ID');
    }

    $artFile = $artCacheDir . '/' . $fileId . '.jpg';

    // Sentinel for "no embedded art" so we don't re-extract on every call.
    $noArtFile = $artCacheDir . '/' . $fileId . '.none';

    if (file_exists($artFile)) {
        header('Content-Type: image/jpeg');
        header('Cache-Control: public, max-age=604800');
        readfile($artFile);
        return;
    }
    if (file_exists($noArtFile)) {
        http_response_code(404);
        return;
    }

    // Need a cached audio source — bail if the track hasn't been streamed
    // yet. The client should request art *after* the audio has loaded
    // at least once.
    $audioFile = $cacheDir . '/' . $fileId . '.mp3';
    if (!file_exists($audioFile)) {
        http_response_code(404);
        die('Audio not cached yet');
    }

    // ffmpeg: -an drops audio, -map 0:v:0 picks the first attached video
    // stream (which is how ID3 stores embedded artwork), -vcodec copy
    // writes the raw image bytes without re-encoding.
    $cmd = sprintf(
        'ffmpeg -y -i %s -an -vcodec copy -map 0:v:0 %s 2>&1',
        escapeshellarg($audioFile),
        escapeshellarg($artFile)
    );
    exec($cmd, $output, $rc);

    if ($rc === 0 && file_exists($artFile) && filesize($artFile) > 0) {
        header('Content-Type: image/jpeg');
        header('Cache-Control: public, max-age=604800');
        readfile($artFile);
        return;
    }

    // No embedded art (or extraction failed). Touch the sentinel so we
    // don't run ffmpeg again for this file.
    @unlink($artFile);
    @touch($noArtFile);
    http_response_code(404);
}

// ======================================================================
// Helpers
// ======================================================================

/**
 * Serve a cached audio file with Range support.
 * Streams in 64K chunks rather than loading the whole range into memory,
 * so a single request can't blow PHP's memory limit on a large file.
 */
function serveFile($path, $contentType, $filename) {
    $size = filesize($path);

    header('Content-Type: ' . $contentType);
    header('Accept-Ranges: bytes');
    header('Cache-Control: public, max-age=86400');
    header('Content-Disposition: inline; filename="' . $filename . '"');

    if (isset($_SERVER['HTTP_RANGE'])) {
        preg_match('/bytes=(\d+)-(\d*)/', $_SERVER['HTTP_RANGE'], $matches);
        $start = intval($matches[1]);
        $end   = $matches[2] !== '' ? intval($matches[2]) : $size - 1;

        if ($start > $end || $start >= $size) {
            http_response_code(416);
            header('Content-Range: bytes */' . $size);
            exit;
        }

        http_response_code(206);
        header('Content-Range: bytes ' . $start . '-' . $end . '/' . $size);
        header('Content-Length: ' . ($end - $start + 1));

        $fp = fopen($path, 'rb');
        fseek($fp, $start);
        $remaining = $end - $start + 1;
        while ($remaining > 0 && !feof($fp)) {
            $chunk = min(65536, $remaining);
            echo fread($fp, $chunk);
            $remaining -= $chunk;
            flush();
        }
        fclose($fp);
    } else {
        header('Content-Length: ' . $size);
        readfile($path);
    }
}

/**
 * Evict oldest cached audio files when total size exceeds the cap.
 * Trims to 80% of the limit so we don't thrash on every new file.
 */
function cleanCache($dir, $maxSize) {
    $files = glob($dir . '/*.mp3');
    if (!$files) return;

    $totalSize = 0;
    $fileData  = [];
    foreach ($files as $file) {
        $size = filesize($file);
        $time = filemtime($file);
        $totalSize += $size;
        $fileData[] = ['path' => $file, 'size' => $size, 'time' => $time];
    }
    if ($totalSize <= $maxSize) return;

    usort($fileData, fn($a, $b) => $a['time'] - $b['time']);

    foreach ($fileData as $file) {
        if ($totalSize <= $maxSize * 0.8) break;
        $metaPath = str_replace('.mp3', '.meta', $file['path']);
        @unlink($file['path']);
        @unlink($metaPath);
        $totalSize -= $file['size'];
    }
}
