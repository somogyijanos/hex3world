# 🌍 Hex3World - AI-Powered 3D Hex World Generator

A Next.js application for generating and visualizing beautiful 3D hex-based worlds using AI language models. Features real-time edge validation, multiple LLM providers, and an intuitive 3D interface.

## ✨ Features

- 🤖 **AI World Generation** - Generate worlds using natural language descriptions
- 🔧 **Multiple LLM Providers** - Support for OpenAI, Claude, and local models
- ✅ **Edge Validation** - Real-time tile compatibility checking
- 🎨 **3D Visualization** - Interactive 3D rendering with Three.js
- 📦 **Asset Pack System** - Modular tile and add-on management
- 🔒 **Secure Configuration** - Environment-based API key management
- 💾 **Configurable World Saving** - Generated worlds can be automatically saved and shared (configurable via environment variable)

## 🚀 Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure LLM Settings

Copy the example environment file and configure your LLM provider:

```bash
cp env.example .env.local
```

Edit `.env.local` with your preferred configuration:

```bash
# Choose your LLM provider: openai, claude, or local
LLM_PROVIDER=openai

# Add your API key (only for the provider you're using)
OPENAI_API_KEY=sk-your-openai-api-key-here
# OR
CLAUDE_API_KEY=sk-ant-your-claude-api-key-here

# Optional: Customize model and settings
OPENAI_MODEL=gpt-4o
LLM_TEMPERATURE=0.7
LLM_MAX_TOKENS=4000
```

### 3. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### 4. Generate Your First World

1. Click the **"Generate World"** button in the control panel
2. Select an asset pack (e.g., "demo-pack")
3. Describe your world (e.g., "A peaceful village by a lake with roads")
4. Click **"Generate World"** and watch the AI create your world!

## 🔧 LLM Provider Setup

### OpenAI Setup
1. Get your API key from [OpenAI Platform](https://platform.openai.com/api-keys)
2. Set `LLM_PROVIDER=openai` and `OPENAI_API_KEY=sk-...` in `.env.local`

### Claude (Anthropic) Setup
1. Get your API key from [Anthropic Console](https://console.anthropic.com/)
2. Set `LLM_PROVIDER=claude` and `CLAUDE_API_KEY=sk-ant-...` in `.env.local`

### Local LLM Setup
1. Run a local LLM server (e.g., [Ollama](https://ollama.ai/), [LM Studio](https://lmstudio.ai/))
2. Set `LLM_PROVIDER=local` and `LOCAL_LLM_BASE_URL=http://localhost:1234` in `.env.local`

## 🎨 AI World Generation

### How It Works
The AI uses a sophisticated tool-calling system to generate worlds:
1. **Planning** - LLM analyzes your description and available tiles
2. **Placement** - AI places tiles one by one using validation tools
3. **Validation** - Every tile connection is mathematically verified
4. **Iteration** - AI adjusts and refines based on validation feedback

### Example Prompts

Try these example descriptions for different types of worlds:

**🏞️ Natural Landscapes**
- "A peaceful island with sandy beaches and scattered trees"
- "A small forest clearing with a winding stream"
- "Rolling hills with patches of grass and water features"

**🏘️ Settlements**
- "A cozy village connected by stone roads"
- "A medieval town with a central square and roads to different districts"
- "A riverside settlement with bridges and pathways"

**🗺️ Asset Pack Themes**
- **Demo Pack**: "A simple village with grass, water, and roads"
- **Medieval Pack**: "A medieval castle town with stone structures"
- **Mixed**: "Create a world mixing different architectural styles"

### Advanced Features

- **Asset Pack Selection** - Choose from different themed tile sets (Demo, Medieval, etc.)
- **World Expansion** - Add to existing worlds by enabling "Expand existing world"  
- **Constraint Control** - Set tile limits and preferred types
- **Real-time Progress** - Watch your world generate tile by tile
- **Validation Feedback** - See detailed compatibility checking
- **World Persistence** - Generated worlds can be automatically saved as JSON files (when `ENABLE_WORLD_SAVING=true`) and appear in the world selection dropdown for everyone to access

## 🏗️ Technical Architecture

### Core Components
- **LLM World Generator** - Orchestrates the generation process
- **LLM Tools Provider** - 10 specialized tools for world manipulation
- **Edge Validator** - Ensures tile compatibility
- **Asset Pack Manager** - Handles tile and addon definitions
- **3D Renderer** - Visualizes worlds with Three.js

### Available LLM Tools
1. `validate_edge_connection` - Check tile compatibility
2. `get_world_state` - Inspect current world
3. `get_available_tile_types` - List available tiles
4. `place_tile` - Place and validate tiles
5. `suggest_compatible_tiles` - Smart placement suggestions
6. `find_empty_positions` - Locate placement opportunities
7. `get_neighbor_info` - Analyze hex neighbors
8. `calculate_distance` - Hex coordinate math
9. `get_asset_pack_info` - Access complete asset data
10. `validate_world` - Complete world validation

## 🔒 Security & Environment Variables

All sensitive configuration is handled through environment variables:

| Variable | Description | Required |
|----------|-------------|----------|
| `LLM_PROVIDER` | Provider choice: `openai`, `claude`, `local` | Yes |
| `OPENAI_API_KEY` | OpenAI API key | If using OpenAI |
| `CLAUDE_API_KEY` | Claude API key | If using Claude |
| `LOCAL_LLM_BASE_URL` | Local LLM server URL | If using local |
| `LLM_TEMPERATURE` | Generation creativity (0.0-1.0) | No |
| `LLM_MAX_TOKENS` | Maximum response tokens | No |

## 📚 Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
