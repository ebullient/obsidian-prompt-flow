import {
    type App,
    Modal,
    Notice,
    PluginSettingTab,
    Setting,
    type SettingDefinitionItem,
} from "obsidian";
import type { ConnectionConfig, PromptConfig } from "./@types";
import { createLLMClient } from "./pflow-LLMClientFactory";
import type { PromptFlowPlugin } from "./pflow-Plugin";

// ── Settings tab ─────────────────────────────────────────────────────────────

export class PromptFlowSettingsTab extends PluginSettingTab {
    plugin: PromptFlowPlugin;

    constructor(app: App, plugin: PromptFlowPlugin) {
        super(app, plugin);
        this.plugin = plugin;
        this.icon = "messages-square";
    }

    getControlValue(key: string): unknown {
        return (this.plugin.settings as Record<string, unknown>)[key];
    }

    async setControlValue(key: string, value: unknown): Promise<void> {
        (this.plugin.settings as Record<string, unknown>)[key] = value;
        await this.plugin.saveSettings();
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
                items: this.connectionListItems(),
            },
            {
                type: "list",
                heading: "Prompts",
                desc: "Define prompts that can be invoked as commands to generate content using the LLM.",
                addItem: {
                    name: "Add prompt",
                    action: () => this.openPromptModal(null, null),
                },
                items: this.promptListItems(),
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
                        name: "Enable debug logging",
                        desc: "Write verbose plugin events to the developer console.",
                        control: {
                            type: "toggle",
                            key: "debugLogging",
                        },
                    },
                ],
            },
        ];
    }

    private connectionListItems(): SettingDefinitionItem[] {
        return Object.entries(this.plugin.settings.connections).map(
            ([connKey, connConfig]) => ({
                name: connKey,
                desc: `${connConfig.provider} · ${connConfig.baseUrl}`,
                render: (setting: Setting) => {
                    setting.addExtraButton((btn) =>
                        btn
                            .setIcon("pencil")
                            .setTooltip("Edit connection")
                            .onClick(() =>
                                this.openConnectionModal(connKey, connConfig),
                            ),
                    );
                    if (connKey !== this.plugin.settings.defaultConnection) {
                        setting.addExtraButton((btn) =>
                            btn
                                .setIcon("trash-2")
                                .setTooltip("Remove connection")
                                .onClick(() => this.removeConnection(connKey)),
                        );
                    }
                },
            }),
        );
    }

    private promptListItems(): SettingDefinitionItem[] {
        return Object.entries(this.plugin.settings.prompts).map(
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
                                this.openPromptModal(promptKey, promptConfig),
                            ),
                    );
                    if (Object.keys(this.plugin.settings.prompts).length > 1) {
                        setting.addExtraButton((btn) =>
                            btn
                                .setIcon("trash-2")
                                .setTooltip("Remove prompt")
                                .onClick(() => this.removePrompt(promptKey)),
                        );
                    }
                },
            }),
        );
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
                this.plugin.settings.connections[key] = config;
                await this.plugin.saveSettings();
                this.update();
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
                this.update();
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
        this.update();
    }

    removePrompt(promptKey: string): void {
        delete this.plugin.settings.prompts[promptKey];
        void this.plugin.saveSettings();
        this.update();
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
                .setDesc("Authentication key for the API")
                .addText((text) => {
                    text.inputEl.type = "password";
                    text.setValue(this.config.apiKey || "").onChange(
                        (value) => {
                            this.config.apiKey = value.trim();
                        },
                    );
                });
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
                const checkFile = (filePath: string) => {
                    const exists =
                        this.app.vault.getAbstractFileByPath(filePath) !== null;
                    if (exists) {
                        text.inputEl.addClass("fileFound");
                    } else {
                        text.inputEl.removeClass("fileFound");
                    }
                };
                text.setPlaceholder("prompts/my-prompt.md")
                    .setValue(this.config.promptFile || "")
                    .onChange((value) => {
                        const path = value.trim();
                        this.config.promptFile = path;
                        checkFile(path);
                    });
                checkFile(this.config.promptFile || "");
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
        const client = createLLMClient(conn, plugin);
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
