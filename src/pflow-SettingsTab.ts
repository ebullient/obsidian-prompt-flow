import {
    AbstractInputSuggest,
    type App,
    Modal,
    Notice,
    PluginSettingTab,
    SecretComponent,
    Setting,
    type SettingDefinitionItem,
    type TFile,
} from "obsidian";
import type { ConnectionConfig, PromptConfig } from "./@types";
import { createLLMClient } from "./pflow-LLMClientFactory";
import type { PromptFlowPlugin } from "./pflow-Plugin";

const PROMPT_ONLY_SETTINGS: { name: string; desc: string }[] = [
    {
        name: "prompt-file",
        desc:
            "Note frontmatter only. Overrides the prompt file configured " +
            "in settings for this note.",
    },
    {
        name: "model",
        desc: "Overrides the connection's default model for this prompt.",
    },
    {
        name: "num_ctx",
        desc:
            "Context window size in tokens (max_tokens for " +
            "OpenAI-compatible). Required when using the window filter.",
    },
    {
        name: "temperature",
        desc: "Randomness of output, 0.0-2.0. Default: 0.8.",
    },
    {
        name: "top_p",
        desc: "Nucleus sampling threshold, 0.0-1.0.",
    },
    {
        name: "top_k",
        desc: "Top-k sampling limit. Ollama only.",
    },
    {
        name: "repeat_penalty",
        desc: "Penalty for repetition, > 0. Default: 1.1. Ollama only.",
    },
    {
        name: "context",
        desc:
            "Portion of the note to send: above, below, selection, " +
            "none, or omit for the full note.",
    },
    {
        name: "isContinuous",
        desc:
            "Keep conversation context between requests for this " +
            "prompt/note combination. Default: false.",
    },
    {
        name: "includeLinks",
        desc:
            "Auto-expand [[wikilinks]] to include linked content. " +
            "Default: false.",
    },
    {
        name: "excludePatterns",
        desc:
            "Regex patterns to exclude specific links, overriding the " +
            "global exclude patterns for this prompt.",
    },
    {
        name: "excludeCalloutTypes",
        desc:
            "Callout types to filter out of note content before " +
            "sending it to the model.",
    },
    {
        name: "filters",
        desc:
            "Names of filter functions to apply to note content, in " +
            "order, before sending it to the model.",
    },
    {
        name: "wrapInBlockquote",
        desc: "Format generated output as a blockquote. Default: true.",
    },
    {
        name: "calloutHeading",
        desc: "Heading text to use when formatting output as a callout.",
    },
];

export class PromptFlowSettingsTab extends PluginSettingTab {
    plugin: PromptFlowPlugin;

    constructor(app: App, plugin: PromptFlowPlugin) {
        super(app, plugin);
        this.plugin = plugin;
        this.icon = "messages-square";
    }

