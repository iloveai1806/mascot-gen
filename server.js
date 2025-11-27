import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import env from '@fastify/env';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';
import fetch from 'node-fetch';
import { WebClient } from '@slack/web-api';
import { mkdir, writeFile } from 'fs/promises';
import { GoogleGenAI } from '@google/genai';
import { getRandomWorkingMessage } from './working-messages.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Fastify server
const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info'
  }
});

// Environment configuration schema
const envSchema = {
  type: 'object',
  required: ['PORT', 'IMAGE_SLACK_BOT_TOKEN', 'IMAGE_SLACK_SIGNING_SECRET', 'TMAI_SLACK_BOT_TOKEN', 'TMAI_SLACK_SIGNING_SECRET', 'GEMINI_API_KEY', 'IMAGE_SLACK_BOT_USER_ID'],
  properties: {
    PORT: { type: 'string', default: '0110' },
    HOST: { type: 'string', default: '0.0.0.0' },
    LOG_LEVEL: { type: 'string', default: 'info' },
    IMAGE_SLACK_BOT_TOKEN: { type: 'string' },
    IMAGE_SLACK_SIGNING_SECRET: { type: 'string' },
    TMAI_SLACK_BOT_TOKEN: { type: 'string' },
    TMAI_SLACK_SIGNING_SECRET: { type: 'string' },
    IMAGE_SLACK_BOT_USER_ID: { type: 'string' },
    TARGET_CHANNEL: { type: 'string', default: 'C08BW4X3VMX' },
    OUTPUT_DIR: { type: 'string', default: './generated-images' },
    MAX_IMAGE_SIZE: { type: 'string', default: '2048' }
  }
};

// Register plugins
await fastify.register(env, {
  schema: envSchema,
  dotenv: true
});

await fastify.register(cors);
await fastify.register(multipart);
await fastify.register(import('@fastify/formbody'));

// Serve static files
await fastify.register(staticPlugin, {
  root: path.join(__dirname, 'generated-images'),
  prefix: '/images/'
});

// Initialize Slack client
// Separate Slack clients for different bots
const slackClient = new WebClient(fastify.config.IMAGE_SLACK_BOT_TOKEN); // For Events API mentions
const tmaiClient = new WebClient(fastify.config.TMAI_SLACK_BOT_TOKEN); // For TMAI slash commands

// Log which tokens are being used
fastify.log.info('🔑 IMAGE_SLACK_BOT_TOKEN starts with:', fastify.config.IMAGE_SLACK_BOT_TOKEN?.substring(0, 10) + '...');
fastify.log.info('🔑 TMAI_SLACK_BOT_TOKEN starts with:', fastify.config.TMAI_SLACK_BOT_TOKEN?.substring(0, 10) + '...');

// Initialize Gemini client
const geminiClient = new GoogleGenAI({ apiKey: fastify.config.GEMINI_API_KEY });


// Simple concurrency tracking
let activeRequests = 0;
const MAX_CONCURRENT = 20; // Limit concurrent Gemini requests
const requestQueue = [];

// Deduplication tracking - prevent processing same event twice
const processedEvents = new Set();

// Concurrency manager
async function processWithConcurrencyLimit(requestFn) {
  if (activeRequests >= MAX_CONCURRENT) {
    throw new Error('Too many requests at once. Please try again in a moment.');
  }

  activeRequests++;
  try {
    return await requestFn();
  } finally {
    activeRequests--;
  }
}

// Create output directory if it doesn't exist
try {
  await mkdir(path.join(__dirname, fastify.config.OUTPUT_DIR), { recursive: true });
} catch (error) {
  fastify.log.warn('Output directory already exists or could not be created');
}

