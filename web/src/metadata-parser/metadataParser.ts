// Utility to parse and format metadata for the Gallery preview
import { isPlainPromptString } from './heuristicMetadataParser';
import { extractByPrompt, extractUpscaleFromPromptObject } from './promptMetadataParser';
import type { FileDetails, Metadata } from '../types';
import { isNegativePrompt, isPositivePrompt } from './validator';
import { extractByWorkflow } from './workflowMetadataParser';
import { extractByA1111, getA1111ModelHash, getA1111Extras, hasA1111Data } from './a1111MetadataParser';
import { normalizeModelName, normalizeSamplerName, normalizeSchedulerName } from './samplerNormalizer';

// --- Types ---
export type NodeType = { [key: string]: any };
export type ExtractedPrompts = { positive: string | null, negative: string | null };
export type LoraInfo = { name?: string; model_strength?: any; clip_strength?: any };
export type Parameters = {
    model?: string;
    sampler?: string;
    scheduler?: string;
    steps?: number;
    cfg_scale?: number;
    seed?: number;
    loras?: LoraInfo[];
};

// Node types that are usually just pass-throughs
export const PASSTHROUGH_NODE_TYPES = [
    'FreeU_V2', 'Power Lora Loader (rgthree)', 'FreeU_V2', 'PerturbedAttentionGuidance', 'UltimateSDUpscale', 'BasicPipeToDetailerPipe', 'ToBasicPipe', 'FaceDetailerPipe'
];

// --- Types for extraction passes and metadata result ---
export type MetadataFields = {
    model: string | null;
    seed: string | null;
    positive: string | null;
    negative: string | null;
    sampler: string | null;
    scheduler: string | null;
    steps: string | null;
    cfg_scale: string | null;
    loras: string | null;
};

// Each extraction pass is a set of functions for each field
export type MetadataExtractionPass = {
    model?: (metadata: any) => string | null;
    seed?: (metadata: any) => string | null;
    positive?: (metadata: any) => string | null;
    negative?: (metadata: any) => string | null;
    sampler?: (metadata: any) => string | null;
    scheduler?: (metadata: any) => string | null;
    steps?: (metadata: any) => string | null;
    cfg_scale?: (metadata: any) => string | null;
    loras?: (metadata: any) => string | null;
};

// --- Extraction Pass: Placeholders ---
// Used as a fallback if no real value is found
export const extractPlaceholders: MetadataExtractionPass = {
    model() { return ''; },
    seed() { return ''; },
    positive() { return ''; },
    negative() { return ''; },
    sampler() { return ''; },
    scheduler() { return ''; },
    steps() { return ''; },
    cfg_scale() { return ''; },
    loras() { return 'N/A'; }
};

// --- Metadata Source Detection ---
export interface MetadataSourceInfo {
    hasA1111: boolean;
    hasPrompt: boolean;
    hasWorkflow: boolean;
}

export function detectMetadataSources(metadata: Metadata): MetadataSourceInfo {
    // Use hasA1111Data so JPEG images (UserComment path) are correctly detected
    const hasA1111 = hasA1111Data(metadata);
    const hasPrompt = !!(metadata?.prompt && typeof metadata.prompt === 'object' && Object.keys(metadata.prompt).length > 0);
    const hasWorkflow = !!(metadata?.workflow && typeof metadata.workflow === 'object' && Object.keys(metadata.workflow).length > 0);
    return { hasA1111, hasPrompt, hasWorkflow };
}

// --- Main Metadata Parsing (middleware style) ---
export type MetadataSource = 'auto' | 'civitai' | 'comfyui';

