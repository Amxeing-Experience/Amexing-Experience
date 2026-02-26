# Image Optimization System Guide

## Overview

The AmexingWeb platform includes a server-side image optimization system that automatically processes uploaded images into multiple formats (AVIF, WebP, JPEG) with intelligent delivery based on browser capabilities for optimal performance across all devices.

## Architecture

### Components

1. **ImageOptimizationService** (`src/application/services/ImageOptimizationService.js`)
   - Extends FileStorageService for multi-format support
   - Server-side image processing using Sharp.js
   - Handles format negotiation based on Accept headers
   - Manages optimization records in Parse database

2. **VehicleImageController** (`src/application/controllers/api/VehicleImageController.js`)
   - Handles image upload and processing
   - Integrates with ImageOptimizationService
   - Returns optimized image URLs with metadata

3. **Frontend Components**
   - Vehicle Images Modal (`src/presentation/views/organisms/modal/vehicle-images-modal.ejs`)
   - Dynamic format badge display
   - Progress tracking during upload and optimization

## Image Processing Pipeline

### Upload and Processing Flow

1. **User uploads image via API**
   - Image received by VehicleImageController
   - Original saved to S3 in structured path

2. **Server-side processing** (ImageOptimizationService)
   - Immediate processing using Sharp.js
   - Generates multiple formats: AVIF, WebP, JPEG
   - Creates size variants: thumb, mobile, desktop, original
   - Stores optimized images in S3 with format-specific paths

3. **Database updates**
   - Optimization metadata stored in Parse
   - Available formats and processing status tracked
   - Image URLs updated with optimized versions

4. **Format Selection** (getImageWithOptimalFormat)
   - Based on browser Accept header
   - Returns best available format for client
   - Fallback chain: AVIF → WebP → JPEG → Original

### Storage Structure

```
s3://bucket/
├── dev/vehicles/               # Development originals
├── dev/optimized/
│   ├── avif/vehicles/         # AVIF format
│   ├── webp/vehicles/         # WebP format
│   └── jpeg/vehicles/         # Optimized JPEG
├── prod/vehicles/             # Production originals  
└── prod/optimized/
    ├── avif/vehicles/
    ├── webp/vehicles/
    └── jpeg/vehicles/
```

## Configuration

### Environment Variables

```bash
# Enable/disable optimization
ENABLE_IMAGE_OPTIMIZATION=true

# S3 Configuration
S3_BUCKET=amexing-bucket
S3_PREFIX=dev/  # or prod/
AWS_REGION=us-east-2

# Image processing settings
SHARP_AVIF_QUALITY=50
SHARP_WEBP_QUALITY=80
SHARP_JPEG_QUALITY=85
```

## API Usage

### Upload with Optimization

```javascript
// POST /api/vehicles/:id/images
const formData = new FormData();
formData.append('image', file);

const response = await fetch(`/api/vehicles/${vehicleId}/images`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
});

const result = await response.json();
// Returns immediate optimized data
console.log(result.data.url);           // Best format URL
console.log(result.data.optimization);  // Format info
```

### List Images with Format Negotiation

```javascript
// GET /api/vehicles/:id/images
const response = await fetch(`/api/vehicles/${vehicleId}/images`, {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json, image/avif, image/webp, image/*'
  }
});

const result = await response.json();
// Returns best format for each image
result.data.forEach(image => {
  console.log(image.url);                    // Optimized URL
  console.log(image.optimizationMetadata);   // Format details
});
```

## Frontend Integration

### Vehicle Images Modal

The modal displays:
- **Format badges**: Shows actual format being served (AVIF, WebP, JPEG, ORIGINAL)
- **File metadata**: Size and optimization status
- **Progress tracking**: Upload and processing stages

```javascript
// Format detection from URL and metadata
if (imageUrl.includes('/avif/')) {
    return 'AVIF';
} else if (imageUrl.includes('/webp/')) {
    return 'WEBP';
} else if (metadata.preferredFormat) {
    return metadata.preferredFormat.toUpperCase();
}
```

### Dynamic Format Display

Cards show:
- Blue badge with current format (AVIF, WebP, JPEG, ORIGINAL)
- File size information
- Number of available optimized formats

## Performance Benefits

### Compression Savings

