const fs = require('fs');
const path = require('path');
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

async function optimizeMusic() {
    console.log('🎵 Optimizing music files...\n');

    const files = fs.readdirSync(inputDir);
    const audioFiles = files.filter(file => /\.mp3$/i.test(file));

    if (audioFiles.length === 0) {
        console.log('⚠️  No MP3 files found in src/music/');
        return;
    }

    let totalOriginalSize = 0;
    let totalOptimizedSize = 0;

    for (const file of audioFiles) {
        const inputPath = path.join(inputDir, file);
        const outputFileName = file.replace(/\.mp3$/i, '.opus');
        const outputPath = path.join(outputDir, outputFileName);

        try {
            // Get original file size
            const originalStats = fs.statSync(inputPath);
            totalOriginalSize += originalStats.size;

            console.log(`Converting ${file}...`);

            // Convert to OPUS
            await convertToOpus(inputPath, outputPath);

            // Get optimized file size
            const optimizedStats = fs.statSync(outputPath);
            totalOptimizedSize += optimizedStats.size;

            const reduction = ((1 - optimizedStats.size / originalStats.size) * 100).toFixed(1);
            const originalMB = (originalStats.size / 1024 / 1024).toFixed(2);
            const optimizedMB = (optimizedStats.size / 1024 / 1024).toFixed(2);

            console.log(`✓ ${file}`);
            console.log(`  ${originalMB}MB → ${optimizedMB}MB (${reduction}% reduction)\n`);
        } catch (error) {
            console.error(`✗ Failed to optimize ${file}:`, error.message);
        }
    }

    if (totalOriginalSize > 0) {
        const totalReduction = ((1 - totalOptimizedSize / totalOriginalSize) * 100).toFixed(1);
        const totalOriginalMB = (totalOriginalSize / 1024 / 1024).toFixed(2);
        const totalOptimizedMB = (totalOptimizedSize / 1024 / 1024).toFixed(2);
        const savedMB = ((totalOriginalSize - totalOptimizedSize) / 1024 / 1024).toFixed(2);

        console.log('═══════════════════════════════════════');
        console.log(`📊 Total: ${totalOriginalMB}MB → ${totalOptimizedMB}MB`);
        console.log(`💾 Saved: ${totalReduction}% (${savedMB}MB)`);
        console.log('✅ Music optimization complete!\n');
    }
}

optimizeMusic().catch(error => {
    console.error('Error optimizing music:', error);
    process.exit(1);
});