export function parseComfyMetadata(metadata: Metadata, source: MetadataSource = 'auto'): Record<string, string> {
    if (!metadata) return {};
    // File info
    const fileinfo: Record<string, any> = metadata.fileinfo || {};
    const result: Record<string, string> = {};
    result["Filename"] = fileinfo.filename || '';
    result["Resolution"] = fileinfo.resolution || '';
    result["File Size"] = fileinfo.size || '';
    result["Date Created"] = fileinfo.date || '';

    // Start with all fields null
    let fields: MetadataFields = {
        model: null,
        seed: null,
        positive: null,
        negative: null,
        sampler: null,
        scheduler: null,
        steps: null,
        cfg_scale: null,
        loras: null
    };
    // List of passes in order — controlled by source param
    let passes: MetadataExtractionPass[];
    if (source === 'civitai') {
        passes = [extractByA1111, extractPlaceholders];
    } else if (source === 'comfyui') {
        passes = [extractByPrompt, extractByWorkflow, extractPlaceholders];
    } else {
        passes = [extractByA1111, extractByPrompt, extractByWorkflow, extractPlaceholders];
    }
    // For each field, try each pass in order until a value is found
    for (const key of Object.keys(fields) as (keyof MetadataFields)[]) {
        for (const pass of passes) {
            if (fields[key] == null && typeof pass[key] === 'function') {
                const val = pass[key]!(metadata);
                if (val != null && val !== '') {
                    fields[key] = val;
                    break;
                }
            }
        }
    }
    // --- Final assignment and heuristics ---
    // If positive and negative are equal, try to find a better negative prompt
    if (fields.positive && fields.negative && fields.positive === fields.negative) {
        // Try to find all negative prompt candidates from prompt object
        let negativeCandidates: string[] = [];
        if (metadata.prompt && typeof metadata.prompt === 'object') {
            for (const nodeId in metadata.prompt) {
                const node = metadata.prompt[nodeId];
                if (!node || typeof node !== 'object') continue;
                const ct = node.class_type || node.type || '';
                const title = node._meta?.title || '';
                const inputs = node.inputs || {};
                // Look for prompt or text fields
                for (const key of ['prompt', 'text']) {
                    const val = inputs[key];
                    if (isPlainPromptString(val) && isNegativePrompt(val)) {
                        negativeCandidates.push(val);
                    }
                }
                // Extra: prefer nodes with 'Negative' in title or class_type
                if ((/negative/i.test(title) || /negative/i.test(ct)) && (isPlainPromptString(inputs.prompt) || isPlainPromptString(inputs.text))) {
                    if (isPlainPromptString(inputs.prompt) && isNegativePrompt(inputs.prompt)) negativeCandidates.unshift(inputs.prompt);
                    if (isPlainPromptString(inputs.text) && isNegativePrompt(inputs.text)) negativeCandidates.unshift(inputs.text);
                }
            }
        }
        // Deduplicate and remove any that match the positive prompt
        negativeCandidates = Array.from(new Set(negativeCandidates)).filter(x => x !== fields.positive);
        // Prefer the first candidate, or fallback
        if (negativeCandidates.length > 0) {
            fields.negative = negativeCandidates[0];
        } else {
            fields.negative = '';
        }
    }
    // If only negative is set, but it's actually positive, move it
    if (!fields.positive && fields.negative && isPositivePrompt(fields.negative) && !isNegativePrompt(fields.negative)) {
        fields.positive = fields.negative;
        fields.negative = '';
    }
    // Assign all fields to result, applying canonical display-name normalization
    result["Model"] = normalizeModelName(fields.model);
    result["Positive Prompt"] = fields.positive || '';
    result["Negative Prompt"] = fields.negative || '';
    result["Sampler"] = normalizeSamplerName(fields.sampler);
    result["Scheduler"] = normalizeSchedulerName(fields.scheduler);
    result["Steps"] = fields.steps || '';
    result["CFG Scale"] = fields.cfg_scale || '';
    result["Seed"] = fields.seed || '';
    result["LoRAs"] = fields.loras || 'N/A';

    // Emit model hash when available (A1111/Civitai only)
    const modelHash = getA1111ModelHash(metadata);
    if (modelHash) result["Model Hash"] = modelHash;

    // Emit all unrecognized A1111 extension fields (Civitai extras like VAE, Hires, ADetailer, etc.)
    const extras = getA1111Extras(metadata);
    for (const [key, value] of Object.entries(extras)) {
        if (!value) continue;
        // Title-case the key for display: "vae hash" → "Vae Hash"
        const displayKey = key.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        result[displayKey] = value;
    }

    // Upscale info from ComfyUI prompt graph (UltimateSDUpscale family)
    if (metadata.prompt && typeof metadata.prompt === 'object') {
        const upscale = extractUpscaleFromPromptObject(metadata.prompt);
        if (upscale.hires_upscaler && !result['Hires Upscaler']) result['Hires Upscaler'] = upscale.hires_upscaler;
        if (upscale.hires_denoise != null && !result['Hires Denoise']) result['Hires Denoise'] = String(upscale.hires_denoise);
        if (upscale.upscale_by != null && !result['Upscale Factor']) result['Upscale Factor'] = String(upscale.upscale_by);
    }

    return result;
}
