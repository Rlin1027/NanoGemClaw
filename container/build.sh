#!/bin/bash
# Build the NanoGemClaw agent container image

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

IMAGE_NAME="nanogemclaw-agent"
TAG="${1:-latest}"

echo "Building NanoGemClaw agent container image..."
echo "Image: ${IMAGE_NAME}:${TAG}"

# Build with Apple Container (or Docker)
if command -v container &> /dev/null; then
    echo "Using Apple Container..."
    container build -t "${IMAGE_NAME}:${TAG}" .
elif command -v docker &> /dev/null; then
    echo "Using Docker..."
    docker build -t "${IMAGE_NAME}:${TAG}" .
else
    echo "Error: Neither 'container' nor 'docker' found"
    exit 1
fi

echo ""
echo "Build complete!"
echo "Image: ${IMAGE_NAME}:${TAG}"
echo ""
echo "Test with:"
echo "  echo '{\"prompt\":\"What is 2+2?\",\"groupFolder\":\"test\",\"chatJid\":\"test@g.us\",\"isMain\":false}' | container run -i ${IMAGE_NAME}:${TAG}"
