import type { Metadata } from "../types";
import { isPlainPromptString } from "./heuristicMetadataParser";
import type { ExtractedPrompts, LoraInfo, MetadataExtractionPass, Parameters } from "./metadataParser";
import { isPositivePrompt, isNegativePrompt } from "./validator";

// Extracts the positive prompt by following references, always tracing the 'positive' input chain
export function extractPositivePromptFromPromptObject(prompt: any, samplerNodeId: string | number): string {
    if (!prompt || typeof prompt !== 'object') return '';
    // Helper to recursively resolve prompt string
    function resolvePromptRef(ref: any, visited = new Set()): string {
        if (!ref || visited.has(ref)) return '';
        visited.add(ref);
        // Direct string
        if (typeof ref === 'string' && isPlainPromptString(ref)) return ref;
        // Object with content
        if (typeof ref === 'object' && ref.content && isPlainPromptString(ref.content)) return ref.content;
        // Array reference to another node
        if (Array.isArray(ref) && typeof ref[0] === 'string') {
            const refNode = prompt[ref[0]];
            if (refNode && refNode.inputs) {
                // Prefer to follow 'positive' input if present
                if (refNode.inputs.positive) {
                    const result = resolvePromptRef(refNode.inputs.positive, visited);
                    if (result) return result;
                }
                // Otherwise, try 'text' or 'prompt' fields
                if (refNode.inputs.text) {
                    const result = resolvePromptRef(refNode.inputs.text, visited);
                    if (result) return result;
                }
                if (refNode.inputs.prompt) {
                    const result = resolvePromptRef(refNode.inputs.prompt, visited);
                    if (result) return result;
                }
            }
        }
        return '';
    }
    // Try to find the positive prompt input on the sampler node
    const sampler = prompt[samplerNodeId];
    if (!sampler || !sampler.inputs) return '';
    const posInput = sampler.inputs.positive;
    if (Array.isArray(posInput) && typeof posInput[0] === 'string') {
        return resolvePromptRef(posInput, new Set());
    }
    if (typeof posInput === 'string' && isPlainPromptString(posInput)) {
        return posInput;
    }
    return '';
}

// Extracts the model filename by following references, including LoRA/model loader nodes
export function extractModelFromPromptObject(prompt: any): string {
    if (!prompt || typeof prompt !== 'object') return '';
    // Helper to resolve array references recursively
    function resolveModelRef(ref: any, visited = new Set()): string {
        if (!ref || visited.has(ref)) return '';
        visited.add(ref);
        // Direct model filename
        if (typeof ref === 'string' && (ref.endsWith('.safetensors') || ref.endsWith('.ckpt'))) return ref;
        if (typeof ref === 'object' && ref.content && (ref.content.endsWith('.safetensors') || ref.content.endsWith('.ckpt'))) return ref.content;
        // Array reference to another node
        if (Array.isArray(ref) && typeof ref[0] === 'string') {
            const refNode = prompt[ref[0]];
            if (refNode && refNode.inputs) {
                // LoRA node: follow its model input
                if ((refNode.class_type === 'LoraLoader' || refNode.class_type === 'Power Lora Loader (rgthree)') && refNode.inputs.model) {
                    return resolveModelRef(refNode.inputs.model, visited);
                }
                // CheckpointLoader nodes
                if ((refNode.class_type === 'CheckpointLoaderSimple' || refNode.class_type === 'CheckpointLoader|pysssss' || refNode.class_type === 'ModelLoader' || refNode.class_type === 'CheckpointLoader') && refNode.inputs.ckpt_name) {
                    return resolveModelRef(refNode.inputs.ckpt_name, visited);
                }
                // Fallback: search for any string ending with .safetensors or .ckpt
                for (const key in refNode.inputs) {
                    const val = refNode.inputs[key];
                    const resolved = resolveModelRef(val, visited);
                    if (resolved) return resolved;
                }
            }
        }
        return '';
    }
    // Main search: prefer CheckpointLoader, then LoRA, then any likely model filename
    for (const nodeId in prompt) {
        const node = prompt[nodeId];
        if (!node || typeof node !== 'object') continue;
        const ct = node.class_type || node.type || '';
        const inputs = node.inputs || {};
        // CheckpointLoader nodes
        if ((ct === 'CheckpointLoaderSimple' || ct === 'CheckpointLoader|pysssss' || ct === 'ModelLoader' || ct === 'CheckpointLoader') && inputs.ckpt_name) {
            const resolved = resolveModelRef(inputs.ckpt_name);
            if (resolved) return resolved;
        }
        // LoRA nodes: follow their model input, but do NOT return the LoRA name
        if ((ct === 'LoraLoader' || ct === 'Power Lora Loader (rgthree)') && inputs.model) {
            const resolved = resolveModelRef(inputs.model);
            if (resolved) return resolved;
        }
        // Any node with a likely model filename
        for (const key in inputs) {
            const val = inputs[key];
            const resolved = resolveModelRef(val);
            if (resolved) return resolved;
        }
    }
    return '';
}