    getSettingDefinitions(): SettingDefinitionItem[] {
        return [
            {
                name: "Default connection",
                desc: "Connection to use when prompt doesn't specify one",
                render: (setting: Setting) => {
                    setting.addDropdown((dropdown) => {
                        for (const key of Object.keys(
                            this.plugin.settings.connections,
                        )) {
                            dropdown.addOption(key, key);
                        }
                        dropdown
                            .setValue(this.plugin.settings.defaultConnection)
                            .onChange(async (value) => {
                                this.plugin.settings.defaultConnection = value;
                                await this.plugin.saveSettings();
                            });
                    });
                },
            },
            {
                type: "list",
                heading: "Connections",
                addItem: {
                    name: "Add connection",
                    action: () => this.openConnectionModal(null, null),
                },
                items: Object.entries(this.plugin.settings.connections).map(
                    ([connKey, connConfig]) => ({
                        name: connKey,
                        desc: `${connConfig.provider} · ${connConfig.baseUrl}`,
                        render: (setting: Setting) => {
                            setting.addExtraButton((btn) =>
                                btn
                                    .setIcon("pencil")
                                    .setTooltip("Edit connection")
                                    .onClick(() =>
                                        this.openConnectionModal(
                                            connKey,
                                            connConfig,
                                        ),
                                    ),
                            );
                            if (
                                connKey !==
                                this.plugin.settings.defaultConnection
                            ) {
                                setting.addExtraButton((btn) =>
                                    btn
                                        .setIcon("trash-2")
                                        .setTooltip("Remove connection")
                                        .onClick(() =>
                                            this.removeConnection(connKey),
                                        ),
                                );
                            }
                        },
                    }),
                ),
            },
            {
                type: "list",
                heading: "Prompts",
                desc: "Define prompts that can be invoked as commands to generate content using the LLM.",
                addItem: {
                    name: "Add prompt",
                    action: () => this.openPromptModal(null, null),
                },
                items: Object.entries(this.plugin.settings.prompts).map(
                    ([promptKey, promptConfig]) => ({
                        name: promptConfig.displayLabel,
                        desc: [
                            promptConfig.promptFile || "no file set",
                            promptConfig.connection
                                ? `connection: ${promptConfig.connection}`
                                : null,
                        ]
                            .filter(Boolean)
                            .join(" · "),
                        render: (setting: Setting) => {
                            setting.addExtraButton((btn) =>
                                btn
                                    .setIcon("pencil")
                                    .setTooltip("Edit prompt")
                                    .onClick(() =>
                                        this.openPromptModal(
                                            promptKey,
                                            promptConfig,
                                        ),
                                    ),
                            );
                            if (
                                Object.keys(this.plugin.settings.prompts)
                                    .length > 1
                            ) {
                                setting.addExtraButton((btn) =>
                                    btn
                                        .setIcon("trash-2")
                                        .setTooltip("Remove prompt")
                                        .onClick(() =>
                                            this.removePrompt(promptKey),
                                        ),
                                );
                            }
                        },
                    }),
                ),
            },
            {
                type: "group",
                heading: "Link filtering",
                items: [
                    {
                        name: "Exclude link patterns",
                        desc: "Skip links matching these regular expression patterns; one pattern per line.",
                        control: {
                            type: "textarea",
                            key: "excludePatterns",
                            placeholder: "^reflect on\ntodo:\n\\[template\\]",
                            rows: 4,
                        },
                    },
                ],
            },
            {
                type: "group",
                heading: "Debugging",
                items: [
                    {
                        name: "Show LLM request payloads",
                        desc: "Log the exact prompt and document text sent to Ollama.",
                        control: {
                            type: "toggle",
                            key: "showLlmRequests",
                        },
                    },
                    {
                        name: "Show model reasoning",
                        desc: "Log reasoning from thinking models to the developer console. Reasoning is never written to the note.",
                        control: {
                            type: "toggle",
                            key: "showReasoning",
                        },
                    },
                    {
                        name: "Enable debug logging",
                        desc: "Write verbose plugin events to the developer console.",
                        control: {
                            type: "toggle",
                            key: "debugLogging",
                        },
                    },
                ],
            },
            {
                name: "Prompt-only settings",
                desc: createFragment((el) => {
                    const ul = el.createEl("ul");
                    for (const item of PROMPT_ONLY_SETTINGS) {
                        const li = ul.createEl("li");
                        li.createEl("strong", { text: item.name });
                        li.appendText(`: ${item.desc}`);
                    }
                }),
            },
            {
                name: "",
                render: (setting: Setting) => {
                    setting.descEl.addClass("prompt-flow-coffee");
                    setting.descEl
                        .createEl("a", {
                            href: "https://www.buymeacoffee.com/ebullient",
                        })
                        .createEl("img", {
                            attr: {
                                src: "https://img.buymeacoffee.com/button-api/?text=Buy me a coffee&emoji=☕&slug=ebullient&button_colour=8e6787&font_colour=ebebeb&font_family=Inter&outline_colour=392a37&coffee_colour=ecc986",
                                height: "30px",
                            },
                        });
                },
            },
        ];
    }

    private refresh(): void {
        this.update();
    }

    private openConnectionModal(
        connKey: string | null,
        connConfig: ConnectionConfig | null,
    ): void {
        new ConnectionModal(
            this.app,
            this.plugin,
            connKey,
            connConfig,
            async (key, config) => {
                delete config.apiKey;
                this.plugin.settings.connections[key] = config;
                await this.plugin.saveSettings();
                this.refresh();
            },
        ).open();
    }

    private openPromptModal(
        promptKey: string | null,
        promptConfig: PromptConfig | null,
    ): void {
        new PromptModal(
            this.app,
            this.plugin,
            promptKey,
            promptConfig,
            async (key, config) => {
                this.plugin.settings.prompts[key] = config;
                await this.plugin.saveSettings();
                this.refresh();
            },
        ).open();
    }

    removeConnection(connKey: string): void {
        for (const promptKey of Object.keys(this.plugin.settings.prompts)) {
            if (
                this.plugin.settings.prompts[promptKey].connection === connKey
            ) {
                delete this.plugin.settings.prompts[promptKey].connection;
            }
        }
        delete this.plugin.settings.connections[connKey];
        void this.plugin.saveSettings();
        this.refresh();
    }

