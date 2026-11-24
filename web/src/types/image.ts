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
    /** Video-workbench usage chosen when the image was added. */
    videoRole?: "reference" | "first_frame" | "last_frame" | "keyframe";
};
