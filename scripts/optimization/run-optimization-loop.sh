#!/bin/bash
# Script to run production optimization in a loop until all images are processed
# Created by Denisse Maldonado

echo "Starting optimization loop for all production images..."
echo "This will run until all images are optimized."
echo ""

COUNTER=0
MAX_ITERATIONS=200  # Safety limit to prevent infinite loops

while [ $COUNTER -lt $MAX_ITERATIONS ]; do
    COUNTER=$((COUNTER + 1))
    
    echo "========================================="
    echo "Iteration $COUNTER"
    echo "========================================="
    
    # Check current status
    REMAINING=$(node -e "
    const Parse = require('parse/node');
    require('dotenv').config({ path: 'environments/.env.production' });
    
    Parse.initialize(process.env.PARSE_APP_ID, null, process.env.PARSE_MASTER_KEY);
    Parse.serverURL = process.env.PARSE_SERVER_URL || 'https://quotes.amexingexperience.com/parse';
    
    async function checkRemaining() {
        const query = new Parse.Query('VehicleImage');
        query.equalTo('exists', true);
        query.limit(1000);
        
        const images = await query.find({ useMasterKey: true });
        
        let notOptimized = 0;
        for (const img of images) {
            const variants = img.get('optimizedVariants');
            if (!variants || !variants.jpeg || !variants.webp || !variants.avif) {
                notOptimized++;
            }
        }
        
        console.log(notOptimized);
    }
    
    checkRemaining().catch(() => console.log('error'));
    " 2>/dev/null)
    
    if [ "$REMAINING" = "0" ] || [ "$REMAINING" = "" ] || [ "$REMAINING" = "error" ]; then
        echo "✅ All images are optimized! (or error checking status)"
        break
    fi
    
    echo "📊 Images remaining to optimize: $REMAINING"
    echo ""
    
    # Run optimization for batch of 10
    echo "Running optimization batch..."
    ./run-production-optimize.sh 10
    
    # Small delay between batches
    echo "Waiting 2 seconds before next batch..."
    sleep 2
done

if [ $COUNTER -eq $MAX_ITERATIONS ]; then
    echo "⚠️  Reached maximum iterations limit. Please check for issues."
else
    echo ""
    echo "🎉 Optimization loop complete!"
fi

# Final status check
echo ""
echo "Final status check:"
node -e "
const Parse = require('parse/node');
require('dotenv').config({ path: 'environments/.env.production' });

Parse.initialize(process.env.PARSE_APP_ID, null, process.env.PARSE_MASTER_KEY);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'https://quotes.amexingexperience.com/parse';

async function finalCheck() {
    const query = new Parse.Query('VehicleImage');
    query.equalTo('exists', true);
    query.limit(1000);
    
    const images = await query.find({ useMasterKey: true });
    
    let fullyOptimized = 0;
    let notOptimized = 0;
    
    for (const img of images) {
        const variants = img.get('optimizedVariants');
        if (variants && variants.jpeg && variants.webp && variants.avif) {
            fullyOptimized++;
        } else {
            notOptimized++;
        }
    }
    
    console.log('Total images:', images.length);
    console.log('Fully optimized:', fullyOptimized);
    console.log('Not optimized:', notOptimized);
    console.log('Optimization rate:', Math.round(fullyOptimized / images.length * 100) + '%');
}

finalCheck().catch(console.error);
"