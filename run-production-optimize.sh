#!/bin/bash
# Script to run production optimization with confirmations
# Created by Denisse Maldonado

echo "Running production optimization for 1 image..."
echo ""

# Use expect or printf to provide the required inputs
printf "yes\nOPTIMIZE PRODUCTION\n" | node scripts/optimize-production-vehicle-images.js --limit=1 --verbose

echo ""
echo "✅ Optimization complete!"