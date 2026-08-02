import type { IParentProxy } from "bridge/types";
import type { ZotFlowSettings } from "settings/types";
import { ZotFlowError, ZotFlowErrorCode } from "utils/error";

/** WebDAV file download service for fetching Zotero attachments from a user-configured server. */
export class WebDavService {
    private static normalizeBaseUrl(url: string): string {
        const trimmed = url.trim();
        return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
    }

    private static buildBaseUrlCandidates(url: string): string[] {
        const normalized = WebDavService.normalizeBaseUrl(url);
        const candidates = [normalized];
        if (!normalized.toLowerCase().endsWith("/zotero/")) {
            candidates.push(`${normalized}zotero/`);
        }
        return [...new Set(candidates)];
    }

    constructor(
        private settings: ZotFlowSettings,
        private parentHost: IParentProxy,
    ) {}

    updateSettings(settings: ZotFlowSettings) {
        this.settings = settings;
    }

    /**
     * Download a file from WebDAV.
     * @param remotePath Relative path to the file on the WebDAV server.
     * @returns The file content as an ArrayBuffer.
     */
    async downloadFile(remotePath: string): Promise<ArrayBuffer> {
        if (
            !this.settings.webDavUrl ||
            !this.settings.webDavUser ||
            !this.settings.webdavpassword
        ) {
            throw new ZotFlowError(
                ZotFlowErrorCode.CONFIG_MISSING,
                "WebDavService",
                "WebDAV credentials not configured",
            );
        }

        // Make sure the webdav url ends with a slash (Business logic preserved)
        const baseUrl = WebDavService.normalizeBaseUrl(
            this.settings.webDavUrl,
        );
        const fullUrl = baseUrl + remotePath.replace(/^\//, ""); // Ensure single slash join

        const credentials = btoa(
            `${this.settings.webDavUser}:${this.settings.webdavpassword}`,
        );

        try {
            const req = {
                method: "GET",
                headers: {
                    Authorization: `Basic ${credentials}`,
                },
            };

            const response = await fetch(fullUrl, req);

            if (response.ok) {
                return await response.arrayBuffer();
            } else {
                // Map HTTP status to ZotFlowError
                if (response.status === 401 || response.status === 403) {
                    throw new ZotFlowError(
                        ZotFlowErrorCode.AUTH_INVALID,
                        "WebDavService",
                        `WebDAV Auth Failed: ${response.status}`,
                    );
                }
                if (response.status === 404) {
                    throw new ZotFlowError(
                        ZotFlowErrorCode.RESOURCE_MISSING,
                        "WebDavService",
                        `WebDAV File Not Found: ${fullUrl}`,
                    );
                }

                throw new ZotFlowError(
                    ZotFlowErrorCode.NETWORK_ERROR,
                    "WebDavService",
                    `WebDAV download failed with status: ${response.status}`,
                );
            }
        } catch (e: any) {
            throw ZotFlowError.wrap(
                e,
                ZotFlowErrorCode.NETWORK_ERROR,
                "WebDavService",
                "WebDAV download failed",
            );
        }
    }

    async getContentLength(remotePath: string): Promise<number | null> {
        if (
            !this.settings.webDavUrl ||
            !this.settings.webDavUser ||
            !this.settings.webdavpassword
        ) {
            throw new ZotFlowError(
                ZotFlowErrorCode.CONFIG_MISSING,
                "WebDavService",
                "WebDAV credentials not configured",
            );
        }

        const baseUrl = WebDavService.normalizeBaseUrl(
            this.settings.webDavUrl,
        );
        const fullUrl = baseUrl + remotePath.replace(/^\//, "");
        const credentials = btoa(
            `${this.settings.webDavUser}:${this.settings.webdavpassword}`,
        );

        try {
            const response = await fetch(fullUrl, {
                method: "HEAD",
                headers: {
                    Authorization: `Basic ${credentials}`,
                },
            });

            if (!response.ok) {
                throw new ZotFlowError(
                    ZotFlowErrorCode.NETWORK_ERROR,
                    "WebDavService",
                    `WebDAV HEAD failed with status: ${response.status}`,
                );
            }

            const raw = response.headers.get("content-length");
            const bytes = raw ? Number.parseInt(raw, 10) : NaN;
            return Number.isFinite(bytes) ? bytes : null;
        } catch (e: any) {
            throw ZotFlowError.wrap(
                e,
                ZotFlowErrorCode.NETWORK_ERROR,
                "WebDavService",
                "WebDAV HEAD request failed",
            );
        }
    }

    private async verifyCandidate(
        baseUrl: string,
        credentials: string,
    ): Promise<void> {
        const response = await fetch(baseUrl, {
            method: "PROPFIND",
            headers: {
                Authorization: `Basic ${credentials}`,
                Depth: "0",
                "Content-Type": "text/xml; charset=utf-8",
            },
            body: `<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><resourcetype/><getcontentlength/></prop></propfind>`,
        });

        if ([200, 201, 204, 207].includes(response.status)) {
            return;
        }

        if (response.status === 401 || response.status === 403) {
            throw new ZotFlowError(
                ZotFlowErrorCode.AUTH_INVALID,
                "WebDavService",
                "WebDAV Verification 401/403",
            );
        }

        if (response.status === 404) {
            throw new ZotFlowError(
                ZotFlowErrorCode.RESOURCE_MISSING,
                "WebDavService",
                "WebDAV Verification 404",
            );
        }

        if (response.status === 405 || response.status === 501) {
            const headResponse = await fetch(baseUrl, {
                method: "HEAD",
                headers: {
                    Authorization: `Basic ${credentials}`,
                },
            });
            if (headResponse.status >= 200 && headResponse.status < 300) {
                return;
            }
        }

        throw new ZotFlowError(
            ZotFlowErrorCode.NETWORK_ERROR,
            "WebDavService",
            `WebDAV verification failed with status: ${response.status}`,
        );
    }

    async verify(url: string, user: string, pass: string): Promise<string> {
        if (!url || !user || !pass) {
            throw new ZotFlowError(
                ZotFlowErrorCode.CONFIG_MISSING,
                "WebDavService",
                "Missing WebDAV credentials for verification",
            );
        }

        // basic auth
        const credentials = btoa(`${user}:${pass}`);
        const candidates = WebDavService.buildBaseUrlCandidates(url);
        let authError: ZotFlowError | null = null;
        let notFoundError: ZotFlowError | null = null;
        let lastError: unknown = null;

        try {
            for (const baseUrl of candidates) {
                try {
                    await this.verifyCandidate(baseUrl, credentials);
                    return baseUrl;
                } catch (error) {
                    lastError = error;
                    if (error instanceof ZotFlowError) {
                        if (
                            error.code === ZotFlowErrorCode.AUTH_INVALID &&
                            !authError
                        ) {
                            authError = error;
                        } else if (
                            error.code === ZotFlowErrorCode.RESOURCE_MISSING &&
                            !notFoundError
                        ) {
                            notFoundError = error;
                        }
                    }
                }
            }

            throw authError ?? notFoundError ?? lastError;
        } catch (e: any) {
            throw ZotFlowError.wrap(
                e,
                ZotFlowErrorCode.NETWORK_ERROR,
                "WebDavService",
                "WebDAV Verification Network Error",
            );
        }
    }
}
