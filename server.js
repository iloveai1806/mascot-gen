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

// Gemini API configuration
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent';

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

// Generate enhanced prompt for Token Metrics mascot
function generateEnhancedPrompt(userPrompt) {
  return `TMAI ${userPrompt}

Instructions:
- Follow the user's prompt exactly: "${userPrompt}"
- Use the provided mascot template as the base character
- Place the Token Metrics logo in the top left corner of the image
- Keep the style, and details of the mascot strictly, don't change it unless specify by the users. That's our mascot.
`;
}

// Generate image using Gemini API via HTTP request
async function generateImageWithGemini(prompt, templateImages) {
  try {
    // Create the enhanced prompt
    const enhancedPrompt = generateEnhancedPrompt(prompt);

    // Prepare content for Gemini - include template images as context
    const contents = [
      {
        parts: [
          { text: enhancedPrompt },
          {
            inline_data: {
              mime_type: 'image/png',
              data: templateImages.mascotTemplate.toString('base64')
            }
          },
          {
            inline_data: {
              mime_type: 'image/png',
              data: templateImages.tokenMetricsLogo.toString('base64')
            }
          }
        ]
      }
    ];

    const requestBody = {
      contents: contents,
      generationConfig: {
        responseModalities: ['Image'],
        imageConfig: {
          aspectRatio: '1:1'
        }
      }
    };

    // Make HTTP request to Gemini API
    const response = await fetch(`${GEMINI_API_URL}?key=${fastify.config.GEMINI_API_KEY}`, {
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

// Handle slash command /tmai
async function handleTMAISlashCommand(commandText, channelId, userId) {
  try {
    fastify.log.info('Received /tmai command:', { commandText, channelId, userId });

    // Clean and validate the prompt
    const userPrompt = commandText.trim();

    if (!userPrompt) {
      return {
        text: '❌ Please provide a description for the mascot you\'d like me to generate!\n\nExample: `/tmai A robot mascot analyzing cryptocurrency charts on a computer screen`',
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

          // Generate image
          const imageBuffer = await generateImageWithGemini(userPrompt, templateImages);

          // Save image
          const savedImage = await saveGeneratedImage(imageBuffer, userPrompt);

          // Upload image to Slack thread
          await slackClient.files.uploadV2({
            channel_id: channelId,
            file: imageBuffer,
            filename: savedImage.filename,
            title: `TMAI ${userPrompt}`,
            initial_comment: `✨ Generated TMAI ${userPrompt}`,
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

// Image generation endpoint (for testing)
fastify.post('/generate', async (request, reply) => {
  try {
    const { prompt } = request.body;

    if (!prompt) {
      return reply.code(400).send({ error: 'Prompt is required' });
    }

    // Load template images
    const templateImages = await loadTemplateImages();

    // Generate image
    const imageBuffer = await generateImageWithGemini(prompt, templateImages);

    // Save image
    const savedImage = await saveGeneratedImage(imageBuffer, prompt);

    return {
      success: true,
      image: savedImage,
      prompt: prompt
    };

  } catch (error) {
    fastify.log.error('Error in generate endpoint:', error);
    return reply.code(500).send({
      error: 'Failed to generate image',
      details: error.message
    });
  }
});

// Slack slash command endpoint
fastify.post('/image-gen', async (request, reply) => {
  try {
    const { command, text, channel_id, user_id, response_url } = request.body;

    // Verify this is our command
    if (command !== '/tmai') {
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


// Start server
const start = async () => {
  try {
    const port = parseInt(fastify.config.PORT);
    const host = fastify.config.HOST;

    await fastify.listen({ port, host });
    fastify.log.info(`🚀 Server listening on http://${host}:${port}`);
    fastify.log.info(`🎯 Target Channel: ${fastify.config.TARGET_CHANNEL}`);
    fastify.log.info('🎨 Image generation endpoint: /image-gen');
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