// Extracts all enabled LoRAs from the prompt object
export function extractLorasFromPromptObject(prompt: any): LoraInfo[] {
    const loras: LoraInfo[] = [];
    if (!prompt || typeof prompt !== 'object') return loras;
    for (const nodeId in prompt) {
        const node = prompt[nodeId];
        if (!node || typeof node !== 'object') continue;
        const ct = node.class_type || node.type || '';
        const inputs = node.inputs || {};
        // Power Lora Loader (rgthree) style
        for (const key in inputs) {
            if (key.startsWith('lora_') && inputs[key] && inputs[key].on && inputs[key].lora) {
                loras.push({
                    name: inputs[key].lora,
                    model_strength: inputs[key].strength,
                    clip_strength: inputs[key].strengthTwo
                });
            }
        }
        // LoraLoader style
        if (ct === 'LoraLoader' && inputs.lora_name) {
            loras.push({
                name: inputs.lora_name,
                model_strength: inputs.strength_model,
                clip_strength: inputs.strength_clip
            });
        }
    }
    return loras;
}

// Extracts sampler/steps/cfg/model/seed/etc from the prompt object
export function extractParametersFromPromptObject(prompt: any): Parameters {
    const params: Parameters = {};
    if (!prompt || typeof prompt !== 'object') return params;
    for (const nodeId in prompt) {
        const node = prompt[nodeId];
        if (!node || typeof node !== 'object') continue;
        const ct = node.class_type || node.type || '';
        const inputs = node.inputs || {};
        // Only extract from sampler nodes
        if (ct === 'KSampler' || ct === 'SamplerCustom' || ct === 'FaceDetailerPipe') {
            if (inputs.steps != null) params.steps = inputs.steps;
            if (inputs.cfg != null) params.cfg_scale = inputs.cfg;
            if (inputs.sampler_name) params.sampler = inputs.sampler_name;
            if (inputs.scheduler) params.scheduler = inputs.scheduler;
            if (inputs.seed != null) params.seed = inputs.seed;
            if (inputs.noise_seed != null && params.seed == null) params.seed = inputs.noise_seed;
        }
        // Model info from loader nodes
        if ((ct === 'CheckpointLoaderSimple' || ct === 'CheckpointLoader|pysssss') && inputs.ckpt_name) {
            if (typeof inputs.ckpt_name === 'string') params.model = inputs.ckpt_name;
            if (typeof inputs.ckpt_name === 'object' && inputs.ckpt_name.content) params.model = inputs.ckpt_name.content;
        }
    }
    params.loras = extractLorasFromPromptObject(prompt);
    return params;
}

