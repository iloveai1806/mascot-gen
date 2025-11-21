import { GoogleGenAI } from '@google/genai';
import { readFile } from 'fs/promises';
import { writeFile } from 'fs/promises';
import { mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OUTPUT_DIR = './test-images';

// Test prompts for experimentation
const testPrompts = [
  {
    prompt: "TMAI hugs the DOGE coin logo",
    description: "DOGE coin hug theme"
  },
  {
    prompt: "TMAI shakes hands with Elon Musk",
    description: "Elon Musk handshake theme"
  }
];

// Initialize new Google GenAI client
const ai = new GoogleGenAI({
  apiKey: GEMINI_API_KEY
});

// Load template images (mascot + logo)
async function loadTemplateImages() {
  try {
    const mascotTemplate = await readFile(path.join(__dirname, 'mascot-template.png'));
    const tokenMetricsLogo = await readFile(path.join(__dirname, 'TM_logo_primary_white.png'));

    console.log('✅ Template images loaded successfully');

    return {
      mascotTemplate,
      tokenMetricsLogo
    };
  } catch (error) {
    console.error('❌ Failed to load template images:', error.message);
    throw error;
  }
}

// Convert buffer to generative part for new SDK
function bufferToGenerativePart(buffer, mimeType) {
  return {
    inlineData: {
      data: buffer.toString('base64'),
      mimeType
    }
  };
}

// Generate mascot image using new Google GenAI SDK
async function generateMascotImage(prompt, templateImages) {
  try {
    console.log('🎨 Generating mascot image with new SDK...');
    console.log(`📝 Prompt: ${prompt}`);

// Create enhanced prompt
const enhancedPrompt = `You are a professional designer for Token Metrics, specializing in creating high-quality, brand-consistent visuals for marketing and communications.

User Request: "TMAI ${prompt}"

Design Requirements:
- Execute the user's creative direction precisely as specified
- Use the provided TMAI mascot image (Token Metrics' official mascot) as the foundation - maintain its exact appearance, style, and character design
- Position the Token Metrics logo prominently in the top left corner
- Ensure both the TMAI mascot and Token Metrics logo are the primary focal points
- Maintain professional quality suitable for official company use

Crypto Asset Guidelines:
- When incorporating cryptocurrency logos or symbols, only use well-known, accurately recognizable crypto brands (Bitcoin, Ethereum, Solana, DOGE, BNB, ADA..)
- DO NOT create fictional or hallucinated crypto logos
- If unsure about a specific crypto asset's visual identity, substitute with generic professional elements (charts, data visualizations, abstract tech patterns)
- Prioritize authenticity and accuracy over creative interpretation for brand assets

Style Standards:
- Keep the mascot's design strictly unchanged unless the user explicitly requests modifications
- Maintain Token Metrics' professional brand aesthetic
- Ensure visual coherence between all elements
- Create polished, publication-ready imagery
`;

    // Prepare content with template images using new SDK format
    const contents = [
      bufferToGenerativePart(templateImages.mascotTemplate, 'image/png'),
      bufferToGenerativePart(templateImages.tokenMetricsLogo, 'image/png'),
      { text: enhancedPrompt }
    ];

    // Generate image using new SDK with gemini-3-pro-image-preview
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: contents,
      generationConfig: {
        responseModalities: ['Image'],
        imageConfig: {
          aspectRatio: '16:9'
        }
      }
    });

    console.log('✅ Image generation completed');

    // Extract image data from new SDK response format
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        console.log('✅ Image data extracted from response');
        return Buffer.from(part.inlineData.data, 'base64');
      }
    }

    throw new Error('No image data found in response');

  } catch (error) {
    console.error('❌ Error generating image:', error.message);

    // Fallback to older model if new one isn't available
    if (error.message.includes('not found') || error.message.includes('does not exist')) {
      console.log('🔄 Falling back to gemini-2.5-flash-image-preview...');

      try {
        const fallbackResponse = await ai.models.generateContent({
          model: 'gemini-2.5-flash-image-preview',
          contents: contents,
          generationConfig: {
            responseModalities: ['Image'],
            imageConfig: {
              aspectRatio: '16:9'
            }
          }
        });

        for (const part of fallbackResponse.candidates[0].content.parts) {
          if (part.inlineData) {
            console.log('✅ Image generated with fallback model');
            return Buffer.from(part.inlineData.data, 'base64');
          }
        }
      } catch (fallbackError) {
        console.error('❌ Fallback model also failed:', fallbackError.message);
        throw new Error('Both models failed to generate image');
      }
    }

    throw error;
  }
}

// Save generated image with timestamp
async function saveGeneratedImage(imageBuffer, prompt) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `mascot-new-sdk-${timestamp}.png`;
  const filepath = path.join(OUTPUT_DIR, filename);

  await writeFile(filepath, imageBuffer);

  console.log(`💾 Image saved: ${filename}`);
  console.log(`📂 Path: ${filepath}`);

  return {
    filename,
    filepath,
    url: filepath
  };
}

// Main test runner
async function runTests() {
  console.log('🚀 Starting New SDK Mascot Generation Tests...');
  console.log('🔧 Using Google GenAI SDK with Gemini 3 Pro Image Preview');
  console.log('📁 Output directory:', OUTPUT_DIR);
  console.log('🎯 Test prompts:', testPrompts.length);

  // Create output directory if it doesn't exist
  try {
    await mkdir(OUTPUT_DIR, { recursive: true });
    console.log('✅ Output directory ready');
  } catch (error) {
    console.log('📁 Output directory already exists');
  }

  // Load template images
  let templateImages;
  try {
    templateImages = await loadTemplateImages();
  } catch (error) {
    console.error('❌ Failed to load template images. Make sure mascot-template.png and TM_logo_primary_white.png exist in the current directory.');
    return;
  }

  // Run each test prompt
  for (let i = 0; i < testPrompts.length; i++) {
    const testCase = testPrompts[i];
    console.log(`\n📊 Test ${i + 1}: ${testCase.description}`);

    try {
      // Generate image
      const imageBuffer = await generateMascotImage(testCase.prompt, templateImages);

      // Save image
      const savedImage = await saveGeneratedImage(imageBuffer, testCase.prompt);

      console.log(`✅ Test ${i + 1} completed successfully`);

    } catch (error) {
      console.error(`❌ Test ${i + 1} failed:`, error.message);
    }
  }

  console.log('\n🎉 All tests completed!');
  console.log(`📁 Check the '${OUTPUT_DIR}' folder to see the generated images.`);
  console.log('\n💡 This test script demonstrates:');
  console.log('   - New Google GenAI SDK integration');
  console.log('   - Gemini 3 Pro Image Preview model');
  console.log('   - 16:9 widescreen aspect ratio');
  console.log('   - Mascot + Logo template integration');
  console.log('   - Simplified testing environment');
}

// Check if API key is available
if (!GEMINI_API_KEY) {
  console.error('❌ GEMINI_API_KEY not found in environment variables');
  console.error('💡 Make sure your .env file contains: GEMINI_API_KEY=your_api_key_here');
  process.exit(1);
}

// Run the tests
runTests().catch(error => {
  console.error('❌ Test suite failed:', error.message);
  process.exit(1);
});