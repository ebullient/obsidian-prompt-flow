import { type App, PluginSettingTab, Setting } from "obsidian";
import type {
    ConnectionConfig,
    PromptConfig,
    PromptFlowSettings,
} from "./@types";
import { createLLMClient } from "./pflow-LLMClientFactory";
import type { PromptFlowPlugin } from "./pflow-Plugin";

export class PromptFlowSettingsTab extends PluginSettingTab {
    plugin: PromptFlowPlugin;
    newSettings!: PromptFlowSettings;

    constructor(app: App, plugin: PromptFlowPlugin) {
        super(app, plugin);
        this.plugin = plugin;
        this.icon = "messages-square";
    }

    async save() {
        this.plugin.settings = this.newSettings;
        await this.plugin.saveSettings();
    }

    private cloneSettings(): PromptFlowSettings {
        return JSON.parse(
            JSON.stringify(this.plugin.settings),
        ) as PromptFlowSettings;
    }

    reset() {
        this.newSettings = this.cloneSettings();
        this.display();
    }

    display(): void {
        if (!this.newSettings) {
            this.newSettings = this.cloneSettings();
        }

        this.containerEl.empty();

        new Setting(this.containerEl)
            .setName("Save settings")
            .setClass("pflow-reflect-save-reset")
            .addButton((button) =>
                button
                    .setIcon("reset")
                    .setTooltip("Reset to previously saved values.")
                    .onClick(() => {
                        this.reset();
                    }),
            )
            .addButton((button) => {
                button
                    .setIcon("save")
                    .setCta()
                    .setTooltip("Save all changes")
                    .onClick(async () => {
                        await this.save();
                    });
            });

        new Setting(this.containerEl).setName("Connections").setHeading();

        new Setting(this.containerEl)
            .setName("Default connection")
            .setDesc("Connection to use when prompt doesn't specify one")
            .addDropdown((dropdown) => {
                for (const key of Object.keys(this.newSettings.connections)) {
                    dropdown.addOption(key, key);
                }
                dropdown
                    .setValue(this.newSettings.defaultConnection)
                    .onChange((value) => {
                        this.newSettings.defaultConnection = value;
                    });
            });

        this.displayConnectionConfigs(this.containerEl);

        new Setting(this.containerEl)
            .setName("Add new connection")
            .setDesc(
                "Create a new LLM connection (Ollama or OpenAI-compatible)",
            )
            .addButton((button) =>
                button
                    .setButtonText("Add connection")
                    .setCta()
                    .onClick(() => {
                        this.addNewConnection();
                    }),
            );

        new Setting(this.containerEl)
            .setName("Prompts")
            .setHeading()
            .setDesc(
                "Define prompts that can be invoked as commands to generate content using the LLM.",
            );

        this.displayPromptConfigs(this.containerEl);

        new Setting(this.containerEl)
            .setName("Add new prompt")
            .setDesc("Create a new prompt command for generating content.")
            .addButton((button) =>
                button
                    .setButtonText("Add prompt")
                    .setCta()
                    .onClick(() => {
                        this.addNewPrompt();
                    }),
            );

        new Setting(this.containerEl).setName("Link filtering").setHeading();

        new Setting(this.containerEl)
            .setName("Exclude link patterns")
            .setDesc(
                "Skip links that match these regular expression patterns; specify one pattern per line.",
            )
            .addTextArea((text) =>
                text
                    .setPlaceholder("^reflect on\ntodo:\n\\[template\\]")
                    .setValue(this.newSettings.excludePatterns)
                    .onChange((value) => {
                        this.newSettings.excludePatterns = value;
                    }),
            )
            .then((setting) => {
                setting.controlEl
                    .querySelector("textarea")
                    ?.setAttribute("rows", "4");
            });

        new Setting(this.containerEl).setName("Debugging").setHeading();

        new Setting(this.containerEl)
            .setName("Show LLM request payloads")
            .setDesc(
                "When enabled, log the exact prompt and document text sent to Ollama.",
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(this.newSettings.showLlmRequests ?? false)
                    .onChange((value) => {
                        this.newSettings.showLlmRequests = value;
                    }),
            );

        new Setting(this.containerEl)
            .setName("Enable debug logging")
            .setDesc("Writes verbose plugin events to the developer console.")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.newSettings.debugLogging ?? false)
                    .onChange((value) => {
                        this.newSettings.debugLogging = value;
                    }),
            );
    }

    displayConnectionConfigs(containerEl: HTMLElement): void {
        for (const [connKey, connConfig] of Object.entries(
            this.newSettings.connections,
        )) {
            const connSection = containerEl.createEl("div", {
                cls: "setting-item-group prompt-flow prompt-config",
            });

            new Setting(connSection)
                .setName("Connection identifier")
                .setDesc(
                    "Unique identifier for this connection (used in prompt frontmatter)",
                )
                .addText((text) =>
                    text
                        .setValue(connKey)
                        .setPlaceholder("my-connection")
                        .onChange((value) => {
                            const newKey = value.trim();
                            if (newKey && newKey !== connKey) {
                                // Rename the connection key
                                this.newSettings.connections[newKey] =
                                    this.newSettings.connections[connKey];
                                delete this.newSettings.connections[connKey];

                                // Update default connection if needed
                                if (
                                    this.newSettings.defaultConnection ===
                                    connKey
                                ) {
                                    this.newSettings.defaultConnection = newKey;
                                }

                                // Update prompts that reference this connection
                                for (const promptKey of Object.keys(
                                    this.newSettings.prompts,
                                )) {
                                    if (
                                        this.newSettings.prompts[promptKey]
                                            .connection === connKey
                                    ) {
                                        this.newSettings.prompts[
                                            promptKey
                                        ].connection = newKey;
                                    }
                                }

                                this.display();
                            }
                        }),
                );

            new Setting(connSection)
                .setName("Provider type")
                .setDesc("Local Ollama or OpenAI-compatible API")
                .addDropdown((dropdown) =>
                    dropdown
                        .addOption("ollama", "Ollama")
                        .addOption("openai-compatible", "OpenAI-compatible")
                        .setValue(connConfig.provider)
                        .onChange((value) => {
                            this.newSettings.connections[connKey].provider =
                                value as "ollama" | "openai-compatible";
                            this.display();
                        }),
                );

            const urlSettingText = "API endpoint URL";
            const testSetting = new Setting(connSection)
                .setName("Base URL")
                .setDesc(urlSettingText)
                .addText((text) =>
                    text
                        .setPlaceholder("http://localhost:11434")
                        .setValue(connConfig.baseUrl)
                        .onChange((value) => {
                            const trimmed = value.trim();
                            if (trimmed && !trimmed.startsWith("http")) {
                                this.newSettings.connections[connKey].baseUrl =
                                    `http://${trimmed}`;
                            } else {
                                this.newSettings.connections[connKey].baseUrl =
                                    trimmed;
                            }
                        }),
                )
                .addButton((bc) =>
                    bc
                        .setIcon("cable")
                        .setTooltip("Test connection")
                        .onClick(async () => {
                            bc.setDisabled(true);
                            testSetting.setDesc(
                                `${urlSettingText} — Connecting...`,
                            );

                            try {
                                const message = await testConnection(
                                    this.newSettings.connections[connKey],
                                    connKey,
                                );
                                testSetting.setDesc(
                                    `${urlSettingText} — ${message}`,
                                );
                            } catch (error) {
                                const errorMsg = this.plugin.logError(
                                    error,
                                    "Test connection failed",
                                );
                                testSetting.setDesc(
                                    `${urlSettingText} — ❌ Error: ${errorMsg}`,
                                );
                            } finally {
                                bc.setDisabled(false);
                            }
                        }),
                );

            if (connConfig.provider === "openai-compatible") {
                // TODO: Obsidian
                new Setting(connSection)
                    .setName("API key")
                    .setDesc("Authentication key for the API")
                    .addText((text) => {
                        text.inputEl.type = "password";
                        text.setValue(connConfig.apiKey || "").onChange(
                            (value) => {
                                this.newSettings.connections[connKey].apiKey =
                                    value.trim();
                            },
                        );
                    });
            }

            new Setting(connSection)
                .setName("Default model")
                .setDesc("Model name to use by default (optional)")
                .addText((text) =>
                    text
                        .setPlaceholder("llama3.1")
                        .setValue(connConfig.defaultModel || "")
                        .onChange((value) => {
                            this.newSettings.connections[connKey].defaultModel =
                                value.trim();
                        }),
                );

            if (connConfig.provider === "ollama") {
                new Setting(connSection)
                    .setName("Keep alive (Ollama)")
                    .setDesc("How long to keep model in memory")
                    .addText((text) =>
                        text
                            .setPlaceholder("10m")
                            .setValue(connConfig.keepAlive || "")
                            .onChange((value) => {
                                this.newSettings.connections[
                                    connKey
                                ].keepAlive = value.trim();
                            }),
                    );
            }

            const testConnection = async (
                conn: ConnectionConfig,
                connKey: string,
            ): Promise<string> => {
                try {
                    this.plugin.logInfo(
                        "Testing connection:",
                        connKey,
                        conn.provider,
                        conn.baseUrl,
                    );

                    const client = createLLMClient(conn, this.plugin, () =>
                        this.plugin.saveSettings(),
                    );
                    this.plugin.logInfo("Client created successfully");

                    const isConnected = await client.checkConnection();
                    this.plugin.logInfo(
                        "Connection check result:",
                        isConnected,
                    );

                    if (isConnected) {
                        this.plugin.logInfo("Fetching models...");
                        const models = await client.listModels();
                        this.plugin.logInfo("Models fetched:", models);
                        return models.length > 0
                            ? `✅ Connected | Models: ${models.join(", ")}`
                            : "✅ Connected | no models found";
                    } else {
                        return "❌ Cannot connect";
                    }
                } catch (error) {
                    const errorMsg = this.plugin.logError(
                        error,
                        "Connection test failed",
                    );
                    return `❌ ${errorMsg}`;
                }
            };

            if (connKey !== "local-ollama") {
                new Setting(connSection)
                    .setName("Remove connection")
                    .setDesc("Delete this connection")
                    .addButton((button) =>
                        button
                            .setButtonText("Remove")
                            .setWarning()
                            .onClick(() => {
                                this.removeConnection(connKey);
                            }),
                    );
            }
        }
    }

    displayPromptConfigs(containerEl: HTMLElement): void {
        for (const [promptKey, promptConfig] of Object.entries(
            this.newSettings.prompts,
        )) {
            const promptSection = containerEl.createEl("div", {
                cls: "setting-item-group prompt-flow prompt-config",
            });

            new Setting(promptSection)
                .setName("Display label")
                .setDesc("Label shown in commands and notifications")
                .addText((text) =>
                    text
                        .setValue(promptConfig.displayLabel)
                        .onChange((value) => {
                            this.newSettings.prompts[promptKey].displayLabel =
                                value.trim();
                        }),
                );

            new Setting(promptSection)
                .setName("Connection")
                .setDesc(
                    "Which LLM connection to use (leave empty for default)",
                )
                .addDropdown((dropdown) => {
                    dropdown.addOption("", "Use default connection");
                    for (const key of Object.keys(
                        this.newSettings.connections,
                    )) {
                        dropdown.addOption(key, key);
                    }
                    dropdown
                        .setValue(promptConfig.connection || "")
                        .onChange((value) => {
                            if (value === "") {
                                delete this.newSettings.prompts[promptKey]
                                    .connection;
                            } else {
                                this.newSettings.prompts[promptKey].connection =
                                    value;
                            }
                        });
                });

            const checkFile = (inputEl: HTMLElement, filePath: string) => {
                const exists =
                    this.app.vault.getAbstractFileByPath(filePath) !== null;
                if (exists) {
                    inputEl.addClass("fileFound");
                } else {
                    inputEl.removeClass("fileFound");
                }
            };

            new Setting(promptSection)
                .setName("Prompt file")
                .setDesc(
                    "Path to file containing the prompt and invocation parameters; see documentation for details.",
                )
                .addText((text) =>
                    text
                        .setPlaceholder("prompts/my-prompt.md")
                        .setValue(promptConfig.promptFile || "")
                        .onChange((value) => {
                            const path = value.trim();
                            this.newSettings.prompts[promptKey].promptFile =
                                path;
                            checkFile(text.inputEl, path);
                        }),
                );

            if (promptKey !== "reflection") {
                new Setting(promptSection)
                    .setName("Remove prompt")
                    .setDesc("Delete this prompt.")
                    .addButton((button) =>
                        button
                            .setButtonText("Remove")
                            .setWarning()
                            .onClick(() => {
                                this.removePrompt(promptKey);
                            }),
                    );
            }
        }
    }

    private generateConnectionKey(): string {
        return `connection-${Date.now()}`;
    }

    addNewConnection(): void {
        const connKey = this.generateConnectionKey();
        const newConnection: ConnectionConfig = {
            provider: "ollama",
            baseUrl: "http://localhost:11434",
        };

        this.newSettings.connections[connKey] = newConnection;
        this.display();
    }

    removeConnection(connKey: string): void {
        // Don't allow removing if it's the default
        if (this.newSettings.defaultConnection === connKey) {
            // Switch to first available connection
            const remaining = Object.keys(this.newSettings.connections).filter(
                (k) => k !== connKey,
            );
            if (remaining.length > 0) {
                this.newSettings.defaultConnection = remaining[0];
            }
        }

        // Remove any prompt references to this connection
        for (const promptKey of Object.keys(this.newSettings.prompts)) {
            if (this.newSettings.prompts[promptKey].connection === connKey) {
                delete this.newSettings.prompts[promptKey].connection;
            }
        }

        delete this.newSettings.connections[connKey];
        this.display();
    }

    private generatePromptKey(): string {
        return `custom-${Date.now()}`;
    }

    addNewPrompt(): void {
        const promptKey = this.generatePromptKey();
        const newPrompt: PromptConfig = {
            displayLabel: "Custom Prompt",
        };

        this.newSettings.prompts[promptKey] = newPrompt;
        this.display(); // Refresh the settings view
    }

    removePrompt(promptKey: string): void {
        delete this.newSettings.prompts[promptKey];
        this.display(); // Refresh the settings view
    }

    /** Save on exit */
    hide(): void {
        void this.save();
    }
}
