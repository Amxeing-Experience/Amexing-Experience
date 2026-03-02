#!/bin/bash
# Continuous optimization script that runs in smaller batches
# Created by Denisse Maldonado

echo "🔄 Starting continuous optimization..."
echo ""

# Function to check remaining count
get_remaining() {
    node -e "
    const Parse = require('parse/node');
    require('dotenv').config({ path: 'environments/.env.production' });
    
    Parse.initialize(process.env.PARSE_APP_ID, null, process.env.PARSE_MASTER_KEY);
    Parse.serverURL = process.env.PARSE_SERVER_URL || 'https://quotes.amexingexperience.com/parse';
    
    async function getRemainingCount() {
        const query = new Parse.Query('VehicleImage');
        query.equalTo('exists', true);
        query.limit(1000);
        
        const images = await query.find({ useMasterKey: true });
        
        let fullyOptimized = 0;
        for (const img of images) {
            const variants = img.get('optimizedVariants');
            if (variants && variants.jpeg && variants.webp && variants.avif) {
                fullyOptimized++;
            }
        }
        
        console.log(images.length - fullyOptimized);
    }
    
    getRemainingCount().catch(() => console.log('96'));
    " 2>/dev/null
}

# Run optimization batches until complete
BATCH_SIZE=5
COUNTER=0

while true; do
    REMAINING=$(get_remaining)
    
    echo "📊 Remaining images to optimize: $REMAINING"
    
    if [ "$REMAINING" -eq 0 ]; then
        echo ""
        echo "🎉 ALL IMAGES OPTIMIZED!"
        
        # Send notification
        osascript -e 'display notification "All vehicle images have been optimized!" with title "Optimization Complete" sound name "Glass"'
        say "All images are now optimized"
        
        break
    fi
    
    echo "🔄 Running batch $((COUNTER + 1)) (processing $BATCH_SIZE images)..."
    
    # Run optimization
    ./run-production-optimize.sh $BATCH_SIZE
    
    COUNTER=$((COUNTER + 1))
    
    # Short pause between batches
    sleep 5
    
    echo ""
done

echo "✅ Continuous optimization complete!"