    removePrompt(promptKey: string): void {
        delete this.plugin.settings.prompts[promptKey];
        void this.plugin.saveSettings();
        this.refresh();
    }
}

// ── Connection modal ──────────────────────────────────────────────────────────

class ConnectionModal extends Modal {
    private plugin: PromptFlowPlugin;
    private originalKey: string | null;
    private key: string;
    private config: ConnectionConfig;
    private onSave: (key: string, config: ConnectionConfig) => Promise<void>;

    constructor(
        app: App,
        plugin: PromptFlowPlugin,
        connKey: string | null,
        connConfig: ConnectionConfig | null,
        onSave: (key: string, config: ConnectionConfig) => Promise<void>,
    ) {
        super(app);
        this.plugin = plugin;
        this.originalKey = connKey;
        this.key = connKey ?? `connection-${Date.now()}`;
        this.config = connConfig
            ? { ...connConfig }
            : { provider: "ollama", baseUrl: "http://localhost:11434" };
        this.onSave = onSave;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        this.titleEl.setText(
            this.originalKey ? "Edit connection" : "Add connection",
        );
        this.render();
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();

        new Setting(contentEl)
            .setName("Connection identifier")
            .setDesc(
                "Unique identifier for this connection (used in prompt frontmatter)",
            )
            .addText((text) =>
                text
                    .setPlaceholder("my-connection")
                    .setValue(this.key)
                    .onChange((value) => {
                        this.key = value.trim();
                    }),
            );

        new Setting(contentEl)
            .setName("Provider type")
            .setDesc("Local Ollama or OpenAI-compatible API")
            .addDropdown((dropdown) =>
                dropdown
                    .addOption("ollama", "Ollama")
                    .addOption("openai-compatible", "OpenAI-compatible")
                    .setValue(this.config.provider)
                    .onChange((value) => {
                        this.config.provider = value as
                            | "ollama"
                            | "openai-compatible";
                        this.render();
                    }),
            );

        const urlSettingText = "API endpoint URL";
        const urlSetting = new Setting(contentEl)
            .setName("Base URL")
            .setDesc(urlSettingText)
            .addText((text) =>
                text
                    .setPlaceholder("http://localhost:11434")
                    .setValue(this.config.baseUrl)
                    .onChange((value) => {
                        const trimmed = value.trim();
                        this.config.baseUrl =
                            trimmed && !trimmed.startsWith("http")
                                ? `http://${trimmed}`
                                : trimmed;
                    }),
            )
            .addButton((bc) =>
                bc
                    .setIcon("cable")
                    .setTooltip("Test connection")
                    .onClick(async () => {
                        bc.setDisabled(true);
                        urlSetting.setDesc(`${urlSettingText} — Connecting...`);
                        try {
                            const message = await testConnection(
                                this.config,
                                this.key,
                                this.plugin,
                            );
                            urlSetting.setDesc(
                                `${urlSettingText} — ${message}`,
                            );
                        } catch (error) {
                            const errorMsg = this.plugin.logError(
                                error,
                                "Test connection failed",
                            );
                            urlSetting.setDesc(
                                `${urlSettingText} — ❌ Error: ${errorMsg}`,
                            );
                        } finally {
                            bc.setDisabled(false);
                        }
                    }),
            );

        if (this.config.provider === "openai-compatible") {
            new Setting(contentEl)
                .setName("API key")
                .setDesc(
                    "Select a secret from the keychain containing the API key",
                )
                .addComponent((el) =>
                    new SecretComponent(this.app, el)
                        .setValue(this.config.apiKeySecret || "")
                        .onChange((value) => {
                            this.config.apiKeySecret = value;
                        }),
                );
        }

        new Setting(contentEl)
            .setName("Default model")
            .setDesc("Model name to use by default (optional)")
            .addText((text) =>
                text
                    .setPlaceholder("llama3.1")
                    .setValue(this.config.defaultModel || "")
                    .onChange((value) => {
                        this.config.defaultModel = value.trim();
                    }),
            );

        if (this.config.provider === "ollama") {
            new Setting(contentEl)
                .setName("Keep alive")
                .setDesc("How long to keep model in memory")
                .addText((text) =>
                    text
                        .setPlaceholder("10m")
                        .setValue(this.config.keepAlive || "")
                        .onChange((value) => {
                            this.config.keepAlive = value.trim();
                        }),
                );
        }

        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText("Save")
                    .setCta()
                    .onClick(async () => {
                        if (!this.key) {
                            new Notice(
                                "Connection identifier cannot be empty.",
                            );
                            return;
                        }
                        await this.onSave(this.key, this.config);
                        this.close();
                    }),
            )
            .addButton((btn) =>
                btn.setButtonText("Cancel").onClick(() => this.close()),
            );
    }
}

