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
    rel_path?: string;
    count?: number;
}

export interface ImageParams {
    formats?: string[] | null;
    model?: string | null;
    model_hash?: string | null;
    positive_prompt?: string | null;
    negative_prompt?: string | null;
    sampler?: string | null;
    scheduler?: string | null;
    steps?: number | null;
    cfg_scale?: number | null;
    seed?: number | null;
    vae?: string | null;
    clip_skip?: number | null;
    denoise_strength?: number | null;
    hires_upscaler?: string | null;
    hires_steps?: number | null;
    hires_denoise?: number | null;
    loras?: Array<{ name: string; model_strength?: number | null; clip_strength?: number | null }> | null;
    extras?: Record<string, string> | null;
    prompt_fingerprint?: string | null;
    fileinfo?: {
        filename?: string | null;
        resolution?: string | null;
        size?: string | null;
        date?: string | null;
    } | null;
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
    models: string[];
    count: number;
    /** Up to 4 rel_paths for thumbnail strip */
    sample_paths: string[];
}
