const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const inputDir = path.join(__dirname, '../src/img');
const outputDir = path.join(__dirname, '../dist/img');

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

async function optimizeImages() {
    console.log('🖼️  Optimizing images...\n');

    const files = fs.readdirSync(inputDir);
    const imageFiles = files.filter(file => /\.(png|jpg|jpeg)$/i.test(file));

    let totalOriginalSize = 0;
    let totalOptimizedSize = 0;

    for (const file of imageFiles) {
        const inputPath = path.join(inputDir, file);
        const outputFileName = file.replace(/\.(png|jpg|jpeg)$/i, '.jpg');
        const outputPath = path.join(outputDir, outputFileName);

        try {
            // Get original file size
            const originalStats = fs.statSync(inputPath);
            totalOriginalSize += originalStats.size;

            // Convert to JPEG with 75% quality
            await sharp(inputPath)
                .jpeg({
                    quality: 75,
                    mozjpeg: true // Use mozjpeg for better compression
                })
                .toFile(outputPath);

            // Get optimized file size
            const optimizedStats = fs.statSync(outputPath);
            totalOptimizedSize += optimizedStats.size;

            const reduction = ((1 - optimizedStats.size / originalStats.size) * 100).toFixed(1);
            const originalMB = (originalStats.size / 1024 / 1024).toFixed(2);
            const optimizedKB = (optimizedStats.size / 1024).toFixed(0);

            console.log(`✓ ${file}`);
            console.log(`  ${originalMB}MB → ${optimizedKB}KB (${reduction}% reduction)\n`);
        } catch (error) {
            console.error(`✗ Failed to optimize ${file}:`, error.message);
        }
    }

    const totalReduction = ((1 - totalOptimizedSize / totalOriginalSize) * 100).toFixed(1);
    const totalOriginalMB = (totalOriginalSize / 1024 / 1024).toFixed(2);
    const totalOptimizedMB = (totalOptimizedSize / 1024 / 1024).toFixed(2);
    const savedMB = ((totalOriginalSize - totalOptimizedSize) / 1024 / 1024).toFixed(2);

    console.log('═══════════════════════════════════════');
    console.log(`📊 Total: ${totalOriginalMB}MB → ${totalOptimizedMB}MB`);
    console.log(`💾 Saved: ${totalReduction}% (${savedMB}MB)`);
    console.log('✅ Image optimization complete!\n');
}

optimizeImages().catch(error => {
    console.error('Error optimizing images:', error);
    process.exit(1);
});
