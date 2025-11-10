# Token Metrics Mascot Generator

A Fastify server that listens for `/tmai` slash commands in a specific Slack channel and generates production-grade Token Metrics mascot images using Google's Gemini API.

## Features

- 🤖 **Slash Command Integration**: Uses `/tmai` command in Slack
- 🎯 **Channel-Specific**: Only works in designated channel (C08BW4X3VMX)
- 🎨 **AI Image Generation**: Uses Google Gemini 2.5 Flash Image model
- 🖼️ **Template Integration**: Incorporates mascot template and Token Metrics logo
- 📱 **Direct Replies**: Posts generated images directly to the Slack channel
- 🔒 **Secure**: Proper Slack verification and error handling

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Configuration

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Required environment variables:

```env
# Server Configuration
PORT=3000
HOST=0.0.0.0
LOG_LEVEL=info

# Slack Configuration
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token

# Google Gemini API Configuration
GEMINI_API_KEY=your-gemini-api-key

# Channel Configuration
TARGET_CHANNEL=C08BW4X3VMX

# Image Generation Configuration
OUTPUT_DIR=./generated-images
MAX_IMAGE_SIZE=2048
```

### 3. Slack App Setup

1. Create a Slack App at https://api.slack.com/apps
2. Configure slash command `/tmai` to point to: `https://your-server.com/image-gen`
3. Add Bot Token Scopes:
   - `chat:write`
   - `files:write`
   - `commands`
4. Enable Event Subscriptions if needed
5. Install the app to your workspace

### 4. Prepare Assets

Ensure you have these files in the project root:
- `mascot-template.png` - Base mascot template image
- `tokenmetrics-logo.png` - Token Metrics logo image

### 5. Run the Server

```bash
# Development
npm run dev

# Production
npm start
```

## Usage

### Slack Command

In the designated channel (C08BW4X3VMX), use:

```
/tmai A robot mascot analyzing cryptocurrency charts on multiple screens
```

### Example Prompts

- `/tmai A mascot celebrating Bitcoin reaching new all-time highs`
- `/tmai A robot mascot teaching crypto trading strategies to beginners`
- `/tmai A mascot presenting market analysis data on a holographic display`
- `/tmai A robot mascot developing blockchain code with glowing algorithms`
- `/tmai A mascot protecting crypto assets with advanced security features`

## API Endpoints

### POST `/image-gen`

Receives Slack slash commands for image generation.

**Request Body:**
```json
{
  "command": "/tmai",
  "text": "your prompt here",
  "channel_id": "C08BW4X3VMX",
  "user_id": "U1234567890"
}
```

### GET `/health`

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "service": "mascot-gen"
}
```

### POST `/generate`

Test endpoint for image generation (bypasses Slack).

**Request Body:**
```json
{
  "prompt": "A robot mascot analyzing charts"
}
```

## Image Generation Process

1. **Command Reception**: Server receives `/tmai` command from Slack
2. **Channel Verification**: Ensures command is from target channel
3. **Prompt Enhancement**: Enhances user prompt with mascot-specific instructions
4. **Template Integration**: Combines user prompt with mascot template and logo
5. **Gemini API Call**: Sends enhanced prompt and images to Gemini 2.5 Flash
6. **Image Processing**: Receives and saves generated image
7. **Slack Upload**: Uploads image to the channel with description

## Prompt Engineering

The system automatically enhances user prompts with:

- Mascot character consistency
- Token Metrics branding guidelines
- Professional fintech aesthetics
- Marketing-ready specifications
- High-quality rendering instructions

## Error Handling

- Invalid commands return helpful error messages
- Channel restrictions are enforced
- API failures are logged and reported
- Image generation timeouts are handled gracefully
- Slack upload errors are caught and reported

## Logging

The server uses Pino for structured logging. Log levels:
- `error`: API failures, critical errors
- `warn`: Recoverable issues, warnings
- `info`: Command processing, successful generations
- `debug`: Detailed processing information

## File Structure

```
mascot-gen/
├── server.js              # Main Fastify server
├── package.json           # Dependencies and scripts
├── .env.example           # Environment template
├── README.md              # This file
├── mascot-template.png    # Mascot template image
├── tokenmetrics-logo.png  # Token Metrics logo
└── generated-images/      # Output directory (auto-created)
    └── mascot-*.png       # Generated images
```

## Dependencies

- **fastify**: Fast web framework
- **@google/genai**: Google Gemini API client
- **@slack/web-api**: Slack Web API client
- **@fastify/cors**: CORS support
- **@fastify/env**: Environment configuration
- **@fastify/multipart**: File upload support
- **@fastify/static**: Static file serving
- **pino**: Structured logging

## Security Considerations

- Slack request verification
- Environment variable protection
- Channel access restrictions
- Error message sanitization
- File upload limits
- API key protection

## Troubleshooting

### Common Issues

1. **"This command can only be used in the designated channel"**
   - Ensure you're using the command in channel C08BW4X3VMX
   - Check TARGET_CHANNEL environment variable

2. **"Unknown command" error**
   - Verify slash command is configured as `/tmai`
   - Check Slack app configuration

3. **Image generation fails**
   - Verify GEMINI_API_KEY is valid
   - Check template images exist
   - Review server logs for specific errors

4. **Slack upload fails**
   - Verify bot has required permissions
   - Check file size limits
   - Ensure channel access

### Development Tips

- Use `npm run dev` for auto-restart during development
- Check logs for detailed error information
- Test with `/generate` endpoint before Slack integration
- Monitor Gemini API usage and limits

## License

MIT License - Token Metrics