import { type App, PluginSettingTab, Setting } from "obsidian";
import type { PromptConfig, PromptFlowSettings } from "./@types";
import { OllamaClient } from "./pflow-OllamaClient";
import type { PromptFlowPlugin } from "./pflow-Plugin";

export class PromptFlowSettingsTab extends PluginSettingTab {
    plugin: PromptFlowPlugin;
    newSettings!: PromptFlowSettings;

    constructor(app: App, plugin: PromptFlowPlugin) {
        super(app, plugin);
        this.plugin = plugin;
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

        const testConnection = async (): Promise<string> => {
            try {
                // Create temporary client with current form settings
                const tempClient = new OllamaClient(
                    this.newSettings.ollamaUrl,
                    this.plugin,
                );
                const isConnected = await tempClient.checkConnection();

                if (isConnected) {
                    const models = await tempClient.listModels();
                    return models.length > 0
                        ? `✅ Connected to Ollama | Available models: ${models.join(", ")}`
                        : "✅ Connected to Ollama | no models found";
                } else {
                    return "❌ Cannot connect to Ollama";
                }
            } catch (error) {
                const errorMsg = this.plugin.logError(
                    error,
                    "❌ Cannot connect to Ollama",
                );
                return `❌ Cannot connect to Ollama: ${errorMsg}`;
            }
        };

        const connection = new Setting(this.containerEl)
            .setName("Ollama URL")
            .setDesc("URL of your Ollama instance")
            .addText((text) =>
                text
                    .setPlaceholder("http://localhost:11434")
                    .setValue(this.newSettings.ollamaUrl)
                    .onChange((value) => {
                        const trimmed = value.trim();
                        if (trimmed && !trimmed.startsWith("http")) {
                            // Auto-prepend http:// if user forgets protocol
                            this.newSettings.ollamaUrl = `http://${trimmed}`;
                        } else {
                            this.newSettings.ollamaUrl = trimmed;
                        }
                    }),
            )
            .addButton((bc) =>
                bc
                    .setTooltip("Test connection")
                    .setIcon("cable")
                    .onClick(async (_e) => {
                        bc.setTooltip("Testing...");
                        bc.setDisabled(true);

                        const message = await testConnection();
                        connection.setDesc(
                            `${this.newSettings.ollamaUrl} - ${message}`,
                        );

                        bc.setTooltip("Test connection");
                        bc.setDisabled(false);
                    }),
            );

        new Setting(this.containerEl)
            .setName("Model name")
            .setDesc(
                "Name of the default Ollama model to use (e.g., llama3.1, mistral)",
            )
            .addText((text) =>
                text
                    .setPlaceholder("llama3.1")
                    .setValue(this.newSettings.modelName)
                    .onChange((value) => {
                        this.newSettings.modelName = value.trim();
                    }),
            );

        new Setting(this.containerEl)
            .setName("Keep alive")
            .setDesc(
                "How long to keep model loaded in memory (e.g., '10m', '1h', '-1' for always) to speed up subsequent requests.",
            )
            .addText((text) =>
                text
                    .setPlaceholder("10m")
                    .setValue(this.newSettings.keepAlive)
                    .onChange((value) => {
                        this.newSettings.keepAlive = value.trim();
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

    displayPromptConfigs(containerEl: HTMLElement): void {
        for (const [promptKey, promptConfig] of Object.entries(
            this.newSettings.prompts,
        )) {
            const promptSection = containerEl.createEl("div", {
                cls: "setting-item-group pflow-reflect-prompt-config",
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
