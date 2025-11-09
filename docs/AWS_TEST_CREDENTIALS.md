# AWS Test Credentials Configuration

## Overview

This document explains how to configure AWS S3 credentials for integration tests in a **PCI DSS Level 1 compliant** manner, ensuring security and preventing credential leaks.

## Security Principles

### 1. **Least Privilege**
Test credentials have **minimal permissions**:
- ✅ Only access `test/*` prefix in S3 bucket
- ✅ Can copy to `deleted/test/*` for soft deletion testing
- ❌ **ZERO access** to `prod/*` or `dev/*` prefixes
- ❌ Cannot modify bucket policies, ACLs, or delete buckets

### 2. **Isolation**
- Credentials stored in `.env.test` (NEVER committed to git)
- Protected by `.gitignore` and pre-commit hooks
- Even if credentials leak, damage is limited to test files only

### 3. **PCI DSS Compliance**
- **Req 7.1**: Least privilege IAM policy
- **Req 8.2.4**: Quarterly credential rotation documented
- **Req 10.2**: CloudTrail logs all S3 access automatically
- **Req 11.2**: Security scanning with Semgrep + pre-commit hooks

---

## Local Development Setup

### Step 1: Create Test IAM User in AWS

1. **Go to AWS IAM Console** → Users → Add User

2. **User Configuration:**
   ```
   User name: amexing-test-s3-user
   Access type: Programmatic access
   ```

3. **Attach Policy:**
   - Click "Attach existing policies directly"
   - Click "Create policy"
   - Copy JSON from `docs/AWS_TEST_IAM_POLICY.json`
   - Name: `AmexingTestS3Access`
   - Create policy
   - Attach to user

4. **Generate Access Key:**
   - Complete user creation
   - Copy Access Key ID and Secret Access Key
   - **Store securely** (1Password, AWS Secrets Manager, etc.)

### Step 2: Configure Local Environment

```bash
# 1. Copy example file
cp environments/.env.test.example environments/.env.test

# 2. Edit .env.test and replace FAKE credentials with REAL test credentials
# Use your favorite editor:
code environments/.env.test
# or
nano environments/.env.test
```

**Replace these lines:**
```bash
# BEFORE (fake example)
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY

# AFTER (your real test credentials)
AWS_ACCESS_KEY_ID=AKIA_YOUR_REAL_TEST_KEY
AWS_SECRET_ACCESS_KEY=your_real_test_secret_key_here
```

### Step 3: Verify Configuration

```bash
# 1. Verify .env.test is protected by .gitignore
git check-ignore environments/.env.test
# Expected output: environments/.env.test ✅

# 2. Verify pre-commit hook protects .env.test
git add environments/.env.test
git commit -m "test"
# Expected: Pre-commit hook should BLOCK this ❌
# Then unstage: git reset HEAD environments/.env.test

# 3. Run S3 integration tests
yarn test tests/integration/api/vehicle-images-s3.test.js --runInBand

# Expected: All tests pass ✅
```

---

## IAM Policy Details

**Policy Name:** `AmexingTestS3Access`

**File:** `docs/AWS_TEST_IAM_POLICY.json`

### What It Allows

