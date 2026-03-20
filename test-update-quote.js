/**
 * Test script to update a quote with a client using our dual-field fix
 */

const Parse = require('parse/node');

// Initialize Parse
Parse.initialize('amexing-api', 'your-js-key', 'master-key-change-in-production');
Parse.serverURL = 'http://localhost:3337/parse';

async function testUpdateQuote() {
  try {
    console.log('🧪 Testing updateQuote with dual-field client fix...');
    
    // Test with quote e5fJuvZD7P (QTE-2026-0033) 
    const quoteId = 'e5fJuvZD7P';
    const clientId = '4CpRVVND2u'; // Client ID we want to assign
    
    console.log(`📋 Updating quote ${quoteId} with client ${clientId}...`);
    
    // Get the quote first to see current state
    const quoteQuery = new Parse.Query('Quote');
    quoteQuery.include('client');
    quoteQuery.include('companyClientPtr');
    const quote = await quoteQuery.get(quoteId, { useMasterKey: true });
    
    console.log('📋 Current quote state:', {
      id: quote.id,
      folio: quote.get('folio'),
      client: quote.get('client'),
      companyClientPtr: quote.get('companyClientPtr'),
      hasClient: !!quote.get('client'),
      hasCompanyClientPtr: !!quote.get('companyClientPtr')
    });
    
    // Update the quote with a client
    quote.set('client', clientId); // This should trigger our dual-field logic
    quote.set('contactPerson', 'Updated via script'); // Add a small change to trigger update
    
    await quote.save(null, { useMasterKey: true });
    
    console.log('✅ Quote updated! Re-fetching to verify...');
    
    // Fetch again to verify the changes
    const updatedQuote = await quoteQuery.get(quoteId, { useMasterKey: true });
    
    console.log('🔍 Updated quote state:', {
      id: updatedQuote.id,
      folio: updatedQuote.get('folio'),
      client: updatedQuote.get('client'),
      companyClientPtr: updatedQuote.get('companyClientPtr'),
      hasClient: !!updatedQuote.get('client'),
      hasCompanyClientPtr: !!updatedQuote.get('companyClientPtr'),
      contactPerson: updatedQuote.get('contactPerson')
    });
    
    console.log('🎉 Test completed!');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error testing updateQuote:', error);
    process.exit(1);
  }
}

// Run the test
testUpdateQuote();