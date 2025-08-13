# 🌍 Hex3World

> AI-powered 3D hex world generator built with Next.js

![Hex3World](docs/hex3dworld.png)


Generate beautiful 3D hex-based worlds using natural language descriptions. Just tell the AI what kind of world you want, and watch it build it tile by tile with real-time validation.

## ✨ Features

- 🤖 **AI World Generation** - Describe your world in natural language
- 🔧 **Multiple LLM Providers** - OpenAI, Claude, or local models
- 🎨 **3D Visualization** - Interactive rendering with Three.js
- 📦 **Asset Pack System** - Modular tile sets and add-ons
- ✅ **Smart Validation** - Real-time tile compatibility checking

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Set up environment
cp env.example .env.local
# Edit .env.local with your API key

# Run the app
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and start generating worlds!

### Example Prompts
- "A peaceful village by a lake with roads"
- "A medieval castle town with stone structures"
- "Rolling hills with scattered trees and streams"

## 🔧 Configuration

Add your LLM provider API key to `.env.local`:

```bash
# OpenAI
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-your-key-here

# Or Claude
LLM_PROVIDER=claude
CLAUDE_API_KEY=sk-ant-your-key-here

# Or Local (Ollama, LM Studio, etc.)
LLM_PROVIDER=local
LOCAL_LLM_BASE_URL=http://localhost:1234
```

## 🎨 How It Works

The AI uses a tool-calling system to build worlds:
1. **Planning** - Analyzes your description and available tiles
2. **Placement** - Places tiles one by one with real-time validation
3. **Validation** - Ensures all tile connections are compatible
4. **Iteration** - Adjusts and refines based on feedback

## 🚀 Deployment

For production deployment, see [DEPLOYMENT.md](./docs/DEPLOYMENT.md) for security configurations and best practices.

## 📚 Learn More

- Detailed architecture: [PLAN.md](./docs/PLAN.md)
- Schema documentation: [SCHEMA_DRAFTS.md](./docs/SCHEMA_DRAFTS.md)
- Security guide: [SECURITY.md](./docs/SECURITY.md)