// eslint.config.mjs
import globals from "globals";
import tseslint from "typescript-eslint";
import tsparser from "@typescript-eslint/parser";
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
    ...obsidianmd.configs.recommended,
    globalIgnores([
        "build/",
        "tests/",
        "*.mjs",
        "*.json"
    ]),
    {
        files: ["src/**/*.ts"],
        languageOptions: {
            parser: tsparser,
            parserOptions: { project: "./tsconfig.json" },
            globals: {
                ...globals.node,
                window: "readonly",
            },
        },
        // Optional project overrides
        rules: {
            "obsidianmd/ui/sentence-case": [
                "warn",
                {
                    brands: ["Ollama", "Prompt Flow", "http://localhost:11434", "llama3.1", "OpenAI", "my-connection", "10m"],
                    acronyms: ["MCP", "URL", "LLM", "AI", "API"],
                    enforceCamelCaseLower: true,
                },
            ],
        }
    }
]);
