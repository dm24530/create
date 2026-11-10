export type ReferenceImage = {
    id: string;
    name: string;
    type: string;
    dataUrl: string;
    url?: string;
    storageKey?: string;
    sourceObjectKey?: string;
    width?: number;
    height?: number;
    bytes?: number;
    requestDataUrlPrepared?: boolean;
};