// Load template images
async function loadTemplateImages() {
  try {
    const mascotTemplate = await readFile(path.join(__dirname, 'mascot-template.png'));
    const tokenMetricsLogo = await readFile(path.join(__dirname, 'TM_logo_primary_white.png'));
    return {
      mascotTemplate,
      tokenMetricsLogo
    };
  } catch (error) {
    fastify.log.error('Failed to load template images:', error);
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

// Load Ian Balina image and Token Metrics logo
async function loadIanBalinaImages() {
  try {
    const ianBalinaImage = await readFile(path.join(__dirname, 'ian-balina-bg-removed.png'));
    const tokenMetricsLogo = await readFile(path.join(__dirname, 'TM_logo_primary_white.png'));
    return {
      ianBalinaImage,
      tokenMetricsLogo
    };
  } catch (error) {
    fastify.log.error('Failed to load Ian Balina images:', error);
    throw error;
  }
}

// Generate image featuring Ian Balina using new Google GenAI SDK with retry logic
async function generateIanBalinaImage(prompt, ianImages, ratio = "16:9") {
  console.log('🎨 Generating Ian Balina image with Gemini 3 Pro...');
  console.log(`📝 Prompt: ${prompt}`);
  console.log(`📐 Ratio: ${ratio}`);

  // Create enhanced prompt for Ian Balina
  const enhancedPrompt = `You are a professional designer for Token Metrics, specializing in creating high-quality, brand-consistent visuals featuring Ian Balina, CEO and Founder of Token Metrics.

User Request: "Ian Balina ${prompt}"

Design Requirements:
- Execute the user's creative direction precisely as specified
- Use the provided Ian Balina image as the foundation - maintain his exact appearance, style, and likeness
- Feature Ian Balina prominently as the main subject
- Position the Token Metrics logo prominently in the top left corner of the image
- Maintain professional quality suitable for official company use
- Create imagery that reflects Ian's role as CEO and Founder of Token Metrics

Style Standards:
- Keep Ian Balina's appearance strictly unchanged unless the user explicitly requests modifications
- Maintain Token Metrics' professional brand aesthetic
- Ensure visual coherence between all elements
- Create polished, publication-ready imagery
- Focus on leadership, expertise, and innovation themes appropriate for a CEO and Founder
`;

  // Prepare content with Ian Balina image and Token Metrics logo using new SDK format
  const contents = [
    bufferToGenerativePart(ianImages.ianBalinaImage, 'image/png'),
    bufferToGenerativePart(ianImages.tokenMetricsLogo, 'image/png'),
    { text: enhancedPrompt }
  ];

  // Define the operation to retry
  const generateOperation = async () => {
    const response = await geminiClient.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: contents,
      generationConfig: {
        responseModalities: ['Image'],
        imageConfig: {
          aspectRatio: ratio
        }
      }
    });

    // Extract image data from new SDK response format
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        return Buffer.from(part.inlineData.data, 'base64');
      }
    }

    throw new Error('No image data found in response');
  };

  // Execute with retry logic
  return await retryWithBackoff(generateOperation, 5, 1000);
}

// Process Slack file uploads from request
async function processSlackFileUpload(requestBody) {
  try {
    const files = [];
    console.log('🔍 Checking for Slack file uploads...');

    // Check if files are present in the Slack request
    if (requestBody.files && Array.isArray(requestBody.files)) {
      console.log(`📎 Found ${requestBody.files.length} files in request`);

      for (let i = 0; i < requestBody.files.length; i++) {
        const slackFile = requestBody.files[i];
        console.log(`📎 Processing file ${i + 1}:`, slackFile.filename || 'unnamed');

        try {
          // Download file from Slack if we have a URL
          let fileBuffer;
          let filename;
          let mimeType;

          if (slackFile.url_private_download) {
            // Download file from Slack's CDN
            console.log(`📥 Downloading file from: ${slackFile.url_private_download}`);
            const response = await fetch(slackFile.url_private_download, {
              headers: {
                'Authorization': `Bearer ${fastify.config.IMAGE_SLACK_BOT_TOKEN}`
              }
            });

            if (!response.ok) {
              throw new Error(`Failed to download file: ${response.statusText}`);
            }

            fileBuffer = Buffer.from(await response.arrayBuffer());
            filename = slackFile.name || `file_${i + 1}.png`;
            mimeType = slackFile.mimetype || 'image/png';
          } else if (slackFile.content) {
            // File content is directly included (rare for images)
            fileBuffer = Buffer.from(slackFile.content, 'base64');
            filename = slackFile.name || `file_${i + 1}.png`;
            mimeType = slackFile.mimetype || 'image/png';
          } else {
            console.log(`⚠️ File ${slackFile.id} has no download URL, trying Slack API...`);

            // Use Slack API to get file info and download
            const fileInfo = await slackClient.files.info({
              file: slackFile.id
            });

            if (fileInfo.file.url_private_download) {
              const response = await fetch(fileInfo.file.url_private_download, {
                headers: {
                  'Authorization': `Bearer ${fastify.config.IMAGE_SLACK_BOT_TOKEN}`
                }
              });

              fileBuffer = Buffer.from(await response.arrayBuffer());
              filename = fileInfo.file.name || `file_${i + 1}.${fileInfo.file.filetype.split('/')[1] || 'png'}`;
              mimeType = fileInfo.file.mimetype || 'image/png';
            } else {
              throw new Error('No downloadable URL available for file');
            }
          }

          // Validate file type and size
          const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
          const maxSize = 10 * 1024 * 1024; // 10MB

          if (!allowedTypes.includes(mimeType)) {
            throw new Error(`Unsupported file type: ${mimeType}. Supported types: PNG, JPG, JPEG, WebP`);
          }

          if (fileBuffer.length > maxSize) {
            throw new Error(`File too large: ${filename}. Maximum size: 10MB`);
          }

          files.push({
            buffer: fileBuffer,
            filename: filename,
            mimeType: mimeType
          });

          console.log(`✅ Successfully processed file: ${filename} (${fileBuffer.length} bytes)`);

        } catch (fileError) {
          console.error(`❌ Error processing file ${i}:`, fileError.message);
          // Continue processing other files instead of failing completely
        }
      }
    } else {
      console.log('📎 No files found in request body');
    }

    console.log(`📎 Total processed files: ${files.length}`);
    return files;

  } catch (error) {
    fastify.log.error('Error processing file uploads:', error);
    throw error;
  }
}

