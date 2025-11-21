import { GoogleGenAI } from '@google/genai';
import { writeFile } from 'fs/promises';
import { mkdir } from 'fs/promises';
import { readFile } from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OUTPUT_DIR = './test-images';
const TEMPLATE_IMAGE = 'TM Daily Header 1200x630  nov10.png';

// Get current date
const currentDate = new Date();
const formattedDate = currentDate.toLocaleDateString('en-US', {
  year: 'numeric',
  month: 'long',
  day: 'numeric'
});

// Initialize Gemini client
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// Generate updated header image using template
async function generateUpdatedHeader() {
  try {
    // Read the template image
    const imageBuffer = await readFile(TEMPLATE_IMAGE);
    const imageBase64 = imageBuffer.toString('base64');

    const prompt = `Please update the date in this Token Metrics daily header image. Change the date to display: "${formattedDate}". Keep all other elements, styling, colors, text, and layout exactly the same - only update the date text. The date format should be Month Day, Year (e.g., "${formattedDate}"). Make sure the new date text matches the same font style, size, and color as the original date text.`;

    const requestBody = {
      contents: [{
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: 'image/png',
              data: imageBase64
            }
          }
        ]
      }],
      generationConfig: {
        imageConfig: {
          aspectRatio: '16:9' 
        }
      }
    };

    // Make request to Gemini API
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_API_KEY}`, {
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
    console.error('Error generating updated header:', error);
    throw error;
  }
}

// Save generated image
async function saveImage(imageBuffer) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `tm-daily-header-${timestamp}.png`;
  const filepath = path.join(OUTPUT_DIR, filename);

  await writeFile(filepath, imageBuffer);
  return {
    filename,
    filepath,
    url: filepath
  };
}

// Main test function
async function runHeaderUpdateTest() {
  console.log('🚀 Starting TM Daily Header Date Update Test...');
  console.log('📅 Target date:', formattedDate);
  console.log('📁 Output directory:', OUTPUT_DIR);
  console.log('🖼️ Template image:', TEMPLATE_IMAGE);

  // Create output directory if it doesn't exist
  try {
    await mkdir(OUTPUT_DIR, { recursive: true });
    console.log('✅ Output directory created/verified');
  } catch (error) {
    console.log('📁 Output directory already exists');
  }

  // Check if template image exists
  try {
    await readFile(TEMPLATE_IMAGE);
    console.log('✅ Template image found');
  } catch (error) {
    console.error('❌ Template image not found:', TEMPLATE_IMAGE);
    return;
  }

  try {
    // Generate updated image
    console.log('🎨 Generating updated header image...');
    const imageBuffer = await generateUpdatedHeader();
    console.log('✅ Image generated successfully');

    // Save image
    console.log('💾 Saving image...');
    const savedImage = await saveImage(imageBuffer);
    console.log(`✅ Image saved: ${savedImage.filename}`);
    console.log(`📂 Path: ${savedImage.filepath}`);

    console.log('\n🎉 Test completed successfully!');
    console.log(`📁 Check the '${OUTPUT_DIR}' folder to see the updated header.`);

  } catch (error) {
    console.error('❌ Failed to generate updated header:', error.message);
  }
}

// Check if API key is available
if (!GEMINI_API_KEY) {
  console.error('❌ GEMINI_API_KEY not found in environment variables');
  process.exit(1);
}

// Run the test
runHeaderUpdateTest().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});