// ── Prompt modal ──────────────────────────────────────────────────────────────

class PromptModal extends Modal {
    private plugin: PromptFlowPlugin;
    private originalKey: string | null;
    private key: string;
    private config: PromptConfig;
    private onSave: (key: string, config: PromptConfig) => Promise<void>;

    constructor(
        app: App,
        plugin: PromptFlowPlugin,
        promptKey: string | null,
        promptConfig: PromptConfig | null,
        onSave: (key: string, config: PromptConfig) => Promise<void>,
    ) {
        super(app);
        this.plugin = plugin;
        this.originalKey = promptKey;
        this.key = promptKey ?? `custom-${Date.now()}`;
        this.config = promptConfig ? { ...promptConfig } : { displayLabel: "" };
        this.onSave = onSave;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        this.titleEl.setText(this.originalKey ? "Edit prompt" : "Add prompt");
        this.renderForm();
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private renderForm(): void {
        const { contentEl } = this;

        new Setting(contentEl)
            .setName("Display label")
            .setDesc("Label shown in commands and notifications")
            .addText((text) =>
                text.setValue(this.config.displayLabel).onChange((value) => {
                    this.config.displayLabel = value.trim();
                }),
            );

        new Setting(contentEl)
            .setName("Connection")
            .setDesc("Which LLM connection to use (leave empty for default)")
            .addDropdown((dropdown) => {
                dropdown.addOption("", "Use default connection");
                for (const key of Object.keys(
                    this.plugin.settings.connections,
                )) {
                    dropdown.addOption(key, key);
                }
                dropdown
                    .setValue(this.config.connection || "")
                    .onChange((value) => {
                        if (value === "") {
                            delete this.config.connection;
                        } else {
                            this.config.connection = value;
                        }
                    });
            });

        new Setting(contentEl)
            .setName("Prompt file")
            .setDesc(
                "Path to file containing the prompt and invocation parameters; see documentation for details.",
            )
            .addText((text) => {
                new FileSuggest(this.app, text.inputEl);
                text.setPlaceholder("prompts/my-prompt.md")
                    .setValue(this.config.promptFile || "")
                    .onChange((value) => {
                        const path = value.trim();
                        this.config.promptFile = path;
                    });
            });

        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText("Save")
                    .setCta()
                    .onClick(async () => {
                        if (!this.config.displayLabel) {
                            new Notice("Display label cannot be empty.");
                            return;
                        }
                        await this.onSave(this.key, this.config);
                        this.close();
                    }),
            )
            .addButton((btn) =>
                btn.setButtonText("Cancel").onClick(() => this.close()),
            );
    }
}

// ── File suggester ────────────────────────────────────────────────────────────

class FileSuggest extends AbstractInputSuggest<TFile> {
    private textInputEl: HTMLInputElement;

    constructor(app: App, inputEl: HTMLInputElement) {
        super(app, inputEl);
        this.textInputEl = inputEl;
    }

    getSuggestions(query: string): TFile[] {
        const lower = query.toLowerCase();
        return this.app.vault
            .getMarkdownFiles()
            .filter((f) => f.path.toLowerCase().includes(lower))
            .slice(0, 20);
    }

    renderSuggestion(file: TFile, el: HTMLElement): void {
        el.setText(file.path);
    }

    selectSuggestion(file: TFile): void {
        this.setValue(file.path);
        this.textInputEl.dispatchEvent(new Event("input"));
        this.close();
    }
}

// ── Shared helpers ────────────────────────────────────────────────────────────

async function testConnection(
    conn: ConnectionConfig,
    connKey: string,
    plugin: PromptFlowPlugin,
): Promise<string> {
    try {
        plugin.logInfo(
            "Testing connection:",
            connKey,
            conn.provider,
            conn.baseUrl,
        );
        const client = createLLMClient(conn, plugin.app, plugin);
        plugin.logInfo("Client created successfully");

        const isConnected = await client.checkConnection();
        plugin.logInfo("Connection check result:", isConnected);

        if (isConnected) {
            plugin.logInfo("Fetching models...");
            const models = await client.listModels();
            plugin.logInfo("Models fetched:", models);
            return models.length > 0
                ? `✅ Connected | Models: ${models.join(", ")}`
                : "✅ Connected | no models found";
        } else {
            return "❌ Cannot connect";
        }
    } catch (error) {
        const errorMsg = plugin.logError(error, "Connection test failed");
        return `❌ ${errorMsg}`;
    }
}