- **AVIF**: ~50% smaller than JPEG, 20-30% smaller than WebP
- **WebP**: ~30% smaller than JPEG  
- **Optimized JPEG**: ~20% smaller than original

### Example File Sizes

Original JPEG: 2.36 MB
- Optimized JPEG: ~1.9 MB (20% reduction)
- WebP: ~1.7 MB (30% reduction)
- AVIF: ~1.2 MB (50% reduction)

### Browser Support

- **AVIF**: Chrome 85+, Firefox 93+
- **WebP**: Chrome 32+, Firefox 65+, Safari 14+
- **JPEG**: Universal fallback

## Format Selection Logic

### Server-side Negotiation

```javascript
detectPreferredFormat(acceptHeader) {
  if (!acceptHeader) return 'jpeg';
  
  if (acceptHeader.includes('image/avif')) {
    return 'avif';
  }
  if (acceptHeader.includes('image/webp')) {
    return 'webp';  
  }
  return 'jpeg';
}
```

### Client Format Display

The system shows users exactly what format they're viewing:
- Frontend checks actual image URL patterns
- Displays corresponding format badge
- Updates dynamically based on browser capabilities

## Monitoring

### Application Metrics

Track via ImageOptimizationService:
- Processing success/failure rates
- Format availability statistics
- Client-side format delivery

### Performance Monitoring

```javascript
// Check optimization status
const metadata = image.optimizationMetadata;
console.log('Available formats:', metadata.availableFormats);
console.log('Preferred format:', metadata.preferredFormat);
```

## Troubleshooting

### Common Issues

1. **Images showing wrong format**
   - Check Accept headers in fetch requests
   - Verify browser format support
   - Clear browser cache

2. **Optimization not working**
   - Verify ENABLE_IMAGE_OPTIMIZATION=true
   - Check Sharp.js installation
   - Review server logs for processing errors

3. **Slow processing**
   - Check server memory allocation
   - Monitor Sharp.js processing time
   - Consider image size limits

### Debug Commands

```bash
# Check environment settings
echo $ENABLE_IMAGE_OPTIMIZATION

# Verify Sharp installation
node -e "console.log(require('sharp'))"

# Test image processing
node scripts/test-image-optimization-localhost.js
```

## Security Considerations

- Original images preserved in S3
- Processed images inherit same permissions
- S3 presigned URLs for private access
- PCI DSS compliant logging throughout pipeline
- No external Lambda functions or dependencies

## Cost Optimization

### Server Resources
- Processes images on existing application servers
- No additional Lambda costs
- CPU usage during upload processing

### Storage
- ~3x storage (AVIF + WebP + JPEG formats)
- Offset by significant bandwidth savings
- Lifecycle policies for cleanup

### Transfer Savings
- Format optimization reduces transfer by 30-50%
- Client receives optimal format automatically
- Reduced server bandwidth usage

## Implementation Details

### Key Features Implemented

✅ **Server-side processing** with Sharp.js
✅ **Format negotiation** based on Accept headers  
✅ **Multi-format storage** (AVIF, WebP, JPEG)
✅ **Dynamic format badges** in frontend
✅ **Progress tracking** during optimization
✅ **Fallback handling** for unsupported formats
✅ **Metadata tracking** and status monitoring

### Technical Stack

- **Sharp.js**: Server-side image processing
- **AWS S3**: Multi-format storage with presigned URLs
- **Parse Server**: Optimization metadata and status
- **Express.js**: API endpoints and middleware
- **Bootstrap**: Frontend UI components

## Implementing Optimization for New Entities

The optimization system is now **highly reusable**. Here's how to add it to any new image entity:

### Step 1: Update Your Controller

```javascript
// In your controller constructor
constructor() {
  // Add optimization services
  this.imageOptimizationService = new ImageOptimizationService({
    enableOptimization: process.env.ENABLE_IMAGE_OPTIMIZATION === 'true',
    formatPriority: ['avif', 'webp', 'jpeg'],
  });
  
  this.serverOptimizationService = new ServerImageOptimizationService({
    formats: ['avif', 'webp', 'jpeg'],
    sizes: ['thumb', 'mobile', 'desktop', 'original'],
    quality: { avif: 85, webp: 85, jpeg: 85 }
  });
}
```

### Step 2: Handle Upload with Optimization