// Generate free-form image without templates
async function generateFreeFormImage(prompt, attachedImages = [], ratio = "16:9") {
  try {
    console.log('🎨 Generating free-form image with Gemini 3 Pro...');
    console.log(`📝 Prompt: ${prompt}`);
    console.log(`📐 Ratio: ${ratio}`);
    console.log(`📎 Attached images: ${attachedImages.length}`);

    // Create enhanced prompt for free-form generation
    const enhancedPrompt = `You are a creative AI image generator. Generate a high-quality image based on the following request.

User Request: "${prompt}"

Requirements:
- Follow the user's creative direction precisely
- Create professional, high-quality imagery
- Use ${ratio} aspect ratio
- Maintain visual coherence and appeal
- Generate content that is appropriate and creative

Style Guidelines:
- Focus on creating visually appealing and well-composed images
- Use appropriate colors, lighting, and composition
- Ensure the generated image matches the user's intent
- Create polished, publication-ready imagery
`;

    // Prepare content with prompt and optional attached images
    const contents = attachedImages.map(img =>
      bufferToGenerativePart(Buffer.from(img.data, 'base64'), img.mimeType)
    );
    contents.push({ text: enhancedPrompt });

    // Define the operation to retry
    const generateOperation = async () => {
      const response = await geminiClient.models.generateContent({
        model: 'gemini-3-pro-image-preview',
        contents: contents,
        generationConfig: {
          responseModalities: ['Image'],
          imageConfig: {
            aspectRatio: ratio
          }
        }
      });

      // Extract image data from response
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          return Buffer.from(part.inlineData.data, 'base64');
        }
      }

      throw new Error('No image data found in response');
    };

    // Execute with retry logic
    return await retryWithBackoff(generateOperation, 5, 1000);

  } catch (error) {
    console.error('❌ Error generating free-form image:', error.message);
    throw error;
  }
}

