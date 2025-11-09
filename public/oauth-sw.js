/**
 * OAuth ServiceWorker - Mobile Performance Optimization
 * Caches OAuth-related resources for faster mobile loading
 */

const CACHE_NAME = 'oauth-v1';
const OAUTH_RESOURCES = [
  '/css/oauth-styles.css',
  '/css/mobile-oauth-styles.css',
  '/js/oauth-provider.js',
  '/js/corporate-oauth-interface.js',
  '/js/intelligent-provider-selector.js',
  '/js/mobile-oauth-optimizer.js'
];

// Provider icons as data URLs for offline access
const PROVIDER_ICONS = {
  google: "data:image/svg+xml,%3Csvg width='20' height='20' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='%23db4437' d='M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z'/%3E%3Cpath fill='%230f9d58' d='M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z'/%3E%3Cpath fill='%23ffbc05' d='M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z'/%3E%3Cpath fill='%23ea4335' d='M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z'/%3E%3C/svg%3E",
  microsoft: "data:image/svg+xml,%3Csvg width='20' height='20' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='%23f35325' d='M1 1h10v10H1z'/%3E%3Cpath fill='%2381bc06' d='M12 1h10v10H12z'/%3E%3Cpath fill='%2305a6f0' d='M1 12h10v10H1z'/%3E%3Cpath fill='%23ffba08' d='M12 12h10v10H12z'/%3E%3C/svg%3E",
  apple: "data:image/svg+xml,%3Csvg width='18' height='20' viewBox='0 0 814 1000' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='%23000' d='M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 201.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 65.6 0 120.5 43.9 162.2 43.9 40.8 0 101.2-46.4 175.8-46.4 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z'/%3E%3C/svg%3E"
};

// Install event - cache OAuth resources
self.addEventListener('install', (event) => {
  console.log('OAuth ServiceWorker installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Caching OAuth resources');
        return cache.addAll(OAUTH_RESOURCES);
      })
      .then(() => {
        console.log('OAuth ServiceWorker installed successfully');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('OAuth ServiceWorker installation failed:', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('OAuth ServiceWorker activating...');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME && cacheName.startsWith('oauth-')) {
              console.log('Deleting old OAuth cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('OAuth ServiceWorker activated');
        return self.clients.claim();
      })
  );
});

// Fetch event - serve cached resources
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Only handle OAuth-related requests
  if (!isOAuthResource(url.pathname)) {
    return;
  }
  
  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          console.log('Serving from cache:', url.pathname);
          return cachedResponse;
        }
        
        // Not in cache, fetch from network
        return fetch(event.request)
          .then((networkResponse) => {
            // Don't cache if not a successful response
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }
            
            // Clone the response before caching
            const responseToCache = networkResponse.clone();
            
            caches.open(CACHE_NAME)
              .then((cache) => {
                console.log('Caching network response:', url.pathname);
                cache.put(event.request, responseToCache);
              });
              
            return networkResponse;
          })
          .catch((error) => {
            console.error('Network fetch failed for:', url.pathname, error);
            
            // For provider icons, serve from embedded data URLs
            if (url.pathname.includes('provider-icon')) {
              const provider = extractProviderFromPath(url.pathname);
              if (provider && PROVIDER_ICONS[provider]) {
                return new Response(PROVIDER_ICONS[provider], {
                  headers: { 'Content-Type': 'image/svg+xml' }
                });
              }
            }
            
            throw error;
          });
      })
  );
});

// Helper function to check if request is OAuth-related
function isOAuthResource(pathname) {
  return OAUTH_RESOURCES.some(resource => pathname.endsWith(resource)) ||
         pathname.includes('/oauth/') ||
         pathname.includes('oauth-') ||
         pathname.includes('provider-icon');
}

// Extract provider name from icon path
function extractProviderFromPath(pathname) {
  const match = pathname.match(/provider-icon[/-](\w+)/);
  return match ? match[1] : null;
}

// Background sync for OAuth analytics (when supported)
if ('sync' in self.registration) {
  self.addEventListener('sync', (event) => {
    if (event.tag === 'oauth-analytics') {
      event.waitUntil(syncOAuthAnalytics());
    }
  });
}

async function syncOAuthAnalytics() {
  try {
    // Sync any pending OAuth analytics data
    const analyticsData = await getStoredAnalytics();
    if (analyticsData && analyticsData.length > 0) {
      await fetch('/api/oauth/analytics/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ events: analyticsData })
      });
      
      // Clear stored data after successful sync
      await clearStoredAnalytics();
      console.log('OAuth analytics synced successfully');
    }
  } catch (error) {
    console.error('OAuth analytics sync failed:', error);
  }
}

async function getStoredAnalytics() {
  try {
    const cache = await caches.open('oauth-analytics');
    const response = await cache.match('/analytics-data');
    if (response) {
      return await response.json();
    }
  } catch (error) {
    console.error('Failed to get stored analytics:', error);
  }
  return [];
}

async function clearStoredAnalytics() {
  try {
    const cache = await caches.open('oauth-analytics');
    await cache.delete('/analytics-data');
  } catch (error) {
    console.error('Failed to clear stored analytics:', error);
  }
}

// Message handling for cache updates
self.addEventListener('message', (event) => {
  const { type, data } = event.data;
  
  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
      
    case 'UPDATE_CACHE':
      event.waitUntil(updateCache(data.resources));
      break;
      
    case 'CLEAR_CACHE':
      event.waitUntil(clearCache());
      break;
      
    case 'STORE_ANALYTICS':
      event.waitUntil(storeAnalytics(data.events));
      break;
  }
});

async function updateCache(resources) {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(resources);
    console.log('Cache updated with new resources');
  } catch (error) {
    console.error('Cache update failed:', error);
  }
}

async function clearCache() {
  try {
    await caches.delete(CACHE_NAME);
    console.log('OAuth cache cleared');
  } catch (error) {
    console.error('Cache clear failed:', error);
  }
}

async function storeAnalytics(events) {
  try {
    const cache = await caches.open('oauth-analytics');
    const existingData = await getStoredAnalytics();
    const combinedData = [...existingData, ...events];
    
    const response = new Response(JSON.stringify(combinedData), {
      headers: { 'Content-Type': 'application/json' }
    });
    
    await cache.put('/analytics-data', response);
    console.log('Analytics data stored for later sync');
  } catch (error) {
    console.error('Failed to store analytics:', error);
  }
}

console.log('OAuth ServiceWorker loaded');