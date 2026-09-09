import { ReaderSection } from "settings/sections/reader-section";
import { SourceNotesSection } from "settings/sections/source-notes-section";

import type ZotFlow from "main";
import type { SettingDefinitionItem } from "obsidian";
import type { SettingKey } from "settings/types";

/** Declarative entry point for source-note and reader settings. */
export class GeneralSection {
    constructor(private readonly plugin: ZotFlow) {}

    getDefinitions(): SettingDefinitionItem<SettingKey>[] {
        return [
            {
                type: "page",
                name: "Tree View",
                desc: "Sidebar icons and navigation.",
                items: [
                    { name: "Show item icons", desc: "Show icons beside library, collection, PDF, and note names.", control: { type: "toggle", key: "showTreeItemIcons" } },
                    { name: "Show Library icon", control: { type: "toggle", key: "showTreeLibrary" } },
                    { name: "Show Recent Items icon", control: { type: "toggle", key: "showTreeRecents" } },
                    { name: "Show Bookmarks icon", control: { type: "toggle", key: "showTreeBookmarks" } },
                    { name: "Show Source Notes icon", control: { type: "toggle", key: "showTreeNotes" } },
                    { name: "Show Base Views icon", control: { type: "toggle", key: "showTreeBases" } },
                    { name: "Base View Folder", control: { type: "text", key: "baseViewFolder", placeholder: "ZotFlow/Bases" } },
                ],
            },
            {
                type: "page",
                name: "Source Notes",
                desc: "Templates, paths, editable regions, and annotation assets for library and local source notes.",
                items: new SourceNotesSection().getDefinitions(),
            },
            {
                type: "page",
                name: "Reader",
                desc: "Reader integration, annotation tools, fonts, and color themes.",
                items: new ReaderSection(this.plugin).getDefinitions(),
            },
        ];
    }
}
