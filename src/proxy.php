<?php
/**
 * Google Drive Audio Proxy with Caching
 * Fetches audio files from Google Drive and caches them locally
 */

// Configuration
$cacheDir = __DIR__ . '/cache';
$maxCacheSize = 2 * 1024 * 1024 * 1024; // 2GB max cache
$cacheExpiry = 30 * 24 * 60 * 60; // 30 days

// Ensure cache directory exists
if (!is_dir($cacheDir)) {
    mkdir($cacheDir, 0755, true);
}

// Get file ID from request
$fileId = $_GET['id'] ?? null;

if (!$fileId || !preg_match('/^[a-zA-Z0-9_-]+$/', $fileId)) {
    http_response_code(400);
    die('Invalid file ID');
}

// Cache file path
$cacheFile = $cacheDir . '/' . $fileId . '.mp3';
$metaFile = $cacheDir . '/' . $fileId . '.meta';

// CORS headers
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, HEAD, OPTIONS');
header('Access-Control-Allow-Headers: Range');

// Handle preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Check cache
if (file_exists($cacheFile) && file_exists($metaFile)) {
    $meta = json_decode(file_get_contents($metaFile), true);

    // Check if cache is still valid
    if ($meta && (time() - $meta['cached_at']) < $cacheExpiry) {
        serveFile($cacheFile, $meta['content_type'] ?? 'audio/mpeg', $meta['filename'] ?? 'audio.mp3');
        exit;
    }
}

// Fetch from Google Drive
$driveUrl = "https://drive.google.com/uc?export=download&id=" . $fileId;

// First request to get cookies/confirmation
$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => $driveUrl,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS => 5,
    CURLOPT_HEADER => true,
    CURLOPT_NOBODY => false,
    CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    CURLOPT_COOKIEJAR => '/tmp/drive_cookies_' . $fileId,
    CURLOPT_COOKIEFILE => '/tmp/drive_cookies_' . $fileId,
]);

$response = curl_exec($ch);
$headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
curl_close($ch);

$headers = substr($response, 0, $headerSize);
$body = substr($response, $headerSize);

// Check for virus scan warning (large files)
if (strpos($body, 'confirm=') !== false || strpos($body, 'download_warning') !== false) {
    // Extract confirmation token
    preg_match('/confirm=([0-9A-Za-z_-]+)/', $body, $matches);
    if (!empty($matches[1])) {
        $confirmUrl = $driveUrl . '&confirm=' . $matches[1];

        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL => $confirmUrl,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 5,
            CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            CURLOPT_COOKIEFILE => '/tmp/drive_cookies_' . $fileId,
        ]);

        $body = curl_exec($ch);
        $contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
    }
}

// Clean up cookie file
@unlink('/tmp/drive_cookies_' . $fileId);

if ($httpCode !== 200 || empty($body)) {
    http_response_code(404);
    die('File not found or inaccessible');
}

// Verify it's actually audio (not an HTML error page)
if (strpos($contentType, 'text/html') !== false || strpos($body, '<!DOCTYPE') !== false) {
    http_response_code(403);
    die('File not accessible - check sharing settings');
}

// Save to cache
file_put_contents($cacheFile, $body);
file_put_contents($metaFile, json_encode([
    'cached_at' => time(),
    'content_type' => $contentType ?: 'audio/mpeg',
    'filename' => $fileId . '.mp3',
    'size' => strlen($body)
]));

// Clean old cache if needed
cleanCache($cacheDir, $maxCacheSize);

// Serve the file
serveFile($cacheFile, $contentType ?: 'audio/mpeg', $fileId . '.mp3');

/**
 * Serve a file with proper headers for audio streaming
 */
function serveFile($path, $contentType, $filename) {
    $size = filesize($path);

    header('Content-Type: ' . $contentType);
    header('Content-Length: ' . $size);
    header('Accept-Ranges: bytes');
    header('Cache-Control: public, max-age=86400');
    header('Content-Disposition: inline; filename="' . $filename . '"');

    // Handle range requests for seeking
    if (isset($_SERVER['HTTP_RANGE'])) {
        preg_match('/bytes=(\d+)-(\d*)/', $_SERVER['HTTP_RANGE'], $matches);
        $start = intval($matches[1]);
        $end = $matches[2] !== '' ? intval($matches[2]) : $size - 1;

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
        echo fread($fp, $end - $start + 1);
        fclose($fp);
    } else {
        readfile($path);
    }
}

/**
 * Clean old cache files if total size exceeds limit
 */
function cleanCache($dir, $maxSize) {
    $files = glob($dir . '/*.mp3');
    if (!$files) return;

    // Calculate total size
    $totalSize = 0;
    $fileData = [];
    foreach ($files as $file) {
        $size = filesize($file);
        $time = filemtime($file);
        $totalSize += $size;
        $fileData[] = ['path' => $file, 'size' => $size, 'time' => $time];
    }

    // If under limit, do nothing
    if ($totalSize <= $maxSize) return;

    // Sort by oldest first
    usort($fileData, fn($a, $b) => $a['time'] - $b['time']);

    // Delete oldest files until under limit
    foreach ($fileData as $file) {
        if ($totalSize <= $maxSize * 0.8) break; // Keep 20% buffer

        $metaPath = str_replace('.mp3', '.meta', $file['path']);
        @unlink($file['path']);
        @unlink($metaPath);
        $totalSize -= $file['size'];
    }
}
