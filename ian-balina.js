import { GoogleGenAI } from '@google/genai';
import { readFile, writeFile } from 'fs/promises';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const INPUT_IMAGE = '/Users/phattran/Downloads/ian-balina.jpg';
const OUTPUT_IMAGE = './ian-balina-bg-removed.png';

// Initialize Google GenAI
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// Main function
async function removeBackground() {
  try {
    console.log('🎨 Removing background from image...');

    // Read the input image
    const imageBuffer = await readFile(INPUT_IMAGE);
    console.log('✅ Input image loaded');

    // Convert image to base64 for Gemini
    const base64Image = imageBuffer.toString('base64');

    // Create prompt for background removal
    const prompt = `
Please remove the background from this image and keep only the person in the center (Ian Balina).
The output should be a transparent PNG with just the person, no background.
Make sure to preserve the person's details and create clean edges.
`;

    console.log('🤖 Processing with Gemini...');

    // Generate image with Gemini 3 Pro
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: [
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: base64Image
          }
        },
        { text: prompt }
      ],
      generationConfig: {
        responseModalities: ['Image'],
        temperature: 0.1
      }
    });

    // Extract image from response
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        const resultImage = Buffer.from(part.inlineData.data, 'base64');
        await writeFile(OUTPUT_IMAGE, resultImage);
        console.log(`✅ Background removed! Saved as: ${OUTPUT_IMAGE}`);
        return;
      }
    }

    throw new Error('No image data found in response');

  } catch (error) {
    console.error('❌ Error removing background:', error.message);
  }
}

// Check if API key is available
if (!GEMINI_API_KEY) {
  console.error('❌ GEMINI_API_KEY not found in environment variables');
  console.error('💡 Make sure your .env file contains: GEMINI_API_KEY=your_api_key_here');
  process.exit(1);
}

// Run the script
removeBackground();