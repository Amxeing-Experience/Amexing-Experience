// Test Price Creation Script for Browser Console
// Copy and paste this into the browser console at http://localhost:1337/dashboard/admin/price-settings

async function createTestPriceData() {
    console.log('🚀 Creating test price data...');
    
    try {
        // Create RatePrice test data
        console.log('📦 Creating RatePrice records...');
        for (let i = 1; i <= 3; i++) {
            const response = await fetch('/parse/classes/RatePrice', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Parse-Application-Id': window.parseAppId || 'AmexingWeb'
                },
                body: JSON.stringify({
                    name: `Tarifa de Prueba ${i}`,
                    description: `Tarifa para testing de inflación ${i}`,
                    price: 100 * i,
                    active: true,
                    exists: true,
                    isTestData: true
                })
            });
            
            if (response.ok) {
                const result = await response.json();
                console.log(`✅ Created RatePrice: Tarifa de Prueba ${i} - $${100 * i}`);
            }
        }
        
        // Create TourPrice test data
        console.log('📦 Creating TourPrice records...');
        for (let i = 1; i <= 3; i++) {
            const response = await fetch('/parse/classes/TourPrice', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Parse-Application-Id': window.parseAppId || 'AmexingWeb'
                },
                body: JSON.stringify({
                    name: `Tour de Prueba ${i}`,
                    description: `Tour para testing de inflación ${i}`,
                    price: 500 * i,
                    active: true,
                    exists: true,
                    isTestData: true
                })
            });
            
            if (response.ok) {
                const result = await response.json();
                console.log(`✅ Created TourPrice: Tour de Prueba ${i} - $${500 * i}`);
            }
        }
        
        // Create ClientPrice test data
        console.log('📦 Creating ClientPrice records...');
        for (let i = 1; i <= 3; i++) {
            const response = await fetch('/parse/classes/ClientPrice', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Parse-Application-Id': window.parseAppId || 'AmexingWeb'
                },
                body: JSON.stringify({
                    name: `Cliente Precio ${i}`,
                    description: `Precio especial cliente ${i}`,
                    price: 250 * i,
                    active: true,
                    exists: true,
                    isTestData: true
                })
            });
            
            if (response.ok) {
                const result = await response.json();
                console.log(`✅ Created ClientPrice: Cliente Precio ${i} - $${250 * i}`);
            }
        }
        
        console.log('🎉 Test data created successfully!');
        console.log('Now you can test the inflation process.');
        
    } catch (error) {
        console.error('❌ Error creating test data:', error);
    }
}

async function checkTestData() {
    console.log('🔍 Checking existing test data...');
    
    const classes = ['RatePrice', 'TourPrice', 'ClientPrice'];
    
    for (const className of classes) {
        try {
            const response = await fetch(`/parse/classes/${className}?where=${encodeURIComponent('{"isTestData":true}')}`, {
                headers: {
                    'X-Parse-Application-Id': window.parseAppId || 'AmexingWeb'
                }
            });
            
            if (response.ok) {
                const result = await response.json();
                console.log(`📊 ${className}: ${result.results.length} test records found`);
                result.results.forEach(record => {
                    console.log(`  - ${record.name}: $${record.price}`);
                });
            }
        } catch (error) {
            console.error(`Error checking ${className}:`, error);
        }
    }
}

async function cleanupTestData() {
    console.log('🧹 Cleaning up test data...');
    
    const classes = ['RatePrice', 'TourPrice', 'ClientPrice'];
    
    for (const className of classes) {
        try {
            // First get the test records
            const response = await fetch(`/parse/classes/${className}?where=${encodeURIComponent('{"isTestData":true}')}`, {
                headers: {
                    'X-Parse-Application-Id': window.parseAppId || 'AmexingWeb'
                }
            });
            
            if (response.ok) {
                const result = await response.json();
                
                // Delete each record
                for (const record of result.results) {
                    const deleteResponse = await fetch(`/parse/classes/${className}/${record.objectId}`, {
                        method: 'DELETE',
                        headers: {
                            'X-Parse-Application-Id': window.parseAppId || 'AmexingWeb'
                        }
                    });
                    
                    if (deleteResponse.ok) {
                        console.log(`🗑️ Deleted ${className}: ${record.name}`);
                    }
                }
            }
        } catch (error) {
            console.error(`Error cleaning ${className}:`, error);
        }
    }
    
    console.log('✅ Cleanup completed!');
}

// Expose functions to console
window.createTestPriceData = createTestPriceData;
window.checkTestData = checkTestData;
window.cleanupTestData = cleanupTestData;

console.log('📋 Test data functions loaded. Available commands:');
console.log('  createTestPriceData() - Create test price records');
console.log('  checkTestData() - Check existing test records');
console.log('  cleanupTestData() - Remove all test records');
console.log('');
console.log('💡 Run createTestPriceData() first to create test data for inflation testing.');