```javascript
async uploadImage(req, res) {
  const file = req.file;
  
  // Use server optimization service for upload
  const optimizationResult = await this.serverOptimizationService.uploadOptimizedImage(
    file.buffer,
    uniqueFileName,
    file.mimetype,
    {
      entityPath: `yourEntity/${entityId}`, // e.g., 'products/abc123'
      entityId: entityId,
      userContext: {
        userId: req.user.id,
        email: req.user.get('email'),
        username: req.user.get('username'),
      },
    }
  );
  
  // Save to database with optimization data
  const image = new YourImageClass();
  image.set('s3Key', optimizationResult.originalS3Key);
  image.set('optimizedVariants', optimizationResult.optimizedVariants);
  image.set('optimizationMetadata', optimizationResult.metadata);
  await image.save();
}
```

### Step 3: Serve Optimized Images

```javascript
async listImages(req, res) {
  const acceptHeader = req.get('accept');
  const images = await YourImageClass.findByEntity(entityId);
  
  const optimizedImages = await Promise.all(
    images.map(async (img) => {
      // Let optimization service handle format selection
      let imageData = null;
      
      if (img.get('s3Key') && this.imageOptimizationService?.enableOptimization) {
        imageData = await this.imageOptimizationService.getImageWithOptimalFormat(img, acceptHeader);
      } else {
        // Fallback for unoptimized images
        const url = await this.fileStorageService.getPresignedUrl(img.get('s3Key'));
        imageData = { url };
      }
      
      return {
        id: img.id,
        url: imageData.url,
        fileName: img.get('fileName'),
        fileSize: img.get('fileSize'),
        optimizationMetadata: img.get('optimizationMetadata')
      };
    })
  );
  
  res.json({ success: true, data: optimizedImages });
}
```

### Step 4: Frontend Accept Headers

```javascript
// In your frontend modal/component
const headers = {
  'Accept': 'image/avif;q=1.0,image/webp;q=0.9,image/jpeg;q=0.8,image/*;q=0.5'
};

const response = await fetch(`/api/yourEntity/${entityId}/images`, { headers });
```

### Step 5: Frontend Format Detection

```javascript
// Show format badges in your UI
const displayFormat = (() => {
  if (!image.url) return 'ORIGINAL';
  
  if (image.url.includes('.avif')) return 'AVIF';
  if (image.url.includes('.webp')) return 'WEBP';  
  if (image.url.includes('.jpg') || image.url.includes('.jpeg')) return 'JPEG';
  return 'ORIGINAL';
})();

// Show format count
const metadata = image.optimizationMetadata || {};
const availableFormats = metadata.formats || metadata.availableFormats || [];
const optimizedFormats = availableFormats.filter(f => f !== 'original');
const count = optimizedFormats.length;
```

### Current Implementations

✅ **Vehicle Images** - Full optimization with unified script support  
✅ **Experience Images** - Server optimization with format selection  
🔄 **Ready for any new entity** - Just follow the 5 steps above!

## System Architecture Benefits

### Dual Service Design
1. **ServerImageOptimizationService** - Handles upload-time optimization
2. **ImageOptimizationService** - Handles serving with format negotiation

### Universal Compatibility
- Works with both flat and nested optimization metadata structures
- Graceful fallback for unoptimized images
- Browser-based format selection
- Presigned URL security

### Easy Implementation Pattern
```javascript
// Any new controller can use this pattern:
class ProductImageController {
  constructor() {
    this.initOptimization(); // Add the two services
  }
  
  async upload() { 
    const result = await this.serverOptimizationService.uploadOptimizedImage(/*...*/);
    // Save with optimization metadata
  }
  
  async list() {
    const imageData = await this.imageOptimizationService.getImageWithOptimalFormat(/*...*/);
    // Return optimized URL
  }
}
```

## Future Enhancements

Potential improvements:
- [ ] Background processing queue for large images
- [x] ~~Size variant generation (thumb, mobile, desktop)~~ ✅ Implemented
- [ ] Automatic quality adjustment based on content
- [ ] Image CDN integration
- [ ] JPEG XL format support
- [ ] Generic optimization mixin/trait for controllers

## Support

For issues or questions:
- Check application server logs
- Verify environment configuration
- Review this documentation
- Test with scripts/test-image-optimization-localhost.js

Created by Denisse Maldonado  
Last Updated: February 2024