// Extracts the seed value by following references
export function extractSeedFromPromptObject(prompt: any, samplerNodeId: string | number): string {
    if (!prompt || typeof prompt !== 'object') return '';
    const sampler = prompt[samplerNodeId];
    if (!sampler || !sampler.inputs) return '';
    const seedInput = sampler.inputs.seed;
    // If the seed input is an array reference, look up the referenced node
    if (Array.isArray(seedInput) && typeof seedInput[0] === 'string') {
        const refId = seedInput[0];
        const refNode = prompt[refId];
        if (refNode && refNode.class_type === 'FooocusV2Expansion' && refNode.inputs && refNode.inputs.prompt_seed != null) {
            return String(refNode.inputs.prompt_seed);
        }
        // Try other common fields
        if (refNode && refNode.inputs) {
            if (refNode.inputs.seed != null) return String(refNode.inputs.seed);
            if (refNode.inputs.text != null) return String(refNode.inputs.text);
            if (refNode.inputs.value != null) return String(refNode.inputs.value);
        }
    }
    // If the seed input is a direct value
    if (typeof seedInput === 'number' || typeof seedInput === 'string') {
        return String(seedInput);
    }
    return '';
}

// Recursively resolves a prompt string from a reference, handling special node types
function resolvePromptStringFromPromptObject(prompt: any, ref: any, visited = new Set()): string | null {
    if (!ref || visited.has(ref)) return null;
    visited.add(ref);
    // Direct string
    if (typeof ref === 'string' && ref.trim() !== '') return ref;
    // Array reference to another node
    if (Array.isArray(ref) && typeof ref[0] === 'string') {
        const refNode = prompt[ref[0]];
        if (refNode) {
            // Special handling for Textbox and ImpactWildcardProcessor nodes
            if (refNode.class_type === 'Textbox' && refNode.inputs && typeof refNode.inputs.text === 'string' && refNode.inputs.text.trim() !== '') {
                return refNode.inputs.text;
            }
            if (refNode.class_type === 'ImpactWildcardProcessor' && refNode.inputs) {
                if (typeof refNode.inputs.populated_text === 'string' && refNode.inputs.populated_text.trim() !== '') {
                    return refNode.inputs.populated_text;
                }
                if (typeof refNode.inputs.wildcard_text === 'string' && refNode.inputs.wildcard_text.trim() !== '') {
                    return refNode.inputs.wildcard_text;
                }
            }
            // Try widgets_values[0]
            if (Array.isArray(refNode.widgets_values) && typeof refNode.widgets_values[0] === 'string' && refNode.widgets_values[0].trim() !== '') {
                return refNode.widgets_values[0];
            }
            // Try inputs.text, inputs.prompt, or inputs.value recursively
            const inputs = refNode.inputs || {};
            for (const key of ['text', 'prompt', 'value']) {
                const val = inputs[key];
                const resolved = resolvePromptStringFromPromptObject(prompt, val, visited);
                if (resolved && resolved.trim() !== '') return resolved;
            }
        }
    }
    // Object with content (for CheckpointLoader, etc)
    if (typeof ref === 'object' && ref !== null && ref.content && typeof ref.content === 'string' && ref.content.trim() !== '') {
        return ref.content;
    }
    return null;
}

