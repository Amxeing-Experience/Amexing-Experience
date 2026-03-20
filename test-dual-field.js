/**
 * Test script for dual-field implementation
 * Check and update quote T0f4BF7A4Q with companyClientPtr
 */

const Parse = require('parse/node');

// Initialize Parse
Parse.initialize('amexing-api', 'your-js-key', 'master-key-change-in-production');
Parse.serverURL = 'http://localhost:3337/parse';

async function testDualFieldImplementation() {
  try {
    console.log('🧪 Starting dual-field implementation test...');
    
    // Get the quote T0f4BF7A4Q
    const quoteQuery = new Parse.Query('Quote');
    const quote = await quoteQuery.get('T0f4BF7A4Q', { useMasterKey: true });
    
    console.log('📋 Current quote state:', {
      id: quote.id,
      folio: quote.get('folio'),
      client: quote.get('client'),
      companyClientPtr: quote.get('companyClientPtr'),
      hasClient: !!quote.get('client'),
      hasCompanyClientPtr: !!quote.get('companyClientPtr')
    });
    
    // If companyClientPtr doesn't exist, create it
    if (!quote.get('companyClientPtr')) {
      console.log('🔧 Adding companyClientPtr to quote...');
      
      // Based on previous work, this quote should point to client 4CpRVVND2u (AmexingUser)
      // We need to find the Client record that has ownedBy pointing to 4CpRVVND2u
      const clientQuery = new Parse.Query('Client');
      clientQuery.equalTo('ownedBy', {
        __type: 'Pointer',
        className: 'AmexingUser',
        objectId: '4CpRVVND2u'
      });
      
      const clientRecords = await clientQuery.find({ useMasterKey: true });
      console.log('🔍 Found client records owned by 4CpRVVND2u:', clientRecords.length);
      
      if (clientRecords.length > 0) {
        const clientRecord = clientRecords[0];
        console.log('📋 Client record details:', {
          id: clientRecord.id,
          name: clientRecord.get('name'),
          email: clientRecord.get('email'),
          ownedBy: clientRecord.get('ownedBy')
        });
        
        // Create companyClientPtr pointer
        const companyClientPointer = {
          __type: 'Pointer',
          className: 'Client',
          objectId: clientRecord.id
        };
        
        quote.set('companyClientPtr', companyClientPointer);
        await quote.save(null, { useMasterKey: true });
        
        console.log('✅ companyClientPtr added successfully!');
      } else {
        console.log('❌ No Client record found owned by 4CpRVVND2u');
      }
    } else {
      console.log('✅ Quote already has companyClientPtr');
    }
    
    // Verify final state
    await quote.fetch({ useMasterKey: true });
    console.log('🔍 Final verification:', {
      id: quote.id,
      folio: quote.get('folio'),
      client: quote.get('client'),
      companyClientPtr: quote.get('companyClientPtr'),
      hasClient: !!quote.get('client'),
      hasCompanyClientPtr: !!quote.get('companyClientPtr')
    });
    
    console.log('🎉 Dual-field implementation test complete!');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error in dual-field test:', error);
    process.exit(1);
  }
}

// Run the test
testDualFieldImplementation();