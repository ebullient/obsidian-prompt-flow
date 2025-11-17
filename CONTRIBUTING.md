# Contributing to Journal Reflect

An Obsidian plugin that uses local AI (Ollama) to generate thoughtful
reflection questions while journaling.

## Project Structure

This is a TypeScript Obsidian plugin with the following core files:

- **journal-Plugin.ts**: Main plugin class
- **journal-OllamaClient.ts**: HTTP client for Ollama API
- **journal-SettingsTab.ts**: Settings UI
- **journal-Constants.ts**: Default settings and configuration
- **journal-Utils.ts**: Utility functions for prompt processing

## Build Commands

```bash
# Install dependencies
npm install

# Build the plugin (includes linting via prebuild)
npm run build

# Build and watch for changes
npm run dev

# Lint TypeScript files
npm run lint

# Auto-fix linting issues
npm run fix

# Format code
npm run format
```

## Local Development

### Development Setup

Set the `OUTDIR` environment variable to your test vault's plugin directory
for automatic deployment during development:

```bash
export OUTDIR="/path/to/vault/.obsidian/plugins/journal-reflect"
npm run dev
```

Changes will be automatically built and copied to your vault. Reload the
plugin in Obsidian to test.

### Testing with Ollama

This plugin requires a running Ollama instance for testing:

```bash
# Start Ollama
ollama serve

# Pull a model for testing
ollama pull llama3.1
```

Configure the plugin settings in Obsidian to point to your local Ollama
instance (default: `http://localhost:11434`).

## Code Standards

- **TypeScript**: Strict mode enabled
- **Line length**: 80 characters (hard limit)
- **Always use braces** for conditionals
- **Method chaining**: Break at dots for readability, even for single chains.
  This keeps lines under 80 chars and prevents Biome from wrapping
  unpredictably.

  ```typescript
  // GOOD - break at dots
  const patterns = this.settings.excludePatterns
      .split("\n")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

  // BAD - all on one line
  const patterns = this.settings.excludePatterns.split("\n").map((p) => p.trim());

  // GOOD - even single chains if they approach 80 chars
  const models = data.models
      ?.map((model) => model.name) || [];
  ```

- **Error handling**: Use `try/catch` with user-friendly `Notice` messages
- **Async**: Use `async/await` consistently
- **Naming**: Follow the `journal-` prefix pattern for all source files

## Development Patterns

When implementing new features:

1. **Find similar existing functions** in the same module you're modifying
   (use `Grep` to search)
2. **Follow established patterns** already in use rather than creating new
   approaches
3. **Emulate the style exactly**, especially for method chains and
   async/await
4. **Check error handling patterns** and maintain consistency

## Architecture Overview

### Local AI Integration

The plugin integrates with Ollama, a local LLM runtime, to generate
reflection questions. This ensures complete privacy - no data leaves your
machine.

**Key architectural decisions:**

- **Local-only**: All AI processing happens via your local Ollama instance
- **Flexible prompts**: Support for per-document prompt overrides via
  frontmatter
- **Context awareness**: Optional continuous conversation context for
  follow-up questions
- **Smart insertion**: Intelligent cursor-based content insertion with
  formatting

### Prompt Resolution System

The plugin implements a three-tier prompt resolution system:

1. **Direct frontmatter prompt**: `prompt` key in note frontmatter (highest
   priority)
2. **Referenced prompt file**: `prompt-file` key pointing to a markdown file
3. **Plugin settings**: Default prompt configured in settings (fallback)

Prompt files can include their own frontmatter to override model parameters:

- `model`: Specific Ollama model to use
- `num_ctx`: Context window size
- `temperature`, `top_p`, `top_k`, `repeat_penalty`: Generation parameters
- `isContinuous`: Enable conversation context persistence
- `includeLinks`: Auto-expand `[[wikilinks]]` in content
- `excludePatterns`: Regex patterns to filter linked content
- `excludeCalloutTypes`: Callout types to filter from content
- `filters`: External filter functions to apply
- `wrapInBlockquote`: Format output as blockquote
- `calloutHeading`: Heading for callout-style formatting
- `replaceSelectedText`: Replace selection instead of inserting

### Content Processing Pipeline

1. **Content extraction**: Read current note content
2. **Link expansion**: Optionally expand `[[wikilinks]]` to include linked
   note content
3. **Callout filtering**: Remove specified callout types
4. **Pre-filtering**: Apply registered external filters
5. **LLM generation**: Send to Ollama with system prompt
6. **Smart insertion**: Insert at cursor with intelligent formatting

### Pre-Filter API

The plugin exposes `window.journal.filters` for external scripts (CustomJS,
other plugins) to register content transformation functions. This allows
advanced users to:

- Redact sensitive information before sending to LLM
- Remove or transform specific content patterns
- Normalize formatting
- Apply custom preprocessing logic

## AI-Assisted Contributions

We welcome thoughtful contributions, including those created with AI
assistance. However, please ensure:

- **You understand the changes**: You must be able to explain the rationale
  for your decisions clearly
- **You've tested appropriately**: Run `npm run build` and test with a real
  Ollama instance
- **You've followed existing patterns**: Check similar functions and emulate
  their style
- **The contribution addresses a real need**: Focus on solving actual
  problems
- **You've read the AI assistant guidelines**: See
  [CLAUDE.md](CLAUDE.md) for AI-specific working guidelines

Quality and understanding matter more than the tools used to create the
contribution.