// Scans all nodes for positive/negative prompt candidates, using priorities and heuristics
export function extractPromptsFromPromptObject(prompt: any): ExtractedPrompts {
    let positive: string | null = null, negative: string | null = null;
    if (!prompt || typeof prompt !== 'object') return { positive, negative };
    // Collect all candidates
    const positiveCandidates: { value: string, priority: number, nodeType: string }[] = [];
    const negativeCandidates: { value: string, priority: number, nodeType: string }[] = [];
    let crPositive: string | null = null;
    let crNegative: string | null = null;
    for (const nodeId in prompt) {
        const node = prompt[nodeId];
        if (!node || typeof node !== 'object') continue;
        const ct = node.class_type || node.type || '';
        const title = node._meta?.title || '';
        const inputs = node.inputs || {};
        // --- Positive prompt candidates ---
        for (const key of ['prompt', 'text', 'value']) {
            const val = inputs[key];
            let resolved = null;
            if (isPlainPromptString(val) && isPositivePrompt(val)) {
                resolved = val;
            } else if (Array.isArray(val) || (typeof val === 'object' && val !== null)) {
                const rec = resolvePromptStringFromPromptObject(prompt, val);
                if (rec && isPositivePrompt(rec)) resolved = rec;
            }
            if (resolved) {
                let priority = 0;
                // Prefer CR Prompt Text nodes with Positive Prompt title
                if (ct === 'CR Prompt Text' && /positive/i.test(title)) {
                    priority = 10;
                    if (!crPositive && resolved.trim() !== '') crPositive = resolved;
                } else if (ct === 'CR Prompt Text') priority = 5;
                else if (/positive/i.test(title)) priority = 3;
                else if (ct === 'CLIPTextEncode') priority = 2;
                positiveCandidates.push({ value: resolved, priority, nodeType: ct });
            }
        }
        // --- Negative prompt candidates ---
        for (const key of ['prompt', 'text', 'value']) {
            const val = inputs[key];
            let resolved = null;
            if (isPlainPromptString(val) && isNegativePrompt(val)) {
                resolved = val;
            } else if (Array.isArray(val) || (typeof val === 'object' && val !== null)) {
                const rec = resolvePromptStringFromPromptObject(prompt, val);
                if (rec && isNegativePrompt(rec)) resolved = rec;
            }
            if (resolved) {
                let priority = 0;
                // Prefer CR Prompt Text nodes with Negative Prompt title
                if (ct === 'CR Prompt Text' && /negative/i.test(title)) {
                    priority = 10;
                    if (!crNegative && resolved.trim() !== '') crNegative = resolved;
                } else if (ct === 'CR Prompt Text') priority = 5;
                else if (/negative/i.test(title)) priority = 3;
                else if (ct === 'CLIPTextEncode') priority = 2;
                negativeCandidates.push({ value: resolved, priority, nodeType: ct });
            }
        }
    }
    // Prefer CR Prompt Text with Positive/Negative Prompt title if non-empty
    if (crPositive && crPositive.trim() !== '') {
        positive = crPositive;
    } else if (positiveCandidates.length > 0) {
        // Always use the first valid positive candidate (from any node, including CLIPTextEncode)
        positive = positiveCandidates[0].value;
    }
    if (crNegative && crNegative.trim() !== '') {
        negative = crNegative;
    } else if (negativeCandidates.length > 0) {
        negative = negativeCandidates[0].value;
    }
    return { positive, negative };
}

// Main parser class for prompt objects
export class PromptMetadataParser {
    constructor() {}
    model(metadata: Metadata): string | undefined {
        return extractModelFromPromptObject(metadata.prompt) || undefined;
    }
    seed(metadata: Metadata): string | undefined {
        if (!metadata.prompt) return undefined;
        const samplerNodeId = Object.keys(metadata.prompt).find(
            k => metadata.prompt[k]?.class_type === 'KSampler' || metadata.prompt[k]?.class_type === 'SamplerCustom' || metadata.prompt[k]?.class_type === 'FaceDetailerPipe'
        );
        if (!samplerNodeId) return undefined;
        return extractSeedFromPromptObject(metadata.prompt, samplerNodeId) || undefined;
    }
    positive(metadata: Metadata): string | undefined {
        if (!metadata.prompt) return undefined;
        const samplerNodeId = Object.keys(metadata.prompt).find(
            k => metadata.prompt[k]?.class_type === 'KSampler' || metadata.prompt[k]?.class_type === 'SamplerCustom' || metadata.prompt[k]?.class_type === 'FaceDetailerPipe'
        );
        if (samplerNodeId) {
            const pos = extractPositivePromptFromPromptObject(metadata.prompt, samplerNodeId);
            if (pos) return pos;
        }
        const promptPrompts = extractPromptsFromPromptObject(metadata.prompt);
        if (promptPrompts.positive) return promptPrompts.positive;
        return undefined;
    }
    negative(metadata: Metadata): string | undefined {
        const promptPrompts = extractPromptsFromPromptObject(metadata.prompt);
        if (promptPrompts.negative) return promptPrompts.negative;
        return undefined;
    }
    sampler(metadata: Metadata): string | undefined {
        const params = extractParametersFromPromptObject(metadata.prompt);
        return params.sampler ? String(params.sampler) : undefined;
    }
    scheduler(metadata: Metadata): string | undefined {
        const params = extractParametersFromPromptObject(metadata.prompt);
        return params.scheduler ? String(params.scheduler) : undefined;
    }
    steps(metadata: Metadata): string | undefined {
        const params = extractParametersFromPromptObject(metadata.prompt);
        return params.steps != null ? String(params.steps) : undefined;
    }
    cfg_scale(metadata: Metadata): string | undefined {
        const params = extractParametersFromPromptObject(metadata.prompt);
        return params.cfg_scale != null ? String(params.cfg_scale) : undefined;
    }
    loras(metadata: Metadata): string | undefined {
        const loras = extractLorasFromPromptObject(metadata.prompt);
        return loras.length > 0 ? loras.map(lora => lora && lora.name ? `${lora.name} (Model: ${lora.model_strength ?? ''}, Clip: ${lora.clip_strength ?? ''})` : '').filter(Boolean).join(', ') : undefined;
    }
}