| Action | Resource | Description |
|--------|----------|-------------|
| `s3:ListBucket` | `amexing-bucket` | List objects (filtered to test/* prefix) |
| `s3:PutObject` | `amexing-bucket/test/*` | Upload test files |
| `s3:GetObject` | `amexing-bucket/test/*` | Download test files |
| `s3:DeleteObject` | `amexing-bucket/test/*` | Delete test files |
| `s3:PutObject` | `amexing-bucket/deleted/test/*` | Copy to deleted folder (soft delete) |

### What It Denies

| Denied Action | Resource | Reason |
|---------------|----------|--------|
| `s3:*` | `amexing-bucket/prod/*` | **EXPLICIT DENY** - Zero production access |
| `s3:*` | `amexing-bucket/dev/*` | **EXPLICIT DENY** - Zero development access |
| `s3:DeleteBucket` | `amexing-bucket` | Cannot delete entire bucket |
| `s3:PutBucketPolicy` | `amexing-bucket` | Cannot modify bucket policies |
| `s3:PutBucketAcl` | `amexing-bucket` | Cannot modify ACLs |

### Security Boundaries

Even if test credentials are compromised:
- ✅ Attacker can only access files in `test/*` prefix
- ✅ Cannot access production (`prod/*`) or development (`dev/*`) data
- ✅ Cannot modify bucket configuration or policies
- ✅ Cannot delete the bucket
- ✅ All actions logged in CloudTrail

---

## Test Workflow

### Running S3 Integration Tests

```bash
# Run all S3 integration tests
yarn test tests/integration/api/vehicle-images-s3.test.js

# Run specific test
yarn test -t "should upload image to S3"

# Run with verbose output
yarn test tests/integration/api/vehicle-images-s3.test.js --verbose
```

### What Gets Tested

| Test Suite | Description |
|------------|-------------|
| **Direct S3 Upload** | Tests AWS SDK direct upload with encryption |
| **Presigned URLs** | Verifies 1-hour expiration and signatures |
| **Metadata Storage** | Validates s3Key, s3Bucket, s3Region in database |
| **Soft Deletion** | Tests copy to `deleted/test/*` folder |
| **Security** | RBAC permissions and authentication |
| **Encryption** | Verifies AES256 server-side encryption |

### Test File Organization

Tests upload to:
```
s3://amexing-bucket/test/vehicles/[vehicleId]/[timestamp]-[random].jpg
```

Deleted files move to:
```
s3://amexing-bucket/deleted/test/vehicles/[vehicleId]/[timestamp]-[random].jpg
```

---

## Triple Protection Against Credential Leaks

### 1. `.gitignore` Protection

`.env.test` is explicitly excluded from git:

```bash
# In .gitignore
.env.test
**/.env.test  # Also prevents subdirectory leaks
```

**Verify:**
```bash
git check-ignore environments/.env.test
# Output: environments/.env.test ✅
```

### 2. Pre-Commit Hook Protection

**File:** `scripts/global/git-hooks/pre-commit`

Actively blocks commits containing:
- `.env.test` file itself
- Real AWS access keys (AKIA pattern)
- Real AWS secret keys (40-character base64)

**Test it:**
```bash
git add environments/.env.test
git commit -m "test"
# Expected: Hook blocks with error message ❌
```

### 3. Semgrep Security Scanning

**File:** `.semgrep.yml`

Scans source code for hardcoded credentials, but **excludes**:
- `.env.test.example` (safe template with fake credentials)
- Test files (`*.test.js`)
- Documentation files

**Verify:**
```bash
yarn lint  # Includes Semgrep scan
# No warnings about .env.test.example ✅
```

---

## Troubleshooting

### Tests Fail with "Access Denied"

**Symptom:**
```
Error: Access Denied
  at S3.putObject
```

**Solution:**
1. Verify IAM policy is attached to test user
2. Check policy JSON matches `docs/AWS_TEST_IAM_POLICY.json`
3. Verify S3_PREFIX=test/ in .env.test
4. Test with AWS CLI:
   ```bash
   aws s3 ls s3://amexing-bucket/test/ --profile amexing-test
   ```

### Tests Fail with "Credentials Not Configured"

**Symptom:**
```
❌ AWS credentials not configured for S3 integration tests
```

**Solution:**
1. Verify `.env.test` exists:
   ```bash
   ls -la environments/.env.test
   ```
2. Verify credentials are set:
   ```bash
   grep AWS_ACCESS_KEY_ID environments/.env.test
   ```
3. Ensure not using FAKE example credentials from `.env.test.example`

### Pre-Commit Hook Blocks Legitimate Commit

**Symptom:**
```
❌ Real AWS access key detected in source files
```

**Solution:**
1. Ensure you're not accidentally including `.env.test` in commit
2. Check for hardcoded credentials in source code (not allowed)
3. If in `.env.test.example`, verify fake example format: `AKIAIOSFODNN7EXAMPLE`

### Cannot Find .env.test After Creating It

**Symptom:**
File not visible in `ls` or editor

**Solution:**
Files starting with `.` are hidden by default:
```bash
# Show hidden files
ls -la environments/

# Or use full path
cat environments/.env.test
```

---

## Credential Rotation

**PCI DSS Requirement 8.2.4:** Rotate credentials every 90 days (quarterly)

### Rotation Process

1. **Generate New Access Key in IAM Console:**
   - IAM → Users → amexing-test-s3-user → Security credentials
   - Create access key
   - Copy new credentials

2. **Update Local Environment:**
   ```bash
   # Edit .env.test with new credentials
   nano environments/.env.test
   ```

3. **Test New Credentials:**
   ```bash
   yarn test tests/integration/api/vehicle-images-s3.test.js
   ```

4. **Deactivate Old Key (Wait 24 Hours):**
   - IAM → Make old key inactive
   - Monitor for any usage
   - After 24h with no usage, delete old key

5. **Document Rotation:**
   ```bash
   # Log in compliance tracking system
   echo "$(date): Rotated AWS test credentials" >> docs/compliance-log.txt
   ```

### Rotation Schedule

| Quarter | Due Date | Completed | Notes |
|---------|----------|-----------|-------|
| Q1 2024 | March 31 |  | Initial setup |
| Q2 2024 | June 30  |  |  |
| Q3 2024 | Sept 30  |  |  |
| Q4 2024 | Dec 31   |  |  |

---

## PCI DSS Compliance Checklist

### Requirements Met

- [x] **Req 3.4**: Credentials encrypted at rest (local filesystem encryption, 1Password)
- [x] **Req 7.1**: Least privilege access (IAM policy restricts to test/* only)
- [x] **Req 8.2.4**: Quarterly rotation documented (see Rotation Schedule)
- [x] **Req 10.2**: Audit logging (CloudTrail logs all S3 access)
- [x] **Req 11.2**: Security scanning (Semgrep, pre-commit hooks)

### For Auditors

**Question:** "How are test credentials secured?"

**Answer:**
1. Test credentials have minimal permissions (test/* prefix only)
2. Credentials never committed to git (triple protection)
3. Rotated quarterly per PCI DSS 8.2.4
4. All S3 access logged in CloudTrail
5. Security scanning enforced via pre-commit hooks

**Question:** "What happens if test credentials leak?"

**Answer:**
1. IAM policy explicitly denies access to prod/* and dev/*
2. Attacker can only access test files in test/* prefix
3. Cannot modify bucket policies or delete bucket
4. All actions logged in CloudTrail for forensics
5. We can immediately revoke credentials in IAM console

**Documentation for Audit:**
- This file: `docs/AWS_TEST_CREDENTIALS.md`
- IAM Policy: `docs/AWS_TEST_IAM_POLICY.json`
- Configuration: `environments/.env.test.example`
- Git protection: `.gitignore`, `pre-commit` hook
- Security scanning: `.semgrep.yml`

---

## Additional Resources

- **AWS IAM Best Practices:** https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html
- **PCI DSS v4.0:** https://www.pcisecuritystandards.org/document_library
- **Semgrep Rules:** https://semgrep.dev/docs/
- **Parse Server:** https://docs.parseplatform.org/

---

## Support

**Issues with setup?**
1. Check troubleshooting section above
2. Review `environments/.env.test.example` for correct format
3. Verify IAM policy matches `docs/AWS_TEST_IAM_POLICY.json`
4. Test AWS credentials independently with AWS CLI

**Security concerns?**
- Contact security team
- Review PCI DSS compliance section
- Verify triple protection mechanisms are active
