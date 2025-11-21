import { GoogleGenAI } from '@google/genai';
import { writeFile } from 'fs/promises';
import { mkdir } from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OUTPUT_DIR = './test-images';

// Initialize Gemini client
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// Test data - 3 sets of company names for different industries
const testData = [
  {
    category: "Cloud Infrastructure Providers",
    companies: [
      "Amazon Web Services (AWS)",
      "Microsoft Azure",
      "Google Cloud Platform",
      "IBM Cloud",
      "Oracle Cloud",
      "Alibaba Cloud",
      "Tencent Cloud",
      "DigitalOcean",
      "Vultr",
      "Linode"
    ]
  },
  {
    category: "AI Model Providers",
    companies: [
      "OpenAI",
      "Google DeepMind",
      "Anthropic",
      "Meta AI",
      "Mistral AI",
      "Cohere",
      "Inflection",
      "xAI",
      "Zhipu AI",
      "Stability AI"
    ]
  },
  {
    category: "Blockchain Platforms",
    companies: [
      "Ethereum",
      "Solana",
      "Cardano",
      "Polkadot",
      "Avalanche",
      "Polygon",
      "Cosmos",
      "Near Protocol",
      "Algorand",
      "Hedera"
    ]
  }
];

// Generate image using Gemini API
async function generatePodiumImage(category, companies) {
  try {
    const prompt = `Design an image of a 'mountain peak' style podium for the top 10 companies. The first-place company should be at the absolute highest point, on top of a jagged or crystalline mountain structure. The 2nd and 3rd place companies should be on prominent, elevated platforms on either side of the main peak. The remaining 7 companies (4th through 10th) should be displayed on individual platforms cascading down the sides of the mountain, maintaining a clear visual hierarchy. The scene should evoke a sense of futuristic achievement, possibly with glowing lines or energy. A title 'Top 10 ${category} Providers' should be displayed at the top of the image.

CRITICAL INSTRUCTION: Pay SPECIAL ATTENTION to the company names. They must be CRYSTAL CLEAR and PERFECTLY LEGIBLE. Each company name must be prominently displayed with clear, readable text. The company names are the most important element - they must be easily readable without any blurring, distortion, or artistic effects that make them hard to read. Use high contrast colors and appropriate font sizing to ensure maximum readability.

Companies to display in order:
1. ${companies[0]}
2. ${companies[1]}
3. ${companies[2]}
4. ${companies[3]}
5. ${companies[4]}
6. ${companies[5]}
7. ${companies[6]}
8. ${companies[7]}
9. ${companies[8]}
10. ${companies[9]}

IMPORTANT: Make sure each company name is perfectly visible and legible. The text quality is paramount.`;

    const requestBody = {
      contents: [{
        parts: [
          { text: prompt }
        ]
      }],
      generationConfig: {
        imageConfig: {
          aspectRatio: '16:9'
        }
      }
    };

    // Make request to Gemini API (using same endpoint as server.js)
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${errorText}`);
    }

    const result = await response.json();

    // Extract image data from response
    if (result.candidates && result.candidates.length > 0) {
      const candidate = result.candidates[0];
      if (candidate.content && candidate.content.parts) {
        for (const part of candidate.content.parts) {
          if (part.inlineData && part.inlineData.data) {
            return Buffer.from(part.inlineData.data, 'base64');
          }
        }
      }
    }

    throw new Error('No image data received from Gemini API');
  } catch (error) {
    console.error('Error generating image:', error);
    throw error;
  }
}

// Save generated image
async function saveImage(imageBuffer, category, index) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${category.toLowerCase().replace(/\s+/g, '-')}-podium-${index}-${timestamp}.png`;
  const filepath = path.join(OUTPUT_DIR, filename);

  await writeFile(filepath, imageBuffer);
  return {
    filename,
    filepath,
    url: filepath
  };
}

// Main test function
async function runPodiumTests() {
  console.log('🚀 Starting Mountain Peak Podium Tests...');
  console.log('📁 Output directory:', OUTPUT_DIR);

  // Create output directory if it doesn't exist
  try {
    await mkdir(OUTPUT_DIR, { recursive: true });
    console.log('✅ Output directory created/verified');
  } catch (error) {
    console.log('📁 Output directory already exists');
  }

  // Test each dataset
  for (let i = 0; i < testData.length; i++) {
    const data = testData[i];
    console.log(`\n📊 Test ${i + 1}: ${data.category}`);
    console.log('🏢 Companies:', data.companies.join(', '));

    try {
      // Generate image
      console.log('🎨 Generating image...');
      const imageBuffer = await generatePodiumImage(data.category, data.companies);
      console.log('✅ Image generated successfully');

      // Save image
      console.log('💾 Saving image...');
      const savedImage = await saveImage(imageBuffer, data.category, i + 1);
      console.log(`✅ Image saved: ${savedImage.filename}`);
      console.log(`📂 Path: ${savedImage.filepath}`);

    } catch (error) {
      console.error(`❌ Failed to generate image for ${data.category}:`, error.message);
    }
  }

  console.log('\n🎉 All tests completed!');
  console.log(`📁 Check the '${OUTPUT_DIR}' folder to see the results.`);
}

// Check if API key is available
if (!GEMINI_API_KEY) {
  console.error('❌ GEMINI_API_KEY not found in environment variables');
  process.exit(1);
}

// Run the tests
runPodiumTests().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});