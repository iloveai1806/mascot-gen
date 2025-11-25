import { GoogleGenAI } from "@google/genai";

// Set service account key environment variable
process.env.GOOGLE_APPLICATION_CREDENTIALS = './gemini-model-access-9f2d25140070.json';

// Vertex AI configuration
const client = new GoogleGenAI({
  vertexai: true,
  project: 'gemini-model-access',
  location: 'us-central1'
});

async function testVertexAI() {
  try {
    console.log('🤖 Testing Vertex AI text generation...');

    const response = await client.models.generateContent({
      model: 'gemini-2.0-flash-exp',
      contents: 'Say hello!'
    });

    console.log('✅ Vertex AI Response:');
    console.log(response.text);

    // Test with a more complex prompt
    console.log('\n🧪 Testing with crypto-related prompt...');

    const cryptoResponse = await client.models.generateContent({
      model: 'gemini-2.0-flash-exp',
      contents: 'Explain cryptocurrency in one sentence.'
    });

    console.log('✅ Crypto Response:');
    console.log(cryptoResponse.text);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Full error:', error);
  }
}

// Run the test
testVertexAI();