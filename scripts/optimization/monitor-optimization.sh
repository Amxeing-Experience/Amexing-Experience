#!/bin/bash
# Monitor optimization progress and notify when complete
# Created by Denisse Maldonado

echo "🔍 Monitoring optimization progress..."
echo ""

while true; do
    # Check if the optimization loop is still running
    if ! ps aux | grep -q "[r]un-optimization-loop.sh"; then
        echo ""
        echo "✅ Optimization loop has completed!"
        
        # Get final status
        node -e "
        const Parse = require('parse/node');
        require('dotenv').config({ path: 'environments/.env.production' });
        
        Parse.initialize(process.env.PARSE_APP_ID, null, process.env.PARSE_MASTER_KEY);
        Parse.serverURL = process.env.PARSE_SERVER_URL || 'https://quotes.amexingexperience.com/parse';
        
        async function finalStatus() {
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
            
            const percent = Math.round(fullyOptimized / images.length * 100);
            console.log('');
            console.log('🎉 FINAL RESULTS:');
            console.log('Total images:', images.length);
            console.log('Fully optimized:', fullyOptimized);
            console.log('Optimization rate:', percent + '%');
            
            if (fullyOptimized === images.length) {
                console.log('✨ ALL IMAGES ARE FULLY OPTIMIZED!');
            }
        }
        
        finalStatus().catch(console.error);
        " 2>/dev/null
        
        # Send desktop notification (macOS)
        osascript -e 'display notification "Image optimization has completed!" with title "Optimization Complete" sound name "Glass"'
        
        # Also speak it
        say "Image optimization is complete"
        
        break
    fi
    
    # Show current progress
    CURRENT=$(node -e "
    const Parse = require('parse/node');
    require('dotenv').config({ path: 'environments/.env.production' });
    
    Parse.initialize(process.env.PARSE_APP_ID, null, process.env.PARSE_MASTER_KEY);
    Parse.serverURL = process.env.PARSE_SERVER_URL || 'https://quotes.amexingexperience.com/parse';
    
    async function status() {
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
        
        console.log(fullyOptimized);
    }
    
    status().catch(() => console.log('0'));
    " 2>/dev/null)
    
    echo -ne "\r📊 Progress: $CURRENT/117 images optimized"
    
    # Check every 10 seconds
    sleep 10
done

echo ""
echo "✅ Monitoring complete!"