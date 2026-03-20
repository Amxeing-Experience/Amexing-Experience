/**
 * Quick script to fix quote T0f4BF7A4Q client pointer
 * Based on creation logs, it should point to client 4CpRVVND2u
 */

const Parse = require('parse/node');

// Initialize Parse
Parse.initialize('amexing-api', 'your-js-key', 'master-key-change-in-production');
Parse.serverURL = 'http://localhost:3337/parse';

async function fixQuoteClient() {
  try {
    console.log('🔧 Starting quote client fix...');
    
    // Get the quote
    const quoteQuery = new Parse.Query('Quote');
    const quote = await quoteQuery.get('T0f4BF7A4Q', { useMasterKey: true });
    
    console.log('📋 Quote found:', {
      id: quote.id,
      folio: quote.get('folio'),
      currentClient: quote.get('client'),
      hasClient: !!quote.get('client')
    });
    
    // Create client pointer to AmexingUser 4CpRVVND2u
    const clientPointer = {
      __type: 'Pointer',
      className: 'AmexingUser',
      objectId: '4CpRVVND2u'
    };
    
    console.log('🔗 Setting client pointer:', clientPointer);
    
    // Set the client pointer
    quote.set('client', clientPointer);
    
    // Save the quote
    await quote.save(null, { useMasterKey: true });
    
    console.log('✅ Quote updated successfully!');
    
    // Verify the update
    const updatedQuote = await quoteQuery.get('T0f4BF7A4Q', { useMasterKey: true });
    updatedQuote.include('client');
    await updatedQuote.fetch({ useMasterKey: true });
    
    console.log('🔍 Verification - Updated quote client:', {
      hasClient: !!updatedQuote.get('client'),
      clientId: updatedQuote.get('client') ? updatedQuote.get('client').id : null
    });
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error fixing quote client:', error);
    process.exit(1);
  }
}

// Run the fix
fixQuoteClient();