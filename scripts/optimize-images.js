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

    let totalOriginalSize = 0;
    let totalOptimizedSize = 0;

    // Process assets folder (keep as PNG, no JPEG conversion)
    const assetsDir = path.join(inputDir, 'assets');
    const assetsOutputDir = path.join(outputDir, 'assets');

    if (fs.existsSync(assetsDir)) {
        if (!fs.existsSync(assetsOutputDir)) {
            fs.mkdirSync(assetsOutputDir, { recursive: true });
        }

        console.log('📁 Processing assets folder...\n');
        const assetFiles = fs.readdirSync(assetsDir);
        const assetImageFiles = assetFiles.filter(file => /\.(png|jpg|jpeg)$/i.test(file));

        for (const file of assetImageFiles) {
            const inputPath = path.join(assetsDir, file);
            const outputPath = path.join(assetsOutputDir, file);

            try {
                const originalStats = fs.statSync(inputPath);
                totalOriginalSize += originalStats.size;

                // Keep assets as PNG to preserve transparency
                if (file.toLowerCase().endsWith('.png')) {
                    await sharp(inputPath)
                        .png({
                            compressionLevel: 9,
                            quality: 90
                        })
                        .toFile(outputPath);
                } else {
                    // Copy JPEGs as-is
                    fs.copyFileSync(inputPath, outputPath);
                }

                const optimizedStats = fs.statSync(outputPath);
                totalOptimizedSize += optimizedStats.size;

                const originalKB = (originalStats.size / 1024).toFixed(1);
                const optimizedKB = (optimizedStats.size / 1024).toFixed(1);

                console.log(`✓ assets/${file}`);
                console.log(`  ${originalKB}KB → ${optimizedKB}KB\n`);
            } catch (error) {
                console.error(`✗ Failed to process assets/${file}:`, error.message);
            }
        }
    }

    // Process album art images (root img folder - convert to JPEG)
    console.log('📁 Processing album art images...\n');
    const files = fs.readdirSync(inputDir);
    const imageFiles = files.filter(file => /\.(png|jpg|jpeg)$/i.test(file));

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
