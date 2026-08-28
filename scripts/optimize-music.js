const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const { slugify } = require('./lib/slug');

const inputDir = path.join(__dirname, '../src/music');
const outputDir = path.join(__dirname, '../public/music');

if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// Direct ffmpeg invocation — fluent-ffmpeg was deprecated and its only
// added value here was builder syntax for the four-arg encode chain below.
// `-y` overwrites the existing file silently so reruns are idempotent.
function convertToOpus(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        const args = [
            '-y',
            '-i', inputPath,
            // Drop the attached cover picture — generate-palettes.js already
            // extracted it to a sized WebP, and muxing a 2048px PNG into an
            // Opus stream only makes the audio bigger.
            '-vn',
            '-c:a', 'libopus',
            '-b:a', '128k',
            '-ac', '2',
            '-ar', '48000',
            outputPath,
        ];
        const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        proc.on('error', reject);
        proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`ffmpeg exited ${code}: ${stderr.split('\n').slice(-5).join('\n')}`));
        });
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
        // Slugified so the URL needs no escaping and matches the name
        // generate-palettes.js wrote into tracks.json.
        const outputFileName = `${slugify(file)}.opus`;
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
