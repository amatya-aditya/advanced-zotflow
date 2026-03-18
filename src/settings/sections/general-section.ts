import { Setting, SettingGroup } from "obsidian";
import ZotFlow from "main";
import type { ReaderColorScheme } from "settings/types";
import { services } from "services/services";

/** Settings section rendering source note paths, folders, and local reader options. */
export class GeneralSection {
    plugin: ZotFlow;
    refreshUI: () => void;

    constructor(plugin: ZotFlow, refreshUI: () => void) {
        this.plugin = plugin;
        this.refreshUI = refreshUI;
    }

    render(containerEl: HTMLElement) {
        const zoteroSourceNote = new SettingGroup(containerEl);
        zoteroSourceNote.setHeading("Library Source Note");

        zoteroSourceNote.addSetting((setting) => {
            setting
                .setName("Template Path")
                .setDesc(
                    "Path to template file for library source notes (relative to vault root).",
                )
                .addText((text) => {
                    text.setPlaceholder("e.g. templates/SourceNoteTemplate.md")
                        .setValue(
                            this.plugin.settings.librarySourceNoteTemplatePath,
                        )
                        .onChange(async (value) => {
                            this.plugin.settings.librarySourceNoteTemplatePath =
                                value;
                            await this.plugin.saveSettings();
                        });
                    text.inputEl.size = 40;
                });
        });

        zoteroSourceNote.addSetting((setting) => {
            setting
                .setName("Library Source Note Path Template")
                .setDesc(
                    "LiquidJS template for library source note file path (without .md extension).",
                )
                .addText((text) => {
                    text.setPlaceholder(
                        "e.g. References/{{libraryName}}/@{{citationKey | default: key}}",
                    )
                        .setValue(
                            this.plugin.settings.librarySourceNotePathTemplate,
                        )
                        .onChange(async (value) => {
                            this.plugin.settings.librarySourceNotePathTemplate =
                                value;
                            await this.plugin.saveSettings();
                        });
                    text.inputEl.size = 40;
                });
        });

        const localSourceNote = new SettingGroup(containerEl);
        localSourceNote.setHeading("Local Source Note");

        localSourceNote.addSetting((setting) => {
            setting
                .setName("Source Note Template Path")
                .setDesc(
                    "Path to template file for local source notes (relative to vault root).",
                )
                .addText((text) => {
                    text.setPlaceholder(
                        "e.g. templates/LocalSourceNoteTemplate.md",
                    )
                        .setValue(
                            this.plugin.settings.localSourceNoteTemplatePath,
                        )
                        .onChange(async (value) => {
                            this.plugin.settings.localSourceNoteTemplatePath =
                                value;
                            await this.plugin.saveSettings();
                        });
                    text.inputEl.size = 40;
                });
        });

        localSourceNote.addSetting((setting) => {
            setting
                .setName("Local Source Note Path Template")
                .setDesc(
                    "LiquidJS template for local source note file path (without .md extension).",
                )
                .addText((text) => {
                    text.setPlaceholder("e.g. Local/@{{basename}}")
                        .setValue(
                            this.plugin.settings.localSourceNotePathTemplate,
                        )
                        .onChange(async (value) => {
                            this.plugin.settings.localSourceNotePathTemplate =
                                value;
                            await this.plugin.saveSettings();
                        });
                    text.inputEl.size = 40;
                });
        });

        const generalSettingGroup = new SettingGroup(containerEl);
        generalSettingGroup.setHeading("General Settings");

        generalSettingGroup.addSetting((setting) => {
            setting
                .setName("Auto Import Annotation Images")
                .setDesc(
                    "Auto import annotation images for area and ink annotations from PDF when creating source notes.",
                )
                .addToggle((toggle) => {
                    toggle.setValue(
                        this.plugin.settings.autoImportAnnotationImages,
                    );
                    toggle.onChange(async (value) => {
                        this.plugin.settings.autoImportAnnotationImages = value;
                        await this.plugin.saveSettings();
                    });
                });
        });

        generalSettingGroup.addSetting((setting) => {
            setting
                .setName("Annotation Image Folder")
                .setDesc(
                    "Default folder for annotation images (relative to vault root).",
                )
                .addText((text) => {
                    text.setPlaceholder("e.g. Attachments/ZotFlow")
                        .setValue(this.plugin.settings.annotationImageFolder)
                        .onChange(async (value) => {
                            this.plugin.settings.annotationImageFolder = value;
                            await this.plugin.saveSettings();
                        });
                    text.inputEl.size = 40;
                });
        });

        const zoteroReaderSettingGroup = new SettingGroup(containerEl);
        zoteroReaderSettingGroup.setHeading("Zotero Reader");

        zoteroReaderSettingGroup.addSetting((setting) => {
            setting
                .setName("Overwrite PDF/EPUB/HTML Viewer")
                .setDesc(
                    "Overwrite PDF/EPUB/HTML viewer with local Zotero reader (Requires Restart).",
                )
                .addToggle((toggle) => {
                    toggle.setValue(this.plugin.settings.overwriteViewer);
                    toggle.onChange(async (value) => {
                        this.plugin.settings.overwriteViewer = value;
                        await this.plugin.saveSettings();
                    });
                });
        });

        zoteroReaderSettingGroup.addSetting((setting) => {
            setting
                .setName("Reader UI Color Scheme")
                .setDesc("Color scheme for the Zotero Reader UI.")
                .addDropdown((dropdown) => {
                    dropdown
                        .addOption("light", "Light")
                        .addOption("dark", "Dark")
                        .addOption("obsidian", "Adapt to Obsidian Scheme")
                        .addOption(
                            "obsidian-theme",
                            "Adapt to Obsidian Scheme (Theme)",
                        )
                        .setValue(this.plugin.settings.readerColorScheme)
                        .onChange(async (value) => {
                            this.plugin.settings.readerColorScheme =
                                value as ReaderColorScheme;
                            await this.plugin.saveSettings();
                        });
                });
        });

        zoteroReaderSettingGroup.addSetting((setting) => {
            setting
                .setName("Default Viewer Light Theme")
                .setDesc(
                    "Default viewer theme when the reader is in light mode.",
                )
                .addDropdown((dropdown) => {
                    dropdown.addOption("original_fallback", "Original");
                    dropdown.addOption("dark", "Dark");
                    dropdown.addOption("snow", "Snow");
                    dropdown.addOption("sepia", "Sepia");
                    for (const t of services.viewStateService.getCustomThemes()) {
                        dropdown.addOption(t.id, t.label);
                    }
                    dropdown
                        .setValue(this.plugin.settings.defaultLightTheme)
                        .onChange(async (value) => {
                            this.plugin.settings.defaultLightTheme = value;
                            await this.plugin.saveSettings();
                        });
                });
        });

        zoteroReaderSettingGroup.addSetting((setting) => {
            setting
                .setName("Default Viewer Dark Theme")
                .setDesc(
                    "Default viewer theme when the reader is in dark mode.",
                )
                .addDropdown((dropdown) => {
                    dropdown.addOption("original_fallback", "Original");
                    dropdown.addOption("dark", "Dark");
                    dropdown.addOption("snow", "Snow");
                    dropdown.addOption("sepia", "Sepia");
                    dropdown.addOption("obsidian", "Obsidian");
                    for (const t of services.viewStateService.getCustomThemes()) {
                        dropdown.addOption(t.id, t.label);
                    }
                    dropdown
                        .setValue(this.plugin.settings.defaultDarkTheme)
                        .onChange(async (value) => {
                            this.plugin.settings.defaultDarkTheme = value;
                            await this.plugin.saveSettings();
                        });
                });
        });
    }
}
