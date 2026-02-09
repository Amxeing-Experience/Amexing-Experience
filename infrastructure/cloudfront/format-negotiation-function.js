/**
 * CloudFront Function for Image Format Negotiation
 * 
 * Automatically selects the best image format based on browser Accept headers
 * Implements fallback chain: AVIF → WebP → JPEG
 * 
 * Created by Denisse Maldonado
 * @version 1.0.0
 */

function handler(event) {
    var request = event.request;
    var headers = request.headers;
    var uri = request.uri;
    
    // Only process image requests
    if (!uri.includes('/vehicles/') && !uri.includes('/optimized/')) {
        return request;
    }
    
    // Skip if already requesting a specific format
    if (uri.includes('/optimized/avif/') || 
        uri.includes('/optimized/webp/') || 
        uri.includes('/optimized/jpeg/')) {
        return request;
    }
    
    // Extract Accept header
    var acceptHeader = headers.accept ? headers.accept.value : '';
    
    // Parse the original URI to get path components
    var pathParts = uri.split('/');
    var fileName = pathParts[pathParts.length - 1];
    var fileNameNoExt = fileName.split('.')[0];
    var basePath = pathParts.slice(0, -1).join('/');
    
    // Detect supported format from Accept header
    var preferredFormat = 'jpeg'; // Default fallback
    var supportedFormats = [];
    
    if (acceptHeader.includes('image/avif')) {
        preferredFormat = 'avif';
        supportedFormats.push('avif');
    }
    
    if (acceptHeader.includes('image/webp')) {
        if (!supportedFormats.includes('avif')) {
            preferredFormat = 'webp';
        }
        supportedFormats.push('webp');
    }
    
    // Always include JPEG as fallback
    supportedFormats.push('jpeg');
    
    // Construct new URI based on preferred format
    // Transform: /prod/vehicles/abc123/image.jpg
    // To: /prod/optimized/avif/vehicles/abc123/image.avif
    
    if (uri.includes('/vehicles/originals/')) {
        // Handle original uploads
        var newPath = uri.replace('/vehicles/originals/', `/optimized/${preferredFormat}/vehicles/`);
        newPath = newPath.replace(/\.[^/.]+$/, `.${preferredFormat}`);
        request.uri = newPath;
    } else if (uri.includes('/vehicles/') && !uri.includes('/optimized/')) {
        // Handle regular vehicle images
        var env = pathParts[0]; // dev or prod
        var vehiclePath = pathParts.slice(1).join('/');
        request.uri = `/${env}/optimized/${preferredFormat}/${vehiclePath.replace(/\.[^/.]+$/, `.${preferredFormat}`)}`;
    }
    
    // Add format hint header for logging
    request.headers['x-preferred-format'] = { value: preferredFormat };
    request.headers['x-supported-formats'] = { value: supportedFormats.join(',') };
    
    // Set cache key to include Accept header for proper caching
    request.headers['cloudfront-viewer-accept'] = headers.accept || { value: '*/*' };
    
    console.log('Format negotiation:', {
        originalUri: uri,
        newUri: request.uri,
        preferredFormat: preferredFormat,
        acceptHeader: acceptHeader
    });
    
    return request;
}