// Extraction pass for prompt objects
export const extractByPrompt: MetadataExtractionPass = {
    model(metadata: Metadata) {
        return extractModelFromPromptObject(metadata.prompt) || null;
    },
    seed(metadata: Metadata) {
        // Try to find sampler node id
        if (!metadata.prompt) return null;
        const samplerNodeId = Object.keys(metadata.prompt).find(
            k => metadata.prompt[k]?.class_type === 'KSampler' || metadata.prompt[k]?.class_type === 'SamplerCustom' || metadata.prompt[k]?.class_type === 'FaceDetailerPipe'
        );
        if (!samplerNodeId) return null;
        return extractSeedFromPromptObject(metadata.prompt, samplerNodeId) || null;
    },
    positive(metadata: Metadata) {
        // Try to find sampler node id
        if (!metadata.prompt) return null;
        const samplerNodeId = Object.keys(metadata.prompt).find(
            k => metadata.prompt[k]?.class_type === 'KSampler' || metadata.prompt[k]?.class_type === 'SamplerCustom' || metadata.prompt[k]?.class_type === 'FaceDetailerPipe'
        );
        if (samplerNodeId) {
            const pos = extractPositivePromptFromPromptObject(metadata.prompt, samplerNodeId);
            if (pos) return pos;
        }
        // Fallback: use heuristics
        const promptPrompts = extractPromptsFromPromptObject(metadata.prompt);
        if (promptPrompts.positive) return promptPrompts.positive;
        return null;
    },
    negative(metadata: Metadata) {
        const promptPrompts = extractPromptsFromPromptObject(metadata.prompt);
        if (promptPrompts.negative) return promptPrompts.negative;
        return null;
    },
    sampler(metadata: Metadata) {
        const params = extractParametersFromPromptObject(metadata.prompt);
        return params.sampler ? String(params.sampler) : null;
    },
    scheduler(metadata: Metadata) {
        const params = extractParametersFromPromptObject(metadata.prompt);
        return params.scheduler ? String(params.scheduler) : null;
    },
    steps(metadata: Metadata) {
        const params = extractParametersFromPromptObject(metadata.prompt);
        return params.steps != null ? String(params.steps) : null;
    },
    cfg_scale(metadata: Metadata) {
        const params = extractParametersFromPromptObject(metadata.prompt);
        return params.cfg_scale != null ? String(params.cfg_scale) : null;
    },
    loras(metadata: Metadata) {
        const loras = extractLorasFromPromptObject(metadata.prompt);
        return loras.length > 0 ? loras.map(lora => lora && lora.name ? `${lora.name} (Model: ${lora.model_strength ?? ''}, Clip: ${lora.clip_strength ?? ''})` : '').filter(Boolean).join(', ') : null;
    }
};