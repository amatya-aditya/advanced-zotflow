import { App } from "obsidian";

import type {
    ZotFlowSettings,
    BookmarkedItem,
    RecentItem,
} from "settings/types";
import { IndexService } from "./index-service";
import { LogService } from "./log-service";
import { NotificationService } from "./notification-service";
import { TaskMonitor } from "./task-monitor";
import { ZotFlowError, ZotFlowErrorCode } from "utils/error";

class ServiceLocator {
    private _app: App;
    private _settings: ZotFlowSettings;
    private _initialized = false;

    private _indexService: IndexService;
    private _logService: LogService;
    private _notificationService: NotificationService;
    private _taskMonitor: TaskMonitor;

    private _saveSettingsCallback: (() => Promise<void>) | null = null;
    private _onBookmarksChanged: Set<() => void> = new Set();
    private _onRecentsChanged: Set<() => void> = new Set();

    initialize(app: App, settings: ZotFlowSettings) {
        this._app = app;
        this._settings = settings;

        this._logService = new LogService();
        this._notificationService = new NotificationService();

        this._indexService = new IndexService(app, this._logService);
        this._indexService.load();

        this._taskMonitor = new TaskMonitor(app);

        this._initialized = true;
        this._logService.info("Services initialized.", "LocalServiceLocator");
    }

    private assertInitialized(): void {
        if (!this._initialized) {
            throw new ZotFlowError(
                ZotFlowErrorCode.RESOURCE_MISSING,
                "LocalServiceLocator",
                "ServiceLocator not initialized. Call initialize() first.",
            );
        }
    }

    setSaveSettingsCallback(cb: () => Promise<void>) {
        this._saveSettingsCallback = cb;
    }

    updateSettings(newSettings: ZotFlowSettings) {
        this._settings = newSettings;
    }

    // --- Bookmark Management ---

    onBookmarksChanged(cb: () => void): () => void {
        this._onBookmarksChanged.add(cb);
        return () => this._onBookmarksChanged.delete(cb);
    }

    onRecentsChanged(cb: () => void): () => void {
        this._onRecentsChanged.add(cb);
        return () => this._onRecentsChanged.delete(cb);
    }

    isBookmarked(libraryID: number, key: string): boolean {
        const id = `${libraryID}:${key}`;
        return this._settings.bookmarkedItems.some((b) => b.id === id);
    }

    async toggleBookmark(item: {
        libraryID: number;
        key: string;
        name: string;
        itemType: string;
        contentType?: string;
    }): Promise<boolean> {
        const id = `${item.libraryID}:${item.key}`;
        const idx = this._settings.bookmarkedItems.findIndex(
            (b) => b.id === id,
        );
        if (idx >= 0) {
            this._settings.bookmarkedItems.splice(idx, 1);
            await this._saveSettingsCallback?.();
            this._onBookmarksChanged.forEach((cb) => cb());
            return false; // removed
        } else {
            this._settings.bookmarkedItems.push({
                id,
                libraryID: item.libraryID,
                key: item.key,
                name: item.name,
                itemType: item.itemType,
                contentType: item.contentType,
                addedAt: Date.now(),
            });
            await this._saveSettingsCallback?.();
            this._onBookmarksChanged.forEach((cb) => cb());
            return true; // added
        }
    }

    getBookmarkedItems(): BookmarkedItem[] {
        return [...this._settings.bookmarkedItems];
    }

    // --- Recent Items Management ---

    async addRecentItem(item: {
        libraryID: number;
        key: string;
        name: string;
        itemType: string;
        contentType?: string;
    }): Promise<void> {
        const id = `${item.libraryID}:${item.key}`;
        // Remove if already in list
        this._settings.recentItems = this._settings.recentItems.filter(
            (r) => r.id !== id,
        );
        // Add to front
        this._settings.recentItems.unshift({
            id,
            libraryID: item.libraryID,
            key: item.key,
            name: item.name,
            itemType: item.itemType,
            contentType: item.contentType,
            openedAt: Date.now(),
        });
        // Trim to max
        const max = this._settings.maxRecentItems || 10;
        if (this._settings.recentItems.length > max) {
            this._settings.recentItems = this._settings.recentItems.slice(
                0,
                max,
            );
        }
        await this._saveSettingsCallback?.();
        this._onRecentsChanged.forEach((cb) => cb());
    }

    getRecentItems(): RecentItem[] {
        return [...this._settings.recentItems];
    }

    get app() {
        this.assertInitialized();
        return this._app;
    }

    get settings() {
        this.assertInitialized();
        return this._settings;
    }

    get indexService() {
        this.assertInitialized();
        return this._indexService;
    }

    get logService() {
        this.assertInitialized();
        return this._logService;
    }

    get notificationService() {
        this.assertInitialized();
        return this._notificationService;
    }

    get taskMonitor() {
        this.assertInitialized();
        return this._taskMonitor;
    }
}

// Export singleton
export const services = new ServiceLocator();
