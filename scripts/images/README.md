# Image Optimization Scripts

This directory contains scripts for optimizing existing images in the AmexingWeb platform using server-side processing with Sharp.js.

## Main Script: optimize-existing-images.js

### Overview
This script processes all existing vehicle and experience images to generate optimized variants:
- **AVIF** format (newest, best compression ~50% smaller than JPEG)
- **WebP** format (widely supported, ~30% smaller than JPEG) 
- **Optimized JPEG** format (universal fallback, ~20% smaller than original)

### Features
✅ **Smart Processing**: Only processes images that haven't been optimized yet  
✅ **Server-side Processing**: Uses Sharp.js directly on the Node.js server (no AWS Lambda)  
✅ **Batch Processing**: Processes images in configurable batches to avoid memory issues  
✅ **Progress Tracking**: Real-time progress updates and detailed reporting  
✅ **Dual Support**: Handles both vehicle images and experience images  
✅ **Safety Features**: Dry-run mode, production confirmation, error handling  
✅ **Database Updates**: Updates Parse records with optimization metadata  

## Usage

### Quick Start

```bash
# Test run (no actual processing)
yarn images:optimize:dry-run

# Optimize all images
yarn images:optimize

# Optimize only vehicle images
yarn images:optimize:vehicles

# Optimize only experience images  
yarn images:optimize:experiences

# Force reprocess all images (including already optimized)
yarn images:optimize:force

# Production environment
yarn images:optimize:prod
```

### Advanced Usage

```bash
# Custom batch size (default: 5)
node scripts/images/optimize-existing-images.js --batch-size=3

# Verbose logging
node scripts/images/optimize-existing-images.js --verbose --dry-run

# Combined options
node scripts/images/optimize-existing-images.js --only-vehicles --batch-size=2 --verbose
```

### Command Line Options

| Option | Description |
|--------|-------------|
| `--dry-run` | Run in dry-run mode (no actual processing) |
| `--verbose` | Enable verbose logging |
| `--only-vehicles` | Process only vehicle images |
| `--only-experiences` | Process only experience images |
| `--force` | Force reprocessing of already optimized images |
| `--batch-size=N` | Set batch size (default: 5) |
| `--help` | Show help message |

## How It Works

### 1. Discovery Phase
- Scans Parse database for all active vehicle and experience images
- Includes related entities (vehicleId, experienceId) for proper processing
- Reports total count of images found

### 2. Optimization Check  
- For each image, checks if optimized variants already exist in S3
- Looks for AVIF format in the optimized folder structure:
  - `dev/optimized/avif/vehicles/filename.avif`
  - `dev/optimized/avif/experiences/filename.avif`
- Skips already optimized images (unless `--force` is used)

### 3. Processing Phase
- Downloads original image from S3
- Processes with Sharp.js to generate multiple formats:
  - AVIF (quality: 85, effort: 4)
  - WebP (quality: 90, effort: 4)  
  - JPEG (quality: 92, progressive, mozjpeg)
- Uploads all variants to S3 in organized folder structure
- Creates size variants: thumb, mobile, desktop, original

### 4. Database Updates
- Updates Parse records with optimization metadata:
  - `optimized: true`
  - `optimizedAt: Date`
  - `availableFormats: ['avif', 'webp', 'jpeg']`
  - `formatSizes: { avif: 12345, webp: 23456, jpeg: 34567 }`

### 5. Reporting
- Generates detailed JSON report with statistics
- Shows success rates, processing time, error details
- Saves report to `image-optimization-report-[timestamp].json`

## S3 Folder Structure

### Before Optimization
```
dev/
├── vehicles/
│   └── vehicle-123/
│       └── image.jpg
└── experiences/
    └── experience-456/
        └── image.jpg
```

### After Optimization
```
dev/
├── vehicles/                    # Originals (unchanged)
├── experiences/                 # Originals (unchanged)  
└── optimized/
    ├── avif/
    │   ├── vehicles/
    │   │   └── image.avif
    │   └── experiences/
    │       └── image.avif
    ├── webp/
    │   ├── vehicles/
    │   │   └── image.webp
    │   └── experiences/
    │       └── image.webp
    └── jpeg/
        ├── vehicles/
        │   └── image.jpg
        └── experiences/
            └── image.jpg
```

