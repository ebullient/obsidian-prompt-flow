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

    async reset() {
        this.newSettings = this.cloneSettings();
        this.display();
    }

    display(): void {
        if (!this.newSettings) {
            this.newSettings = this.cloneSettings();
        }

        this.containerEl.empty();

        new Setting(this.containerEl).setDesc(
            "Configure your local Ollama instance for AI-powered journal reflections.",
        );

        new Setting(this.containerEl)
            .setName("Save settings")
            .setClass("pflow-reflect-save-reset")
            .addButton((button) =>
                button
                    .setIcon("reset")
                    .setTooltip("Reset to previously saved values")
                    .onClick(async () => {
                        await this.reset();
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

        new Setting(this.containerEl)
            .setName("Ollama")
            .setHeading()
            .setDesc(
                "Configure your local Ollama instance for AI-powered journal reflections.",
            );

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
            .setDesc(
                "URL of your Ollama instance (default: http://localhost:11434)",
            )
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
                "How long to keep model loaded in memory (e.g., '10m', '1h', '-1' for always). Speeds up subsequent requests.",
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
                "For each configured prompt, a command is automatically created: generate [prompt name]. When the command is run, it will send the prompt associated with the command, the current note, and (optionally) the contents of linked notes to the LLM. Generated content is inserted as blockquotes (>) at the current cursor position in the current note.",
            );

        this.displayPromptConfigs(this.containerEl);

        new Setting(this.containerEl)
            .setName("Add new prompt")
            .setDesc("Add a new prompt configuration")
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
                "Skip links that match these patterns (regex, one pattern per line). Links will be matched in markdown format, e.g. [display text](link target).",
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
                "When enabled, logs the exact prompt and document text sent to Ollama. Turn off to keep journal content out of the console.",
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
            .setDesc(
                "Writes verbose plugin events to the developer console. Useful when troubleshooting prompt resolution issues.",
            )
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

            const checkFile = async (
                inputEl: HTMLElement,
                filePath: string,
            ) => {
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
                    "Path to file containing prompt (leave empty to use inline prompt)",
                )
                .addText((text) =>
                    text
                        .setPlaceholder("prompts/my-prompt.md")
                        .setValue(promptConfig.promptFile || "")
                        .onChange(async (value) => {
                            const path = value.trim();
                            this.newSettings.prompts[promptKey].promptFile =
                                path;
                            await checkFile(text.inputEl, path);
                        }),
                );

            if (promptKey !== "reflection") {
                new Setting(promptSection)
                    .setName("Remove prompt")
                    .setDesc("Delete this prompt configuration")
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
