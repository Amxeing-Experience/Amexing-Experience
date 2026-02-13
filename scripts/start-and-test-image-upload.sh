#!/bin/bash

# Start and Test Image Upload Script
# Created by Denisse Maldonado

echo "🚀 Starting AmexingWeb Server and Testing Image Upload"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if server is already running
echo "Checking if server is already running..."
if curl -s http://localhost:1337/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Server already running on port 1337"
else
    echo -e "${YELLOW}⚠${NC} Server not running. Starting server..."
    echo "Please run in a separate terminal: yarn dev"
    echo "Then run this script again."
    exit 1
fi

echo ""
echo -e "${BLUE}Testing Image Upload...${NC}"
echo ""

# Run the image upload test
node scripts/test-vehicle-image-upload.js

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ Test completed successfully!${NC}"
    echo ""
    echo "You can also test manually by:"
    echo "1. Creating/uploading images to a vehicle via API"
    echo "2. Running: node scripts/quick-image-test.js [your-image.jpg]"
    echo "3. Checking optimized images in test-optimized/ folder"
else
    echo ""
    echo -e "${RED}❌ Test failed${NC}"
    echo "Please check the error messages above"
fi