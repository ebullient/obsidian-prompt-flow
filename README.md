# Prompt Flow

Generate AI content in Obsidian using your local Ollama instance. Features custom prompts, content filters, and an API for advanced integrations.

> **Important Notes**
>
> - **Privacy**: All processing happens locally using your own Ollama instance. No data is sent to external services.
> - **Network Use**: This plugin only communicates with your local Ollama instance (default: `http://localhost:11434`).
> - **Mobile Support**: Works on both desktop and mobile devices.

## Features

- **AI-Powered Content Generation**: Uses your local Ollama instance to generate personalized content based on custom prompts
- **Smart Insertion**: Add generated content at your cursor position
- **Customizable Prompts**: Configure system prompts, model selection, and per-note overrides
- **Link Expansion**: Optionally include content from `[[wikilinks]]` in your prompts
- **Content Filtering**: Exclude specific callout types or link patterns from processing
- **External Filter API**: Register custom content filters via `window.promptFlow.filters`

## Requirements

- [Ollama](https://ollama.ai/) running locally
- A language model installed in Ollama (e.g., `llama3.1`, `mistral`)

## Installation

### Manual Installation

1. Download the latest release from GitHub
2. Extract the files to your vault's `.obsidian/plugins/prompt-flow/` directory
3. Reload Obsidian
4. Enable "Prompt Flow" in Settings → Community Plugins

### Building from Source

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup instructions.

## Setup

1. Install and start Ollama on your machine
2. Pull a model: `ollama pull llama3.1`
3. In Obsidian, go to Settings → Prompt Flow
4. Configure your Ollama URL (default: `http://localhost:11434`)
5. Set your default model name (e.g., `llama3.1`)
6. Test the connection using the test button

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

### Per-Note Prompt Overrides

You can override the default prompt file on a per-note basis using frontmatter:

```yaml
---
prompt-file: "prompts/creative-writing-coach.md"
---
```

Without this override, the plugin uses the prompt file configured in plugin settings for that command.

### Prompt File Configuration

Prompt files can include frontmatter to customize behavior:

```markdown
---
model: llama3.1
num_ctx: 4096
temperature: 0.7
top_p: 0.9
top_k: 40
repeat_penalty: 1.1
isContinuous: true
includeLinks: true
excludeCalloutTypes: ["todo", "warning"]
wrapInBlockquote: true
---
You are a reflective companion. Ask concise questions that help summarize the
day.
```

**Available options:**

- `model`: Specific Ollama model to use
- `num_ctx`: Context window size (tokens)
- `temperature`: Randomness (0.0-2.0, default: 0.8)
- `top_p`: Nucleus sampling threshold (0.0-1.0)
- `top_k`: Top-k sampling limit
- `repeat_penalty`: Penalty for repetition (>0, default: 1.1)
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

Filters are applied sequentially in the order specified before sending content to Ollama.

## Configuration Reference

### Ollama Settings

- **Ollama URL**: URL of your Ollama instance (default: `http://localhost:11434`)
- **Model name**: Default model to use (e.g., `llama3.1`, `mistral`)
- **Keep alive**: How long to keep model loaded in memory (e.g., `10m`, `1h`, `-1` for always)

### Link Filtering

- **Exclude link patterns**: Regex patterns to skip specific links (one per line). Patterns are matched against the markdown format: `[display text](link target)`

### Debug Options

- **Show LLM request payloads**: Log prompts and content sent to Ollama (useful for debugging)
- **Enable debug logging**: Verbose plugin events in developer console

## Privacy & Security

- **Local-only processing**: All AI generation happens via your local Ollama instance
- **No telemetry**: No usage tracking or data collection
- **No external services**: Plugin only communicates with your configured Ollama URL

## Troubleshooting

**Cannot connect to Ollama:**

- Verify Ollama is running: `ollama serve`
- Check the Ollama URL in settings
- Test connection using the test button in settings

**No models found:**

- Pull a model: `ollama pull llama3.1`
- Verify models are installed: `ollama list`

**Generated content not appearing:**

- Check cursor position (must be in edit mode)
- Review console for errors (Cmd/Ctrl + Shift + I)
- Enable debug logging in settings
- Be patient. If you're sending a lot of data, it can take a bit.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, build commands, and architecture details. AI assistants should review [CLAUDE.md](CLAUDE.md) for working guidelines.

## Acknowledgements

This plugin is based on [Build an LLM Journaling Reflection Plugin for Obsidian](https://thomaschang.me/blog/obsidian-reflect) by Thomas Chang. See [his implementation](https://github.com/tchbw/obsidian-reflect/).

## License

MIT

## Author

[ebullient](https://github.com/ebullient)
