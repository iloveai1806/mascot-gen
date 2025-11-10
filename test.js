#!/usr/bin/env node

// Test script for Token Metrics Mascot Generator

import fetch from 'node-fetch';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

async function testHealth() {
  console.log('🏥 Testing health endpoint...');
  try {
    const response = await fetch(`${SERVER_URL}/health`);
    const data = await response.json();
    console.log('✅ Health check passed:', data);
    return true;
  } catch (error) {
    console.log('❌ Health check failed:', error.message);
    return false;
  }
}

async function testImageGeneration() {
  console.log('🎨 Testing image generation...');
  try {
    const response = await fetch(`${SERVER_URL}/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: 'A robot mascot analyzing cryptocurrency charts on a computer screen'
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('✅ Image generation test passed:', data);
    return true;
  } catch (error) {
    console.log('❌ Image generation test failed:', error.message);
    return false;
  }
}

async function testSlashCommand() {
  console.log('📝 Testing slash command endpoint...');
  try {
    const response = await fetch(`${SERVER_URL}/image-gen`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        command: '/tmai',
        text: 'A mascot celebrating Bitcoin reaching new heights',
        channel_id: 'C08BW4X3VMX',
        user_id: 'U1234567890',
        response_url: 'https://hooks.slack.com/test'
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('✅ Slash command test passed:', data);
    return true;
  } catch (error) {
    console.log('❌ Slash command test failed:', error.message);
    return false;
  }
}

async function runTests() {
  console.log('🧪 Starting Token Metrics Mascot Generator Tests');
  console.log('🌐 Server URL:', SERVER_URL);
  console.log('');

  const tests = [
    { name: 'Health Check', fn: testHealth },
    { name: 'Image Generation', fn: testImageGeneration },
    { name: 'Slash Command', fn: testSlashCommand }
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const result = await test.fn();
    if (result) {
      passed++;
    } else {
      failed++;
    }
    console.log('');
  }

  console.log('📊 Test Results:');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Success Rate: ${Math.round((passed / tests.length) * 100)}%`);

  if (failed > 0) {
    console.log('');
    console.log('💡 Make sure the server is running and all environment variables are set correctly.');
    process.exit(1);
  } else {
    console.log('');
    console.log('🎉 All tests passed! The mascot generator is ready to use.');
  }
}

// Run tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch(console.error);
}

export { runTests, testHealth, testImageGeneration, testSlashCommand };