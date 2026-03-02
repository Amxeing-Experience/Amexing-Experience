require('dotenv').config({ path: 'environments/.env.development' });
const fetch = require('node-fetch');

async function testExperienceAPI() {
  // Login first
  const loginResponse = await fetch('http://localhost:1337/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@amexing.com',
      password: 'AmexingSuperPassword2024!'
    })
  });
  
  const loginData = await loginResponse.json();
  console.log('Login success:', loginData.success);
  
  if (!loginData.token) {
    console.error('No token received');
    return;
  }
  
  // Get experience images
  const experienceId = 'TuMI1HMe3T';
  const imagesResponse = await fetch(`http://localhost:1337/api/experiences/${experienceId}/images`, {
    headers: {
      'Accept': 'image/avif,image/webp,image/*',
      'Authorization': `Bearer ${loginData.token}`
    }
  });
  
  const imagesData = await imagesResponse.json();
  console.log('\nAPI Response:');
  console.log('- Success:', imagesData.success);
  console.log('- Count:', imagesData.count);
  
  if (imagesData.data && imagesData.data.length > 0) {
    console.log('\nFirst image details:');
    const firstImage = imagesData.data[0];
    console.log('- fileName:', firstImage.fileName);
    console.log('- Has URL:', !!firstImage.url);
    console.log('- Has optimizationMetadata:', !!firstImage.optimizationMetadata);
    
    if (firstImage.optimizationMetadata) {
      console.log('- Metadata formats:', firstImage.optimizationMetadata.formats);
      console.log('- Metadata availableFormats:', firstImage.optimizationMetadata.availableFormats);
    }
  }
}

testExperienceAPI().catch(console.error);