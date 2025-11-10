#!/bin/bash

# Token Metrics Mascot Generator Installation Script

echo "🚀 Installing Token Metrics Mascot Generator..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version 18+ is required. Current version: $(node -v)"
    exit 1
fi

echo "✅ Node.js version $(node -v) detected"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi

echo "✅ Dependencies installed successfully"

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "✅ .env file created. Please edit it with your API keys and tokens."
else
    echo "ℹ️  .env file already exists"
fi

# Create generated-images directory
mkdir -p generated-images
echo "📁 Created output directory: generated-images"

# Check if template images exist
if [ ! -f "mascot-template.png" ]; then
    echo "⚠️  Warning: mascot-template.png not found"
fi

if [ ! -f "tokenmetrics-logo.png" ]; then
    echo "⚠️  Warning: tokenmetrics-logo.png not found"
fi

echo ""
echo "🎉 Installation complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env file with your Slack and Gemini API credentials"
echo "2. Ensure mascot-template.png and tokenmetrics-logo.png are in the project root"
echo "3. Configure your Slack app with slash command /tmai pointing to http://your-server:3000/image-gen"
echo "4. Run 'npm start' to start the server"
echo ""
echo "For development, use: npm run dev"