// Handle free-form image generation slash command
async function handleFreeFormGeneration(requestBody) {
  try {
    console.log('🎨 handleFreeFormGeneration called with:', {
      command: requestBody.command,
      text: requestBody.text,
      hasFiles: !!requestBody.files
    });

    const { command, text, channel_id, user_id, response_url } = requestBody;

    // Parse prompt and flags
    const { prompt, ratio } = parsePromptWithFlags(text);

    if (!prompt) {
      return {
        text: '❌ Please provide a description for the image you\'d like me to generate!\n\nExample: `/image A beautiful sunset over mountains --ratio 16:9`\n\n💡 You can also attach images to modify or analyze!\n\n💡 Use `--ratio <ratio>` to set aspect ratio (1:1, 3:4, 4:3, 9:16, 16:9)!',
        response_type: 'ephemeral'
      };
    }

    // Get user info for personalized response
    let userName = 'there';
    try {
      const userInfo = await slackClient.users.info({ user: userId });
      userName = userInfo.user?.real_name || userInfo.user?.name || 'there';
    } catch (error) {
      // Continue with default name if user lookup fails
    }

    // Get random working message
    const workingMessage = getRandomWorkingMessage();
    const randomMessage = `Hang on ${userName}... ${workingMessage} your image...`;

    // Return immediate response acknowledging the command
    const response = await slackClient.chat.postMessage({
      channel: channel_id,
      text: randomMessage
    });

    const threadTs = response.ts;

    // Process asynchronously with concurrency limit
    setTimeout(async () => {
      try {
        await processWithConcurrencyLimit(async () => {
          console.log('🚀 Starting free-form image generation process...');

          // Process any attached files
          const attachedImages = [];
          if (requestBody.files) {
            console.log('📎 Files found in request, processing...');
            const files = await processSlackFileUpload(requestBody);
            attachedImages.push(...files);
          } else {
            console.log('📎 No files in request, proceeding with text-only generation');
          }

          // Generate image with specified ratio
          const imageBuffer = await generateFreeFormImage(prompt, attachedImages, ratio);

          // Save image
          const savedImage = await saveGeneratedImage(imageBuffer, `freeform-${prompt}`);

          // Create title and comment
          const title = `AI Generated: ${prompt} (${ratio})`;
          const comment = `✨ Generated image for "${prompt}" with ${ratio} aspect ratio${attachedImages.length > 0 ? ` (using ${attachedImages.length} attached image${attachedImages.length > 1 ? 's' : ''})` : ''}`;

          // Upload image to Slack thread
          await slackClient.files.uploadV2({
            channel_id: channel_id,
            file: imageBuffer,
            filename: savedImage.filename,
            title: title,
            initial_comment: comment,
            thread_ts: threadTs
          });

          console.log('✅ Free-form image generation completed successfully');
        });
      } catch (error) {
        console.error('❌ Error in async processing:', error);
        await slackClient.chat.postMessage({
          channel: channel_id,
          text: `❌ ${error.message}`,
          thread_ts: threadTs
        });
      }
    }, 100);

    // Return empty response to avoid duplicate messages
    return '';

  } catch (error) {
    fastify.log.error('Error in handleFreeFormGeneration:', error);
    return {
      text: `❌ An unexpected error occurred: ${error.message}`,
      response_type: 'ephemeral'
    };
  }
}

// Parse flags from user prompt for Ian Balina commands
function parseIanPromptWithFlags(commandText) {
  // Supported aspect ratios
  const supportedRatios = ["1:1", "3:4", "4:3", "9:16", "16:9"];

  // Check for --ratio flag and extract the ratio value
  const ratioMatch = commandText.match(/--ratio\s+([^\s]+)/);
  let ratio = "16:9"; // default ratio

  if (ratioMatch) {
    const requestedRatio = ratioMatch[1];
    if (supportedRatios.includes(requestedRatio)) {
      ratio = requestedRatio;
    } else {
      console.log(`⚠️ Unsupported ratio "${requestedRatio}", using default "16:9"`);
    }
  }

  // Remove flags from prompt to get clean text
  const cleanPrompt = commandText.replace(/--\w+\s*([^\s]*)?/g, '').trim();

  return {
    prompt: cleanPrompt,
    ratio: ratio
  };
}

// Handle slash command /ian
async function handleIanSlashCommand(commandText, channelId, userId) {
  try {
    fastify.log.info('Received /ian command:', { commandText, channelId, userId });

    // Parse prompt and flags
    const { prompt, ratio } = parseIanPromptWithFlags(commandText);

    if (!prompt) {
      return {
        text: '❌ Please provide a description for the Ian Balina image you\'d like me to generate!\n\nExample: `/ian presenting at blockchain conference`\n\n💡 Use `--ratio <ratio>` to set aspect ratio (1:1, 3:4, 4:3, 9:16, 16:9)!',
        response_type: 'ephemeral'
      };
    }

    // Get user info for personalized response
    let userName = 'there';
    try {
      const userInfo = await slackClient.users.info({ user: userId });
      userName = userInfo.user?.real_name || userInfo.user?.name || 'there';
    } catch (error) {
      // Continue with default name if user lookup fails
    }

    // Get random working message
    const workingMessage = getRandomWorkingMessage();
    const randomMessage = `Hang on ${userName}... ${workingMessage}...`;

    // Return immediate response acknowledging the command
    const response = await slackClient.chat.postMessage({
      channel: channelId,
      text: randomMessage
    });

    const threadTs = response.ts;

    // Process asynchronously with concurrency limit
    setTimeout(async () => {
      try {
        await processWithConcurrencyLimit(async () => {
          // Load Ian Balina images
          const ianImages = await loadIanBalinaImages();

          // Generate image with specified ratio
          const imageBuffer = await generateIanBalinaImage(prompt, ianImages, ratio);

          // Save image
          const savedImage = await saveGeneratedImage(imageBuffer, `ian-balina-${prompt}`);

          // Create title and comment
          const title = `Ian Balina ${prompt} (${ratio})`;
          const comment = `✨ Generated Ian Balina ${prompt} with ${ratio} aspect ratio`;

          // Upload image to Slack thread
          await slackClient.files.uploadV2({
            channel_id: channelId,
            file: imageBuffer,
            filename: savedImage.filename,
            title: title,
            initial_comment: comment,
            thread_ts: threadTs
          });
        });
      } catch (error) {
        await slackClient.chat.postMessage({
          channel: channelId,
          text: `❌ ${error.message}`,
          thread_ts: threadTs
        });
      }
    }, 100);

    // Return empty response to avoid duplicate messages
    return '';

  } catch (error) {
    fastify.log.error('Error in handleIanSlashCommand:', error);
    return {
      text: `❌ An unexpected error occurred: ${error.message}`,
      response_type: 'ephemeral'
    };
  }
}