## Performance Considerations

### Batch Processing
- Default batch size: 5 images
- Processes sequentially to avoid overwhelming the server
- 1-second delay between batches
- Adjust `--batch-size` based on server capacity

### Memory Usage
- Sharp.js processes images in memory
- Each image uses temporary memory during processing
- Smaller batch sizes reduce peak memory usage
- Monitor server resources during large batch processing

### Processing Time
Typical processing times per image:
- Small images (< 500KB): 2-3 seconds
- Medium images (500KB-2MB): 5-8 seconds  
- Large images (> 2MB): 10-15 seconds

## Safety Features

### Production Safeguards
- Requires explicit confirmation in production environment
- Shows configuration before processing
- Comprehensive error handling and logging

### Dry Run Mode
```bash
yarn images:optimize:dry-run
```
- Scans and reports what would be processed
- No actual image processing or S3 uploads
- Safe for testing and validation

### Error Handling
- Continues processing if individual images fail
- Logs all errors with image details
- Includes error summary in final report
- Never loses progress due to single image failures

## Monitoring & Reports

### Real-time Progress
```
📦 Processing batch 3/15 (5 images)
✅ Optimized vehicle image abc123: avif, webp, jpeg
❌ Failed to process vehicle image def456: Download failed
📈 Progress: 47% (85/180)
```

### Final Report
```
📊 Image Optimization Report:
============================
Total images: 180
Processed: 165
Skipped: 12
Failed: 3
Success rate: 92%
Duration: 25 minutes

🚗 Vehicle Images:
  Total: 120
  Processed: 110
  Skipped: 8
  Failed: 2

🎨 Experience Images:  
  Total: 60
  Processed: 55
  Skipped: 4
  Failed: 1

📄 Report saved to: image-optimization-report-1640995200000.json
```

## Troubleshooting

### Common Issues

1. **"Sharp not found"**
   ```bash
   yarn install  # Reinstall dependencies
   ```

2. **"AWS credentials not configured"**
   - Check `.env.development` file
   - Verify `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`

3. **"Parse connection failed"**
   - Ensure development server is running: `yarn dev`
   - Check `PARSE_SERVER_URL` in environment

4. **"S3 bucket access denied"**
   - Verify S3 permissions for the configured bucket
   - Test with: `yarn s3:verify`

### Performance Issues

1. **High memory usage**: Reduce batch size (`--batch-size=2`)
2. **Slow processing**: Check server resources, reduce concurrent operations
3. **Network timeouts**: Ensure stable S3 connection

### Verification

After optimization, verify results:

```bash
# Check S3 structure
aws s3 ls s3://your-bucket/dev/optimized/ --recursive

# Check database records
# Use Parse Dashboard to verify optimizationMetadata fields
```

## Integration with Frontend

The optimized images are automatically served through the existing image optimization system:

1. **Format Negotiation**: Browser Accept headers determine optimal format
2. **Automatic Fallback**: AVIF → WebP → JPEG → Original
3. **Performance Gains**: 30-50% reduction in image sizes
4. **Transparent Integration**: No frontend code changes required

## Best Practices

### When to Run
- **After bulk uploads**: Process new images in batches
- **During maintenance**: Run during low-traffic periods
- **Before deployments**: Ensure all images are optimized
- **Weekly/Monthly**: Regular optimization of missed images

### Recommended Settings
```bash
# Development: Small batches, verbose logging
yarn images:optimize:dry-run --verbose --batch-size=2

# Production: Standard batches, minimal logging  
NODE_ENV=production yarn images:optimize

# Large batches: Monitor server resources
yarn images:optimize --batch-size=10 --verbose
```

### Monitoring
- Watch server memory and CPU during processing
- Monitor S3 costs (3x storage for multi-format)
- Track bandwidth savings from smaller images
- Review error reports for patterns

---

**Created by Denisse Maldonado**  
Last Updated: February 2025