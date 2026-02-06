/**
 * Feature Test Script
 * 
 * Tests the STT and Image Generation modules to verify they work correctly.
 * Run with: npx tsx src/test-features.ts
 */

import fs from 'fs';
import path from 'path';

const TEST_OUTPUT_DIR = './test-output';

async function testImageGeneration(): Promise<boolean> {
    console.log('\n🎨 Testing Image Generation...');

    try {
        const { generateImage, isImageGenAvailable } = await import('./image-gen.js');

        if (!isImageGenAvailable()) {
            console.log('⚠️  Image generation not available (GEMINI_API_KEY not set)');
            return false;
        }

        console.log('   API Key: Configured ✓');

        // Create test output directory
        fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });

        const testPrompt = 'A cute orange cat sitting on a windowsill';
        console.log(`   Prompt: "${testPrompt}"`);
        console.log('   Generating image...');

        const result = await generateImage(testPrompt, TEST_OUTPUT_DIR);

        if (result.success && result.imagePath) {
            const stats = fs.statSync(result.imagePath);
            console.log(`   ✅ Image generated: ${result.imagePath}`);
            console.log(`   📦 Size: ${(stats.size / 1024).toFixed(2)} KB`);
            return true;
        } else {
            console.log(`   ❌ Failed: ${result.error}`);
            return false;
        }
    } catch (err) {
        console.log(`   ❌ Error: ${err instanceof Error ? err.message : String(err)}`);
        return false;
    }
}

async function testSTT(): Promise<boolean> {
    console.log('\n🎤 Testing Speech-to-Text...');

    try {
        const { isSTTAvailable } = await import('./stt.js');

        const available = isSTTAvailable();
        console.log(`   STT Available: ${available ? 'Yes ✓' : 'No'}`);

        const provider = process.env.STT_PROVIDER || 'gemini';
        console.log(`   Provider: ${provider}`);

        if (provider === 'gcp') {
            const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
            if (credPath && fs.existsSync(credPath)) {
                console.log(`   GCP Credentials: Found ✓`);
            } else {
                console.log(`   GCP Credentials: Not found (will use Gemini pass-through)`);
            }
        }

        // Note: We can't fully test STT without an actual audio file
        console.log('   ⚠️  Full STT test requires an audio file');
        console.log('   Tip: Send a voice message to the bot to test');

        return available;
    } catch (err) {
        console.log(`   ❌ Error: ${err instanceof Error ? err.message : String(err)}`);
        return false;
    }
}

async function testContainerAgentContext(): Promise<boolean> {
    console.log('\n📦 Testing Container Agent Context...');

    try {
        const agentRunnerPath = './container/agent-runner/src/index.ts';
        if (!fs.existsSync(agentRunnerPath)) {
            console.log('   ⚠️  Agent runner not found at expected path');
            return false;
        }

        const content = fs.readFileSync(agentRunnerPath, 'utf-8');

        const hasImageGenDoc = content.includes('generate_image');
        const hasBrowserDoc = content.includes('agent-browser');

        console.log(`   Image Gen in context: ${hasImageGenDoc ? '✓' : '✗'}`);
        console.log(`   Browser in context: ${hasBrowserDoc ? '✓' : '✗'}`);

        return hasImageGenDoc && hasBrowserDoc;
    } catch (err) {
        console.log(`   ❌ Error: ${err instanceof Error ? err.message : String(err)}`);
        return false;
    }
}

async function main() {
    console.log('╔═══════════════════════════════════════════╗');
    console.log('║  NanoGemClaw Feature Test Suite           ║');
    console.log('╚═══════════════════════════════════════════╝');

    // Load environment
    await import('dotenv/config');

    const results: Record<string, boolean> = {};

    results['STT Module'] = await testSTT();
    results['Image Generation'] = await testImageGeneration();
    results['Agent Context'] = await testContainerAgentContext();

    console.log('\n═══════════════════════════════════════════');
    console.log('📊 Test Summary:');
    console.log('───────────────────────────────────────────');

    let passed = 0;
    let total = 0;

    for (const [name, result] of Object.entries(results)) {
        console.log(`   ${result ? '✅' : '❌'} ${name}`);
        if (result) passed++;
        total++;
    }

    console.log('───────────────────────────────────────────');
    console.log(`   Result: ${passed}/${total} tests passed`);
    console.log('═══════════════════════════════════════════\n');

    // Cleanup test output
    if (fs.existsSync(TEST_OUTPUT_DIR)) {
        console.log(`📁 Test images saved to: ${TEST_OUTPUT_DIR}/`);
    }
}

main().catch(console.error);
