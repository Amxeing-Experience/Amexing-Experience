# S3 Permissions Issue - Provider Experiencia Images

## Issue Description

Provider experiencia images are returning 403 Forbidden errors in the "Editar Proveedor" modal because:

1. Some experiencias have expired presigned URLs stored in the `dataUrl` field
2. The AWS credentials don't have permission to generate new presigned URLs for existing S3 files

## Root Cause

The issue is **not** with the code logic, but with AWS IAM permissions. Our investigation found:

- ✅ Files exist in S3 (confirmed via `s3.headObject()`)
- ✅ Backend code correctly extracts S3 keys from expired URLs  
- ✅ Backend code generates new presigned URLs
- ❌ Generated presigned URLs return 403 Forbidden
- ❌ Even direct AWS SDK presigned URLs fail

## Files Affected

Based on debug output, the experiencia "Testing" (ID: 2nRbTQtXAG) has expired presigned URLs:
- Original expired URL: `https://amexing-bucket.s3.us-east-2.amazonaws.com/dev/files/1770760512604-d82a75f7e10ae762.jpeg?X-Amz-Algorithm=AWS4-HMAC-SHA256...`
- S3 Key: `dev/files/1770760512604-d82a75f7e10ae762.jpeg`
- File exists in S3 (584,992 bytes, uploaded 2026-02-10)

## Code Changes Made

### Backend Fix (ProviderExperienciaController.js)

Updated `formatExperienciaForResponse()` method to:

1. **Detect expired presigned URLs**: Check if `photo.dataUrl` contains "amazonaws.com"
2. **Extract S3 keys**: Parse S3 key from expired URLs using regex
3. **Regenerate presigned URLs**: Create fresh presigned URLs from extracted keys
4. **Handle multiple formats**: Support base64 data URLs, S3 keys, and regular URLs

### Frontend Fix (experience-providers-table.ejs)

Simplified image loading logic since backend now provides proper URLs.

## Solution Required

To fully resolve this issue, the AWS IAM user/role needs the following S3 permissions:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "AllowPresignedURLGeneration",
            "Effect": "Allow",
            "Action": [
                "s3:GetObject"
            ],
            "Resource": [
                "arn:aws:s3:::amexing-bucket/dev/*"
            ]
        }
    ]
}
```

## Immediate Workaround

1. **Base64 images work fine** - These are handled correctly
2. **New uploads work fine** - Fresh presigned URLs work
3. **Only existing S3 images with expired URLs fail**

## Next Steps

1. Update AWS IAM permissions for the development environment
2. Test presigned URL generation after permission update
3. Consider implementing a cleanup script to update all expired presigned URLs in the database

## Testing

To test the fix:
1. Go to http://localhost:1337/dashboard/admin/experiences?section=providers
2. Click "Editar Proveedor" on any provider with images
3. Images should display without 403 errors

Base64 images (like in "Prueba" experiencia) should work immediately.
S3 images will work once AWS permissions are fixed.