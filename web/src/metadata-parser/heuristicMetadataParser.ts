import type { Metadata } from "../types";
import type { ExtractedPrompts } from "./metadataParser";
import { isPositivePrompt, isNegativePrompt } from "./validator";

// Node types that often contain prompt text
export const PROMPT_NODE_TYPES = [
    'CLIPTextEncode', 'CR Prompt Text', 'ImpactWildcardProcessor', 'Textbox', 'easy showAnything', 'StringFunction', 'Text Multiline'
];

// Checks if a value is a plain string prompt (not an object or array)
export function isPlainPromptString(val: any): val is string {
    if (typeof val !== 'string') return false;
    const trimmed = val.trim();
    // Ignore JSON-like or array-like strings
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) return false;
    // Ignore huge lists (likely not a prompt)
    if (trimmed.length > 2000 && trimmed.split(',').length > 100) return false;
    return true;
}

// Tries to find positive/negative prompts by scanning likely nodes and fields
export function fallbackFindPromptsFromPromptObject(prompt: any): ExtractedPrompts {
    let positive: string | null = null, negative: string | null = null;
    if (!prompt || typeof prompt !== 'object') return { positive, negative };
    // Search all nodes of PROMPT_NODE_TYPES
    for (const nodeId in prompt) {
        const node = prompt[nodeId];
        if (!node || typeof node !== 'object') continue;
        const ct = node.class_type || node.type || '';
        if (!PROMPT_NODE_TYPES.includes(ct)) continue;
        const inputs = node.inputs || {};
        // Try text and prompt fields
        for (const key of ['text', 'prompt', 'value']) {
            const val = inputs[key];
            if (isPlainPromptString(val)) {
                // Only set if not already found
                if (!positive && isPositivePrompt(val)) positive = val;
                if (!negative && isNegativePrompt(val)) negative = val;
            }
        }
    }
    return { positive, negative };
}

// Simple parser using only heuristics
export class HeuristicMetadataParser {
    constructor() {}
    // Returns the first likely positive prompt found
    positive(metadata: Metadata): string | undefined {
        const fallbackPrompts = fallbackFindPromptsFromPromptObject(metadata.prompt);
        return fallbackPrompts.positive || undefined;
    }
    // Returns the first likely negative prompt found
    negative(metadata: Metadata): string | undefined {
        const fallbackPrompts = fallbackFindPromptsFromPromptObject(metadata.prompt);
        return fallbackPrompts.negative || undefined;
    }
}
