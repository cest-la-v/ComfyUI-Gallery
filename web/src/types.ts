export interface FileInfo {
    filename: string;
    resolution: string;
    date: string;
    size: string;
}

export interface Metadata {
    fileinfo: FileInfo;
    prompt?: any;
    workflow?: any;
    parameters?: string;
}

export interface FileDetails {
    name: string;
    url: string;
    timestamp: number;
    date: string;
    type: "image" | "media" | "audio" | "divider" | "empty-space";
    width?: number;
    height?: number;
}

export interface ImageParams {
    model?: string;
    model_hash?: string;
    positive_prompt?: string;
    negative_prompt?: string;
    sampler?: string;
    scheduler?: string;
    steps?: number;
    cfg_scale?: number;
    seed?: number;
    source?: 'a1111' | 'comfyui' | null;
    prompt_fingerprint?: string;
}

export interface FolderContent {
    [filename: string]: FileDetails;
}

export interface Folders {
    [folderName: string]: FolderContent;
}

export interface FilesTree {
    folders: Folders;
}

export interface ModelGroup {
    model: string;
    count: number;
    /** Up to 4 rel_paths for thumbnail strip */
    sample_paths: string[];
}

export interface PromptGroup {
    fingerprint: string;
    positive_prompt: string | null;
    model: string | null;
    count: number;
    /** Up to 4 rel_paths for thumbnail strip */
    sample_paths: string[];
}
