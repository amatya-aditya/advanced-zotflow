import { SuggestModal } from "obsidian";
import type { App, TFile } from "obsidian";

const SUPPORTED_EXTENSIONS = new Set(["pdf", "epub", "html"]);

/** File picker modal that filters vault files by supported reader extensions. */
export class FilePickerModal extends SuggestModal<TFile> {
    private onPick: (file: TFile) => void;

    constructor(app: App, onPick: (file: TFile) => void) {
        super(app);
        this.onPick = onPick;
        this.setPlaceholder("Pick a local file (PDF, EPUB, HTML)...");
        this.modalEl.addClass("zotflow-search-modal");
        this.limit = 20;
    }

    getSuggestions(query: string): TFile[] {
        const files = this.app.vault
            .getFiles()
            .filter((f) => SUPPORTED_EXTENSIONS.has(f.extension));

        if (!query) return files.slice(0, this.limit);

        const lower = query.toLowerCase();
        return files
            .filter((f) => f.path.toLowerCase().includes(lower))
            .slice(0, this.limit);
    }

    renderSuggestion(file: TFile, el: HTMLElement) {
        el.createDiv({ cls: "zotflow-title", text: file.basename });
        el.createDiv({ cls: "zotflow-meta", text: file.path });
    }

    onChooseSuggestion(file: TFile): void {
        this.onPick(file);
    }
}
