export function zoteroLibraryPrefix(
    isGroup: boolean,
    libraryID: number,
): string {
    return isGroup ? `groups/${libraryID}` : "library";
}

export function zoteroSelectItemUri(prefix: string, itemKey: string): string {
    return `zotero://select/${prefix}/items/${itemKey}`;
}
