# Prompt Flow

Generate AI content in Obsidian using local LLMs or OpenAI-compatible APIs. Features custom prompts, content filters, and an API for advanced integrations.

> **Important Notes**
>
> - **Privacy**: Supports local processing with Ollama or external OpenAI-compatible APIs
> - **Network Use**: Plugin only communicates with your configured LLM provider(s)
> - **Mobile Support**: Works on both desktop and mobile devices

## Features

- **Multiple LLM Providers**: Support for Ollama (local) and OpenAI-compatible APIs (OpenAI, OpenRouter, OpenWebUI, etc.)
- **Named Connections**: Configure multiple LLM providers and switch between them
- **AI-Powered Content Generation**: Generate personalized content based on custom prompts
- **Smart Insertion**: Add generated content at your cursor position
- **Customizable Prompts**: Configure system prompts, model selection, and per-note overrides
- **Link Expansion**: Optionally include content from `[[wikilinks]]` in your prompts
- **Content Filtering**: Exclude specific callout types or link patterns from processing
- **External Filter API**: Register custom content filters via `window.promptFlow.filters`

## Requirements

Choose one or more:

- **Ollama** (local): [Install Ollama](https://ollama.ai/) and pull a model (e.g., `llama3.1`)
- **OpenAI-compatible API**: OpenAI, OpenRouter, OpenWebUI, or any OpenAI-compatible service

## Installation

### Manual Installation

1. Download the latest release from GitHub
2. Extract the files to your vault's `.obsidian/plugins/prompt-flow/` directory
3. Reload Obsidian
4. Enable "Prompt Flow" in Settings → Community Plugins

### Install using BRAT

Assuming you have the BRAT plugin installed and enabled:

1. Open BRAT plugin settings
2. Click 'Add beta plugin'
3. Use `https://github.com/ebullient/obsidian-prompt-flow/` as the URL, and install the plugin
4. Enable "Prompt Flow", either as part of installation with BRAT, or in Settings → Community Plugins

### Building from Source

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup instructions.

## Setup

### For Ollama (Local)

1. Install and start Ollama on your machine
2. Pull a model: `ollama pull llama3.1`
3. In Obsidian, go to Settings → Prompt Flow → Connections
4. The default "local-ollama" connection should work automatically
5. Test the connection using the test button

### For OpenAI-Compatible APIs

1. In Obsidian, go to Settings → Prompt Flow → Connections
2. Click "Add connection"
3. Configure:
   - **Connection name**: A unique identifier (e.g., "openrouter", "openai")
   - **Provider**: Select "OpenAI-compatible"
   - **Base URL**: Your API endpoint (e.g., `https://api.openai.com`, `https://openrouter.ai/api`, `http://localhost:8080`)
   - **API Key**: Your API key for the service
   - **Default model**: Model identifier (e.g., `gpt-4o`, `gpt-4o-mini`, `meta-llama/llama-3.1-8b-instruct`)
4. Test the connection using the test button
5. Set as default connection if desired

## Usage

### Basic Usage

1. Open a note in Obsidian
2. Position your cursor where you want the prompt response to appear
3. Open the command palette (Cmd/Ctrl + P)
4. Run: **Generate `<prompt name>`** (e.g., "Generate reflection question")
5. The AI-generated content will be inserted as a blockquote (by default) at your cursor

### Configuring Prompts

In Settings → Prompt Flow → Prompts:

- **Add new prompt**: Create custom prompt configurations
- **Display label**: The name shown in commands and notifications
- **Prompt file**: Path to a markdown file containing your prompt (optional)

For each prompt, a command is automatically created: `Generate [prompt name]`

### Per-Note Overrides

You can override the prompt file on a per-note basis using frontmatter:

```yaml
---
prompt-file: "prompts/creative-writing-coach.md"
---
```

**Available override:**

- `prompt-file`: Path to a custom prompt file

This override allows different notes to use different prompt files with the same
command. Without this override, the plugin uses the prompt file configured in
Settings for that command.

To override the connection or model, specify these in the prompt file's
frontmatter instead (see Prompt File Configuration below).

### Prompt File Configuration

Prompt files can include frontmatter to customize behavior:

```markdown
---
connection: openrouter
model: meta-llama/llama-3.1-8b-instruct
num_ctx: 4096
temperature: 0.7
top_p: 0.9
isContinuous: true
includeLinks: true
excludeCalloutTypes: ["todo", "warning"]
wrapInBlockquote: true
---
You are a reflective companion. Ask concise questions that help summarize the
day.
```

**Available options:**

- `connection`: Connection name to use (overrides default)
- `model`: Specific model to use
- `num_ctx`: Context window size (tokens) or max_tokens for OpenAI-compatible
- `temperature`: Randomness (0.0-2.0, default: 0.8)
- `top_p`: Nucleus sampling threshold (0.0-1.0)
- `top_k`: Top-k sampling limit (Ollama only)
- `repeat_penalty`: Penalty for repetition (>0, default: 1.1, Ollama only)
- `isContinuous`: Keep conversation context between requests (default: false)
- `includeLinks`: Auto-expand `[[wikilinks]]` to include linked content (default: false)
- `excludePatterns`: Array of regex patterns to exclude links
- `excludeCalloutTypes`: Array of callout types to filter from content
- `filters`: Array of filter function names from `window.promptFlow.filters`
- `wrapInBlockquote`: Format output as blockquote (default: true)
- `calloutHeading`: Heading text for callout-style formatting
- `replaceSelectedText`: Replace selected text instead of inserting (default: false)

### Continuous Conversations

When `isContinuous` is `true`, the plugin maintains conversation context for each prompt/note combination. This allows follow-up prompts to build on previous exchanges. Context is automatically cleared after 30 minutes of inactivity.

### Link Expansion

When `includeLinks` is enabled, the plugin automatically includes content from `[[wikilinks]]` and embedded files in your note. This provides the AI with broader context.

**Link filtering:**

Configure global exclude patterns in Settings → Link filtering, or use `excludePatterns` in prompt frontmatter to filter specific links.

### Advanced: External Filter API

The plugin exposes `window.promptFlow.filters` for external scripts (CustomJS, other plugins) to register content transformation functions.

**Example filter registration:**

```javascript
// In a CustomJS script or another plugin
window.promptFlow = window.promptFlow || {};
window.promptFlow.filters = window.promptFlow.filters || {};

window.promptFlow.filters.redactSecrets = (content) => {
    return content.replace(/password:\s*\S+/gi, "password: ***");
};
```

**Using filters in prompt files:**

```markdown
---
filters: ["redactSecrets", "removeEmojis"]
---
Generate a thoughtful reflection question.
```

Filters are applied sequentially in the order specified before sending content to the LLM.

## Configuration Reference

### Connections

Configure one or more LLM provider connections in Settings → Prompt Flow → Connections.

**Ollama connection settings:**

- **Connection name**: Unique identifier (e.g., "local-ollama")
- **Provider**: Ollama
- **Base URL**: URL of your Ollama instance (default: `http://localhost:11434`)
- **Default model**: Model to use (e.g., `llama3.1`, `mistral`)
- **Keep alive**: How long to keep model loaded in memory (e.g., `10m`, `1h`, `-1` for always)

**OpenAI-compatible connection settings:**

- **Connection name**: Unique identifier (e.g., "openrouter", "openai")
- **Provider**: OpenAI-compatible
- **Base URL**: API endpoint URL
- **API Key**: Your API key for the service
- **Default model**: Model identifier (provider-specific)

The plugin auto-detects the correct API path structure for different OpenAI-compatible services (standard `/v1` or OpenWebUI `/api/v1`).

### Link Filtering

- **Exclude link patterns**: Regex patterns to skip specific links (one per line). Patterns are matched against the markdown format: `[display text](link target)`

### Debug Options

- **Show LLM request payloads**: Log prompts and content sent to the LLM provider (useful for debugging)
- **Enable debug logging**: Verbose plugin events in developer console

## Privacy & Security

- **Configurable processing**: Choose between local processing (Ollama) or external APIs (OpenAI-compatible)
- **No telemetry**: No usage tracking or data collection by the plugin
- **Direct connections**: Plugin only communicates with your configured LLM provider(s)
- **API key security**: API keys are stored in Obsidian's settings and never transmitted except to your configured provider

## Troubleshooting

**Cannot connect to LLM provider:**

- **Ollama**: Verify Ollama is running (`ollama serve`) and check the base URL
- **OpenAI-compatible**: Verify API key is correct and base URL is accessible
- Test connection using the test button in Settings → Connections
- Check console for errors (Cmd/Ctrl + Shift + I)

**No models found:**

- **Ollama**: Pull a model (`ollama pull llama3.1`) and verify with `ollama list`
- **OpenAI-compatible**: Check that your API key has access to the models
- Use the test connection button to see available models

**Generated content not appearing:**

- Check cursor position (must be in edit mode)
- Review console for errors (Cmd/Ctrl + Shift + I)
- Enable debug logging in settings
- Be patient. Large requests can take time to process.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, build commands, and architecture details. AI assistants should review [CLAUDE.md](CLAUDE.md) for working guidelines.

## Acknowledgements

This plugin is based on [Build an LLM Journaling Reflection Plugin for Obsidian](https://thomaschang.me/blog/obsidian-reflect) by Thomas Chang. See [his implementation](https://github.com/tchbw/obsidian-reflect/).

Additional implementation ideas come from the [Canvas Conversation](https://github.com/AndreBaltazar8/obsidian-canvas-conversation/tree/master) plugin by André Baltazar

## License

MIT

## Author

[ebullient](https://github.com/ebullient)
