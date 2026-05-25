/**
 * Renderer DevTools for synchronization checking
 * Provides browser-based tools to check and maintain sync between main services and unified renderer
 * Created by Denisse Maldonado
 */

(function(window) {
    'use strict';

    const RendererDevTools = {
        // Test service for comparison
        getTestService: function() {
            // Get a real service from current quote if available
            if (window.quoteServices && window.quoteServices.services.size > 0) {
                const firstService = window.quoteServices.services.values().next().value;
                return firstService;
            }
            
            // Otherwise return a comprehensive test service
            return {
                id: 'test-123',
                type: 'transport',
                transportType: 'aeropuerto',
                directionType: 'arrival',
                concept: 'Aeropuerto: Test Service',
                vehicleTypeName: 'SUBURBAN',
                origin: '(BJX) Aeropuerto Internacional de Leon',
                destination: 'San Miguel de Allende, Hotel Test',
                airline: 'Volaris',
                flightNumber: 'Y4 123',
                time: '13:45',
                transportAdults: 2,
                transportChildren: 1,
                includeGuide: true,
                includeGreeter: false,
                notes: 'Test notes for comparison',
                total: 4500.00,
                pricesByType: {
                    efectivo: 3870,
                    transferencia: 4500,
                    tarjeta: 4770
                }
            };
        },

        // Extract HTML from main services renderer
        renderMainView: function(service) {
            if (!window.quoteServices || !window.quoteServices.renderServiceHTML) {
                console.error('Main services renderer not found');
                return '';
            }
            
            // Render using main services method
            const html = window.quoteServices.renderServiceHTML(service);
            return this.normalizeHTML(html);
        },

        // Render using unified renderer
        renderUnifiedView: function(service) {
            if (!window.ServicesRenderer) {
                console.error('Unified renderer not found');
                return '';
            }
            
            // Render using unified renderer in list mode
            const html = window.ServicesRenderer.render([service], 'list');
            return this.normalizeHTML(html);
        },

        // Normalize HTML for comparison
        normalizeHTML: function(html) {
            // Remove dynamic IDs and timestamps
            return html
                .replace(/data-service-id="[^"]+"/g, 'data-service-id="ID"')
                .replace(/id="[^"]+"/g, 'id="ID"')
                .replace(/\s+/g, ' ')
                .replace(/>\s+</g, '><')
                .trim();
        },

        // Compare two HTML strings and find differences
        diffHTML: function(html1, html2) {
            const differences = [];
            
            // Check for badge differences
            const badges1 = html1.match(/<span class="badge[^>]+>.*?<\/span>/g) || [];
            const badges2 = html2.match(/<span class="badge[^>]+>.*?<\/span>/g) || [];
            
            if (badges1.length !== badges2.length) {
                differences.push({
                    type: 'badges',
                    main: badges1.length + ' badges',
                    unified: badges2.length + ' badges'
                });
            }
            
            // Check for specific text content
            const checkTextDifference = (pattern, name) => {
                const match1 = html1.match(pattern);
                const match2 = html2.match(pattern);
                
                if ((match1 && !match2) || (!match1 && match2) || 
                    (match1 && match2 && match1[1] !== match2[1])) {
                    differences.push({
                        type: name,
                        main: match1 ? match1[1] : 'missing',
                        unified: match2 ? match2[1] : 'missing'
                    });
                }
            };
            
            checkTextDifference(/>Hora de llegada:?\s*([^<]+)</i, 'arrival-time-label');
            checkTextDifference(/>Horario de salida:?\s*([^<]+)</i, 'departure-time-label');
            checkTextDifference(/>Dirección de llegada:?\s*([^<]+)</i, 'address-label');
            checkTextDifference(/>Aerolínea:?\s*([^<]+)</i, 'airline-label');
            
            return differences;
        },

        // Main sync check function
        checkRendererSync: async function() {
            console.group('🔍 Renderer Synchronization Check');
            
            try {
                // Get test service
                const testService = this.getTestService();
                console.log('Test service:', testService.concept || testService.type);
                
                // Render both versions
                const mainHTML = this.renderMainView(testService);
                const unifiedHTML = this.renderUnifiedView(testService);
                
                if (!mainHTML || !unifiedHTML) {
                    console.error('❌ Could not render service in one or both renderers');
                    console.groupEnd();
                    return false;
                }
                
                // Compare
                const differences = this.diffHTML(mainHTML, unifiedHTML);
                
                if (differences.length === 0) {
                    console.log('✅ Renderers are in sync!');
                    console.groupEnd();
                    return true;
                }
                
                // Show differences
                console.warn('⚠️ Renderers are out of sync!');
                console.table(differences);
                console.log('💡 Run "npm run sync-renderer" to fix these differences');
                
                // Store differences for later use
                this.lastDifferences = differences;
                
                console.groupEnd();
                return false;
                
            } catch (error) {
                console.error('Error during sync check:', error);
                console.groupEnd();
                return false;
            }
        },

        // Show visual comparison
        showVisualComparison: function(serviceId) {
            const service = serviceId ? 
                window.quoteServices.services.get(serviceId) : 
                this.getTestService();
            
            if (!service) {
                console.error('Service not found');
                return;
            }
            
            // Create comparison popup
            const modal = document.createElement('div');
            modal.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 90%;
                max-width: 1200px;
                height: 80vh;
                background: white;
                border: 2px solid #0d6efd;
                border-radius: 8px;
                padding: 20px;
                z-index: 10000;
                overflow: auto;
                box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            `;
            
            const mainHTML = this.renderMainView(service);
            const unifiedHTML = this.renderUnifiedView(service);
            
            modal.innerHTML = `
                <h3 style="margin-bottom: 20px;">Renderer Comparison</h3>
                <button onclick="this.parentElement.remove()" style="position: absolute; top: 10px; right: 10px; padding: 5px 10px;">Close</button>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                    <div>
                        <h4 style="color: #0d6efd;">Main Services View</h4>
                        <div style="border: 1px solid #dee2e6; padding: 10px; border-radius: 4px;">
                            ${mainHTML}
                        </div>
                    </div>
                    <div>
                        <h4 style="color: #198754;">Unified Renderer</h4>
                        <div style="border: 1px solid #dee2e6; padding: 10px; border-radius: 4px;">
                            ${unifiedHTML}
                        </div>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
        },

        // Check specific service type
        checkServiceType: function(type) {
            console.group(`🔍 Checking ${type} services`);
            
            let syncStatus = true;
            let checkedCount = 0;
            
            window.quoteServices.services.forEach((service, id) => {
                if (service.type === type) {
                    const mainHTML = this.renderMainView(service);
                    const unifiedHTML = this.renderUnifiedView(service);
                    const differences = this.diffHTML(mainHTML, unifiedHTML);
                    
                    if (differences.length > 0) {
                        console.warn(`Service ${service.concept}: ${differences.length} differences`);
                        syncStatus = false;
                    }
                    checkedCount++;
                }
            });
            
            if (checkedCount === 0) {
                console.log(`No ${type} services found to check`);
            } else if (syncStatus) {
                console.log(`✅ All ${checkedCount} ${type} services are in sync`);
            } else {
                console.warn(`⚠️ Some ${type} services are out of sync`);
            }
            
            console.groupEnd();
            return syncStatus;
        },

        // Generate sync report
        generateSyncReport: function() {
            const report = {
                timestamp: new Date().toISOString(),
                types: {},
                summary: {
                    total: 0,
                    synced: 0,
                    outOfSync: 0
                }
            };
            
            const types = ['transport', 'tour', 'experience', 'concepto', 'a-disposicion'];
            
            types.forEach(type => {
                const services = [];
                
                window.quoteServices.services.forEach((service) => {
                    if (service.type === type) {
                        const mainHTML = this.renderMainView(service);
                        const unifiedHTML = this.renderUnifiedView(service);
                        const differences = this.diffHTML(mainHTML, unifiedHTML);
                        
                        services.push({
                            concept: service.concept,
                            synced: differences.length === 0,
                            differences: differences
                        });
                        
                        report.summary.total++;
                        if (differences.length === 0) {
                            report.summary.synced++;
                        } else {
                            report.summary.outOfSync++;
                        }
                    }
                });
                
                if (services.length > 0) {
                    report.types[type] = services;
                }
            });
            
            console.group('📊 Renderer Sync Report');
            console.log(`Total services: ${report.summary.total}`);
            console.log(`✅ Synced: ${report.summary.synced}`);
            console.log(`⚠️ Out of sync: ${report.summary.outOfSync}`);
            
            if (report.summary.outOfSync > 0) {
                console.log('\nDetails by type:');
                Object.entries(report.types).forEach(([type, services]) => {
                    const outOfSync = services.filter(s => !s.synced);
                    if (outOfSync.length > 0) {
                        console.group(type);
                        outOfSync.forEach(s => {
                            console.log(`${s.concept}: ${s.differences.length} differences`);
                        });
                        console.groupEnd();
                    }
                });
            }
            
            console.groupEnd();
            
            return report;
        }
    };

    // Attach to window for console access
    window.DevTools = window.DevTools || {};
    window.DevTools = Object.assign(window.DevTools, RendererDevTools);
    
    // Add helpful console message when loaded
    if (window.location.href.includes('quotes') && window.location.href.includes('section=services')) {
        console.log('🛠️ Renderer DevTools loaded. Available commands:');
        console.log('  DevTools.checkRendererSync() - Check if renderers are in sync');
        console.log('  DevTools.showVisualComparison() - Show side-by-side comparison');
        console.log('  DevTools.checkServiceType("transport") - Check specific type');
        console.log('  DevTools.generateSyncReport() - Full sync report');
    }

})(window);