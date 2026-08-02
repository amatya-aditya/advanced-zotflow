import { Setting, setIcon, SettingGroup } from "obsidian";
import { workerBridge } from "bridge";
import { services } from "services/services";
import { ZotFlowError } from "utils/error";

import type ZotFlow from "main";

/** Settings section for WebDAV server URL, credentials, and connection verification. */
export class WebDavSection {
    constructor(
        private plugin: ZotFlow,
        private refreshUI: () => void,
    ) {}

    render(containerEl: HTMLElement) {
        const settingGroup = new SettingGroup(containerEl);
        settingGroup.setHeading("WebDAV Configuration");

        // Toggle
        settingGroup.addSetting((setting) => {
            setting
                .setName("Enable WebDAV Sync")
                .setDesc(
                    "Sync personal-library attachment files via a WebDAV server instead of Zotero Storage. Group-library attachments always use Zotero Storage.",
                )
                .addToggle((toggle) =>
                    toggle
                        .setValue(this.plugin.settings.useWebDav)
                        .onChange(async (value) => {
                            this.plugin.settings.useWebDav = value;
                            if (!value) {
                                this.plugin.settings.webDavUrl = "";
                                this.plugin.settings.webDavUser = "";
                                this.plugin.settings.webdavpassword = "";
                                this.plugin.settings.webDavVerified = false;
                            }
                            await this.plugin.saveSettings();
                            this.refreshUI();
                        }),
                );
        });

        if (!this.plugin.settings.useWebDav) return;

        const isVerified = !!this.plugin.settings.webDavVerified;
        const hasSavedCredentials =
            !!this.plugin.settings.webDavUrl ||
            !!this.plugin.settings.webDavUser ||
            !!this.plugin.settings.webdavpassword;
        let tempUrl = this.plugin.settings.webDavUrl || "";
        let tempUser = this.plugin.settings.webDavUser || "";
        let tempPassword = this.plugin.settings.webdavpassword || "";

        settingGroup.addSetting((setting) => {
            setting
                .setName("Server URL")
                .setDesc(
                    "Enter the same base WebDAV URL you use in Zotero. `/zotero` is added automatically if needed.",
                )
                .addText((text) => {
                    text.setPlaceholder("https://...")
                        .setValue(tempUrl)
                        .onChange((v) => (tempUrl = v.trim()));
                    text.inputEl.style.width = "100%";
                    if (isVerified) text.setDisabled(true);
                });
        });

        settingGroup.addSetting((setting) => {
            setting.setName("Username").addText((text) => {
                text.setPlaceholder("username")
                    .setValue(tempUser)
                    .onChange((v) => (tempUser = v.trim()));
                if (isVerified) text.setDisabled(true);
            });
        });

        settingGroup.addSetting((setting) => {
            setting.setName("Password").addText((text) => {
                text.setPlaceholder("password")
                    .setValue(tempPassword)
                    .onChange((v) => (tempPassword = v.trim()));
                text.inputEl.type = "password";
                if (isVerified) text.setDisabled(true);
            });

            const btnContainer = setting.settingEl.parentElement!.createDiv({
                cls: "zotflow-settings-btn-container",
            });

            if (hasSavedCredentials) {
                new Setting(btnContainer).addButton((button) =>
                    button
                        .setButtonText("Disconnect")
                        .setIcon("unlink")
                        .setWarning()
                        .onClick(async () => {
                            this.plugin.settings.webDavUrl = "";
                            this.plugin.settings.webDavUser = "";
                            this.plugin.settings.webdavpassword = "";
                            this.plugin.settings.webDavVerified = false;
                            await this.plugin.saveSettings();
                            services.notificationService.notify(
                                "info",
                                "WebDAV disconnected.",
                            );
                            this.refreshUI();
                        }),
                );
            }

            if (!isVerified) {
                new Setting(btnContainer).addButton((button) =>
                    button
                        .setButtonText(
                            hasSavedCredentials
                                ? "Re-verify & Save"
                                : "Verify & Connect",
                        )
                        .setCta()
                        .onClick(async () => {
                            if (!tempUrl || !tempUser || !tempPassword) {
                                services.notificationService.notify(
                                    "warning",
                                    "Please fill in all fields.",
                                );
                                return;
                            }
                            button
                                .setButtonText("Verifying...")
                                .setDisabled(true);

                            try {
                                const verifiedUrl = await workerBridge.webdav.verify(
                                    tempUrl,
                                    tempUser,
                                    tempPassword,
                                );
                                services.notificationService.notify(
                                    "success",
                                    "WebDAV Connected!",
                                );

                                this.plugin.settings.webDavUrl = verifiedUrl;
                                this.plugin.settings.webDavUser = tempUser;
                                this.plugin.settings.webdavpassword =
                                    tempPassword;
                                this.plugin.settings.webDavVerified = true;

                                await this.plugin.saveSettings();

                                this.refreshUI();
                            } catch (error: any) {
                                services.logService.error(
                                    "WebDAV verification failed",
                                    "Settings",
                                    error,
                                );

                                this.plugin.settings.webDavUrl =
                                    tempUrl.trim();
                                this.plugin.settings.webDavUser =
                                    tempUser.trim();
                                this.plugin.settings.webdavpassword =
                                    tempPassword;
                                this.plugin.settings.webDavVerified = false;
                                await this.plugin.saveSettings();

                                const savedAnyway =
                                    error instanceof ZotFlowError &&
                                    (error.message.includes("401/403") ||
                                        error.message.includes("405") ||
                                        error.message.includes("PROPFIND"));
                                services.notificationService.notify(
                                    savedAnyway ? "warning" : "error",
                                    savedAnyway
                                        ? `Verification failed (${error.message}). Credentials were saved, but ZotFlow will not use WebDAV until verification succeeds.`
                                        : `Connection failed: ${error.message}`,
                                );
                                this.refreshUI();
                            }
                        }),
                );
            }
        });

        if (hasSavedCredentials && !isVerified) {
            const hint = containerEl.createDiv({
                cls: "setting-item-description",
            });
            hint.setText(
                "Credentials are saved but the server has not been verified yet. ZotFlow will not use WebDAV until verification succeeds.",
            );
        }
    }
}