// Retry function with exponential backoff and timeout
async function retryWithBackoff(operation, maxRetries = 5, baseDelay = 1000, timeoutMs = 120000) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 Attempt ${attempt}/${maxRetries} for image generation...`);

      // Add timeout wrapper
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout after 120 seconds')), timeoutMs);
      });

      const result = await Promise.race([
        operation(),
        timeoutPromise
      ]);

      console.log(`✅ Success on attempt ${attempt}`);
      return result;
    } catch (error) {
      lastError = error;

      // Check if this is a retryable error
      const isRetryable = error.message?.includes('overloaded') ||
                         error.message?.includes('503') ||
                         error.message?.includes('UNAVAILABLE') ||
                         error.message?.includes('Request timeout') ||
                         error.status === 503;

      console.log(`❌ Attempt ${attempt} failed: ${error.message}`);

      if (!isRetryable || attempt === maxRetries) {
        console.error(`❌ Non-retryable error or max retries reached: ${error.message}`);
        throw error;
      }

      // Calculate delay with exponential backoff and jitter
      const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
      console.log(`⏳ Retrying in ${Math.round(delay)}ms... (Error: ${error.message})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

// Generate image using new Google GenAI SDK with retry logic
async function generateImageWithGemini(prompt, templateImages, ratio = "16:9") {
  console.log('🎨 Generating mascot image with Gemini 3 Pro...');
  console.log(`📝 Prompt: ${prompt}`);
  console.log(`📐 Ratio: ${ratio}`);

  // Create enhanced prompt
  const enhancedPrompt = `
You are a professional designer for Token Metrics, specializing in creating high-quality, brand-consistent visuals for marketing and communications.

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

  // Define the operation to retry
  const generateOperation = async () => {
    const response = await geminiClient.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: contents,
      generationConfig: {
        responseModalities: ['Image'],
        imageConfig: {
          aspectRatio: ratio
        }
      }
    });

    // Extract image data from new SDK response format
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        return Buffer.from(part.inlineData.data, 'base64');
      }
    }

    throw new Error('No image data found in response');
  };

  // Execute with retry logic
  return await retryWithBackoff(generateOperation, 5, 1000);
}

// Save generated image
async function saveGeneratedImage(imageBuffer, userPrompt) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `mascot-${timestamp}.png`;
  const filepath = path.join(__dirname, fastify.config.OUTPUT_DIR, filename);

  await writeFile(filepath, imageBuffer);
  return {
    filename,
    filepath,
    url: `/images/${filename}`
  };
}

// Parse flags from user prompt
function parsePromptWithFlags(commandText) {
  // Supported aspect ratios
  const supportedRatios = ["1:1", "3:4", "4:3", "9:16", "16:9"];

  // Check for --ratio flag and extract the ratio value
  const ratioMatch = commandText.match(/--ratio\s+([^\s]+)/);
  let ratio = "16:9"; // default ratio

  if (ratioMatch) {
    const requestedRatio = ratioMatch[1];
    if (supportedRatios.includes(requestedRatio)) {
      ratio = requestedRatio;
    } else {
      console.log(`⚠️ Unsupported ratio "${requestedRatio}", using default "16:9"`);
    }
  }

  // Remove flags from prompt to get clean text
  const cleanPrompt = commandText.replace(/--\w+\s*([^\s]*)?/g, '').trim();

  return {
    prompt: cleanPrompt,
    ratio: ratio
  };
}



// Handle slash command /tmai
async function handleTMAISlashCommand(commandText, channelId, userId) {
  try {
    fastify.log.info('Received /tmai command:', { commandText, channelId, userId });

    // Parse prompt and flags
    const { prompt, ratio } = parsePromptWithFlags(commandText);

    if (!prompt) {
      return {
        text: '❌ Please provide a description for the mascot you\'d like me to generate!\n\nExample: `/tmai A robot mascot analyzing cryptocurrency charts on a computer screen`\n\n💡 Use `--ratio <ratio>` to set aspect ratio (1:1, 3:4, 4:3, 9:16, 16:9)!',
        response_type: 'ephemeral'
      };
    }

    // Get user info for personalized response
    let userName = 'there';
    try {
      const userInfo = await tmaiClient.users.info({ user: userId });
      userName = userInfo.user?.real_name || userInfo.user?.name || 'there';
    } catch (error) {
      // Continue with default name if user lookup fails
    }

    // Get random working message
    const workingMessage = getRandomWorkingMessage();
    const randomMessage = `Hang on ${userName}... ${workingMessage}...`;

    // Return immediate response acknowledging the command
    const response = await slackClient.chat.postMessage({
      channel: channelId,
      text: randomMessage
    });

    const threadTs = response.ts;

    // Process asynchronously with concurrency limit
    setTimeout(async () => {
      try {
        await processWithConcurrencyLimit(async () => {
          // Load template images
          const templateImages = await loadTemplateImages();

          // Generate image with specified ratio
          const imageBuffer = await generateImageWithGemini(prompt, templateImages, ratio);

          // Save image
          const savedImage = await saveGeneratedImage(imageBuffer, prompt);

          // Create title and comment
          const title = `TMAI ${prompt} (${ratio})`;
          const comment = `✨ Generated TMAI ${prompt} with ${ratio} aspect ratio`;

          // Upload image to Slack thread
          await tmaiClient.files.uploadV2({
            channel_id: channelId,
            file: imageBuffer,
            filename: savedImage.filename,
            title: title,
            initial_comment: comment,
            thread_ts: threadTs
          });
        });
      } catch (error) {
        await tmaiClient.chat.postMessage({
          channel: channelId,
          text: `❌ ${error.message}`,
          thread_ts: threadTs
        });
      }
    }, 100);

    // Return empty response to avoid duplicate messages
    return '';

  } catch (error) {
    fastify.log.error('Error in handleTMAISlashCommand:', error);
    return {
      text: `❌ An unexpected error occurred: ${error.message}`,
      response_type: 'ephemeral'
    };
  }
}


// Health check endpoint
fastify.get('/health', async (request, reply) => {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'mascot-gen'
  };
});

// Events API webhook endpoint for app mentions
fastify.post('/slack/image', async (request, reply) => {
  try {
    fastify.log.info('=== Events API webhook hit (using IMAGE_SLACK_BOT_TOKEN) ===');
    fastify.log.info('📨 Raw request body:', JSON.stringify(request.body, null, 2));

    // Slack sends URL verification challenge when setting up webhook
    if (request.body.type === 'url_verification') {
      fastify.log.info('🔗 Slack URL verification request received');
      fastify.log.info('🔗 Challenge value:', request.body.challenge);

      const response = {
        challenge: request.body.challenge
      };

      fastify.log.info('🔗 Sending verification response:', response);
      return response;
    }

    // Handle app_mention events only - ignore all other event types
    if (request.body.type === 'event_callback') {
      const eventType = request.body.event.type;
      const eventId = request.body.event_id;
      const eventTime = request.body.event_time;

      // Log ALL event types for debugging
      fastify.log.info(`📩 Event received: ${eventType} (ID: ${eventId}, Time: ${eventTime})`);

      // Only process app_mention events, ignore everything else
      if (eventType !== 'app_mention') {
        fastify.log.info(`🔄 Ignoring non-mention event: ${eventType}`);
        return { ok: true };
      }

      const event = request.body.event;
      fastify.log.info('📝 Event object:', JSON.stringify(event, null, 2));

      eventId = `${event.channel}_${event.user}_${event.event_ts}`;
      fastify.log.info('🆔 Generated eventId:', eventId);

      // Skip if we've already processed this event
      if (processedEvents.has(eventId)) {
        fastify.log.info('🔄 Skipping duplicate event:', eventId);
        return { ok: true };
      }

      // Mark this event as processed
      processedEvents.add(eventId);

      // Clean up old events (keep only last 100)
      if (processedEvents.size > 100) {
        const oldestEvent = processedEvents.values().next().value;
        processedEvents.delete(oldestEvent);
      }

      const user = event.user;
      const channel = event.channel;
      const text = event.text;
      const files = event.files;

      fastify.log.info('📝 App mention received:');
      fastify.log.info('  User:', user);
      fastify.log.info('  Channel:', channel);
      fastify.log.info('  Text:', text);
      fastify.log.info('  Files:', files ? files.length : 0, 'files attached');

      // DEBUG: Log the full event to see what's actually being sent
      fastify.log.info('🔍 DEBUG - Full event object:', JSON.stringify(event, null, 2));
      fastify.log.info('🔍 DEBUG - Event type:', event.type);
      fastify.log.info('🔍 DEBUG - Event text:', JSON.stringify(text));
      fastify.log.info('🔍 DEBUG - Does text contain bot mention?', text.includes(fastify.config.IMAGE_SLACK_BOT_USER_ID));

      // SAFETY CHECK: If critical fields are empty, skip processing
      if (!user || !channel || !text || text.trim().length === 0) {
        fastify.log.error('❌ SAFETY CHECK FAILED: Missing critical event data');
        fastify.log.error('❌ User:', user);
        fastify.log.error('❌ Channel:', channel);
        fastify.log.error('❌ Text:', text);
        fastify.log.warn('Skipping event with missing critical data');
        return { ok: true };
      }

      // Extract prompt by removing bot mention
      const botUserId = `<@${fastify.config.IMAGE_SLACK_BOT_USER_ID}>`;
      let prompt = text.replace(botUserId, '').trim();

      // Validate prompt exists
      if (!prompt || prompt.trim().length === 0) {
        await slackClient.chat.postMessage({
          channel: channel,
          thread_ts: event.ts,
          text: `❌ Please include a description for what you want me to do with your image(s)!`
        });
        return { ok: true };
      }

      // Validate that images are attached - Events API requires images!
      if (!files || files.length === 0) {
        await slackClient.chat.postMessage({
          channel: channel,
          thread_ts: event.ts,
          text: `❌ Please include image(s) with your mention!\n\nExample: @bot Make this look professional --ratio 16:9 [+ attach image(s)]\n\n💡 The Events API requires image attachments to work!`
        });
        return { ok: true };
      }

      // Extract aspect ratio if specified
      let ratio = "16:9"; // default
      const ratioMatch = prompt.match(/--ratio\s+(\d+:\d+)/);
      if (ratioMatch) {
        const supportedRatios = ["1:1", "3:4", "4:3", "9:16", "16:9"];
        const requestedRatio = ratioMatch[1];

        if (supportedRatios.includes(requestedRatio)) {
          ratio = requestedRatio;
          prompt = prompt.replace(ratioMatch[0], '').trim();
        } else {
          await slackClient.chat.postMessage({
            channel: channel,
            thread_ts: event.ts,
            text: `❌ Unsupported aspect ratio: ${requestedRatio}\n\nSupported ratios: 1:1, 3:4, 4:3, 9:16, 16:9`
          });
          return { ok: true };
        }
      }

      // Process files if any
      let attachedImages = [];
      if (files && files.length > 0) {
        fastify.log.info('📎 Processing attached files...');
        for (const file of files) {
          if (file.mimetype && file.mimetype.startsWith('image/')) {
            try {
              // Download file from Slack
              const fileResponse = await slackClient.files.info({
                file: file.id
              });

              if (fileResponse.file.url_private) {
                const imageResponse = await fetch(fileResponse.file.url_private, {
                  headers: {
                    'Authorization': `Bearer ${fastify.config.IMAGE_SLACK_BOT_TOKEN}`
                  }
                });

                if (imageResponse.ok) {
                  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
                  attachedImages.push({
                    data: imageBuffer.toString('base64'),
                    mimeType: file.mimetype
                  });
                  fastify.log.info(`✅ Downloaded image: ${file.name}`);
                }
              }
            } catch (error) {
              fastify.log.error(`❌ Failed to download file ${file.name}:`, error.message);
            }
          }
        }
      }

      // Get user info for personalized response
      let userName = 'there';
      try {
        const userInfo = await slackClient.users.info({ user: user });
        userName = userInfo.user?.real_name || userInfo.user?.name || 'there';
      } catch (error) {
        fastify.log.warn('Failed to get user info, using default name:', error.message);
      }

      const workingMessage = getRandomWorkingMessage();
      const randomMessage = `🎨 ${workingMessage} your image, ${userName}...`;

      const response = await slackClient.chat.postMessage({
        channel: channel,
        text: randomMessage,
        thread_ts: event.ts  // Reply to the original message
      });

      const threadTs = response.ts;

      // Process image generation asynchronously
      setTimeout(async () => {
        try {
          await processWithConcurrencyLimit(async () => {
            // Events API should only work with attached images
            if (attachedImages.length === 0) {
              throw new Error('No images were successfully processed. Please try again.');
            }

            // Generate with attached images only (free-form mode)
            const imageBuffer = await generateFreeFormImage(prompt, attachedImages, ratio);

            // Save and upload
            const savedImage = await saveGeneratedImage(imageBuffer, prompt);
            const title = `AI Generated: ${prompt} (${ratio})`;
            const comment = `✨ Generated image from your prompt and ${attachedImages.length} attached image(s)`;

            await slackClient.files.uploadV2({
              channel_id: channel,
              file: imageBuffer,
              filename: savedImage.filename,
              title: title,
              initial_comment: comment,
              thread_ts: threadTs
            });
          });
        } catch (error) {
          await slackClient.chat.postMessage({
            channel: channel,
            text: `❌ Sorry, I encountered an error generating your image: ${error.message}`,
            thread_ts: threadTs
          });
        }
      }, 100);

      return { ok: true };
    }

    // Return 200 for other event types
    return { ok: true };

  } catch (error) {
    fastify.log.error('Error in Events API webhook:', error.message || error);
    fastify.log.error('Full error details:', JSON.stringify(error, null, 2));
    fastify.log.error('Stack trace:', error.stack);
    fastify.log.error('Error name:', error.name);
    fastify.log.error('Error code:', error.code);
    return reply.code(500).send({ error: 'Webhook processing failed' });
  }
});


// TMAI slash command endpoint
fastify.post('/tmai-gen', async (request, reply) => {
  try {
    fastify.log.info('=== /tmai-gen endpoint hit (using TMAI_SLACK_BOT_TOKEN) ===');
    fastify.log.info('Request body:', JSON.stringify(request.body, null, 2));

    const { command, text, channel_id, user_id, response_url } = request.body;

    fastify.log.info('TMAI - Parsed command:', command);
    fastify.log.info('TMAI - Parsed text:', text);

    // Verify this is our command
    if (!['/tmai', '/test-tmai'].includes(command)) {
      fastify.log.error('❌ TMAI - Unknown command received:', command);
      fastify.log.error('TMAI - Available commands: /tmai, /test-tmai');
      return reply.code(400).send({ error: 'Unknown command' });
    }

    // Handle the command
    const result = await handleTMAISlashCommand(text, channel_id, user_id);

    // Return response to Slack
    return reply.code(200).send(result);

  } catch (error) {
    fastify.log.error('Error processing TMAI slash command:', error);
    return reply.code(500).send({
      text: '❌ An error occurred while processing your TMAI command.',
      response_type: 'ephemeral'
    });
  }
});

// Ian Balina generation endpoint
fastify.post('/ian-gen', async (request, reply) => {
  try {
    fastify.log.info('=== /ian-gen endpoint hit (using TMAI_SLACK_BOT_TOKEN) ===');

    const { command, text, channel_id, user_id, response_url } = request.body;

    // Verify this is our command
    if (!['/ian', '/test-ian'].includes(command)) {
      return reply.code(400).send({ error: 'Unknown command' });
    }

    // Handle the command
    const result = await handleIanSlashCommand(text, channel_id, user_id);

    // Return response to Slack
    return reply.code(200).send(result);

  } catch (error) {
    fastify.log.error('Error processing Ian slash command:', error);
    return reply.code(500).send({
      text: '❌ An error occurred while processing your Ian command.',
      response_type: 'ephemeral'
    });
  }
});



// Start server
const start = async () => {
  try {
    const port = parseInt(fastify.config.PORT);
    const host = fastify.config.HOST;

    await fastify.listen({ port, host });
    fastify.log.info(`🚀 Server listening on http://${host}:${port}`);
    fastify.log.info(`🎯 Target Channel: ${fastify.config.TARGET_CHANNEL}`);
    fastify.log.info('🤖 Slash Commands:');
    fastify.log.info('   • /tmai-gen - TMAI mascot generation');
    fastify.log.info('   • /ian-gen - Ian Balina image generation');
    fastify.log.info('📨 Events API:');
    fastify.log.info('   • /slack/image - @bot mentions with image attachments');
    fastify.log.info('❤️  Health check: /health');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// Handle graceful shutdown
process.on('SIGINT', async () => {
  fastify.log.info('Shutting down gracefully...');
  await fastify.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  fastify.log.info('Shutting down gracefully...');
  await fastify.close();
  process.exit(0);
});

// Start the server
start();