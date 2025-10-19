const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

const inputDir = path.join(__dirname, '../src/music');
const outputDir = path.join(__dirname, '../dist/music');

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

async function convertToOpus(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .audioCodec('libopus')
            .audioBitrate('128k')
            .audioChannels(2)
            .audioFrequency(48000)
            .output(outputPath)
            .on('end', () => resolve())
            .on('error', (err) => reject(err))
            .run();
    });
}

async function processFile(filePath) {
    const fileName = path.basename(filePath);
    const outputFileName = fileName.replace(/\.mp3$/i, '.opus');
    const outputPath = path.join(outputDir, outputFileName);

    try {
        console.log(`🎵 Converting ${fileName}...`);

        const originalStats = fs.statSync(filePath);
        const originalMB = (originalStats.size / 1024 / 1024).toFixed(2);

        await convertToOpus(filePath, outputPath);

        const optimizedStats = fs.statSync(outputPath);
        const optimizedMB = (optimizedStats.size / 1024 / 1024).toFixed(2);
        const reduction = ((1 - optimizedStats.size / originalStats.size) * 100).toFixed(1);

        console.log(`✓ ${fileName} → ${outputFileName}`);
        console.log(`  ${originalMB}MB → ${optimizedMB}MB (${reduction}% reduction)\n`);
    } catch (error) {
        console.error(`✗ Failed to convert ${fileName}:`, error.message);
    }
}

console.log('👀 Watching for MP3 files in src/music/...\n');

// Watch for MP3 files
const watcher = chokidar.watch(path.join(inputDir, '*.mp3'), {
    persistent: true,
    ignoreInitial: false, // Process existing files on startup
    awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100
    }
});

watcher
    .on('add', filePath => {
        console.log(`📁 Detected: ${path.basename(filePath)}`);
        processFile(filePath);
    })
    .on('change', filePath => {
        console.log(`🔄 Changed: ${path.basename(filePath)}`);
        processFile(filePath);
    })
    .on('unlink', filePath => {
        const fileName = path.basename(filePath);
        const outputFileName = fileName.replace(/\.mp3$/i, '.opus');
        const outputPath = path.join(outputDir, outputFileName);

        if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
            console.log(`🗑️  Removed: ${outputFileName}\n`);
        }
    })
    .on('error', error => console.error('Watch error:', error));

console.log('✅ Watch mode active. Press Ctrl+C to stop.\n');
