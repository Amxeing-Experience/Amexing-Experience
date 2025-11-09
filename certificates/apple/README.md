# Apple OAuth Certificates

## Setup Instructions

To enable Apple Sign In, you need to:

1. **Download the private key file** from Apple Developer Console:
   - Go to [Apple Developer Console](https://developer.apple.com/)
   - Navigate to Certificates, Identifiers & Profiles
   - Go to Keys section
   - Create or download your existing key for Apple Sign In
   - Save it as `AuthKey_EFGH789012.p8` in this directory

2. **Update environment variables** in `.env.development`:
   - `APPLE_OAUTH_KEY_ID`: Your Key ID (e.g., EFGH789012)
   - `APPLE_OAUTH_TEAM_ID`: Your Apple Developer Team ID
   - `APPLE_OAUTH_CLIENT_ID`: Your Service ID (e.g., com.amexing.web.development)

## File Structure

```
certificates/apple/
├── AuthKey_EFGH789012.p8    # Private key file (required)
├── README.md                # This file
└── .gitignore               # Ignore certificate files
```

## Security Notes

- ⚠️ **NEVER commit certificate files to git**
- The private key file is highly sensitive
- Use different keys for development and production
- Rotate keys periodically as per security best practices

## Development Setup

For development, you can:
1. Use the same key for all environments initially
2. Set up proper key rotation for production deployment
3. Ensure the private key file permissions are restricted (600)

## Production Deployment

For production:
1. Use a separate Apple Developer Team if possible
2. Create production-specific Service ID and keys
3. Store keys securely (encrypted, access-controlled)
4. Implement proper key rotation policies