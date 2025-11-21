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
  required: ['PORT', 'SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET', 'GEMINI_API_KEY'],
  properties: {
    PORT: { type: 'string', default: '0110' },
    HOST: { type: 'string', default: '0.0.0.0' },
    LOG_LEVEL: { type: 'string', default: 'info' },
    SLACK_BOT_TOKEN: { type: 'string' },
    SLACK_SIGNING_SECRET: { type: 'string' },
    SLACK_APP_TOKEN: { type: 'string' },
    GEMINI_API_KEY: { type: 'string' },
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
const slackClient = new WebClient(fastify.config.SLACK_BOT_TOKEN);

// Initialize Gemini client
const geminiClient = new GoogleGenAI({ apiKey: fastify.config.GEMINI_API_KEY });


// Simple concurrency tracking
let activeRequests = 0;
const MAX_CONCURRENT = 20; // Limit concurrent Gemini requests
const requestQueue = [];

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

// Generate image featuring Ian Balina using new Google GenAI SDK
async function generateIanBalinaImage(prompt, ianImages, ratio = "16:9") {
  try {
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

    // Generate image using new SDK with gemini-3-pro-image-preview
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

    console.log('✅ Ian Balina image generation completed');

    // Extract image data from new SDK response format
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        console.log('✅ Image data extracted from response');
        return Buffer.from(part.inlineData.data, 'base64');
      }
    }

    throw new Error('No image data found in response');

  } catch (error) {
    console.error('❌ Error generating Ian Balina image:', error.message);
    throw error;
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

    // Random working messages
    const workingMessages = [
      `Creating Ian Balina masterpiece...`,
      `Consulting with Ian's vision...`,
      `Crafting leadership imagery...`,
      `Designing founder moments...`,
      `Ian Balina is choosing his pose...`,
      `Token Metrics CEO mode activated...`,
      `Preparing innovation showcase...`,
      `Designing blockchain brilliance...`,
      `Crafting crypto excellence...`,
      `Ian Balina is reviewing the scene...`,
      `Token Metrics founder magic...`,
      `Creating visionary content...`,
      `Ian Balina is getting ready...`,
      `Leadership in focus...`,
      `Token Metrics artistry...`
    ];

    const randomMessage = `Hang on ${userName}... ${workingMessages[Math.floor(Math.random() * workingMessages.length)]}`;

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

// Generate image using new Google GenAI SDK
async function generateImageWithGemini(prompt, templateImages, ratio = "16:9") {
  try {
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

    // Generate image using new SDK with gemini-3-pro-image-preview
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
    throw error;
  }
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
      const userInfo = await slackClient.users.info({ user: userId });
      userName = userInfo.user?.real_name || userInfo.user?.name || 'there';
    } catch (error) {
      // Continue with default name if user lookup fails
    }

    // Random working messages
    const workingMessages = [
      `Catapulting imagination into reality...`,
      `Waking up the AI hamsters...`,
      `Consulting the crystal ball of creativity...`,
      `Bribing the pixel artists with coffee...`,
      `TMAI is choosing its outfit...`,
      `Warming up the joke generators...`,
      `Priming the creativity pumps...`,
      `The AI muse is on a coffee break...`,
      `Calibrating the funny bone sensors...`,
      `TMAI is reviewing its script...`,
      `The hamsters are running faster now...`,
      `Polishing the humor circuits...`,
      `TMAI is practicing its dramatic poses...`,
      `Distilling pure imagination...`,
      `The creative cauldron is bubbling...`,
      `TMAI is warming up its vocal cords...`,
      `Consulting the ancient scrolls of comedy...`,
      `The AI artists are putting on their berets...`,
      `TMAI is doing its pre-shoot stretches...`,
      `The joke writers are on strike... using AI instead...`
    ];

    const randomMessage = `Hang on ${userName}... ${workingMessages[Math.floor(Math.random() * workingMessages.length)]}`;

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


// Slack slash command endpoint
fastify.post('/image-gen', async (request, reply) => {
  try {

    const { command, text, channel_id, user_id, response_url } = request.body;

    // Verify this is our command
    if (!['/tmai', '/test-tmai'].includes(command)) {
      return reply.code(400).send({ error: 'Unknown command' });
    }

    // Handle the command
    const result = await handleTMAISlashCommand(text, channel_id, user_id);

    // Return response to Slack
    return reply.code(200).send(result);

  } catch (error) {
    fastify.log.error('Error processing slash command:', error);
    return reply.code(500).send({
      text: '❌ An error occurred while processing your command.',
      response_type: 'ephemeral'
    });
  }
});

// Ian Balina generation endpoint
fastify.post('/ian-gen', async (request, reply) => {
  try {

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
    fastify.log.info('🤖 TMAI generation endpoint: /image-gen');
    fastify.log.info('👨‍💼 Ian Balina generation endpoint: /ian-gen');
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