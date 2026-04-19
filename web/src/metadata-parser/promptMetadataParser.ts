import type { Metadata } from "../types";
import { isPlainPromptString } from "./heuristicMetadataParser";
import type { ExtractedPrompts, LoraInfo, MetadataExtractionPass, Parameters } from "./metadataParser";
import { isPositivePrompt, isNegativePrompt } from "./validator";
import { normalizeModelName } from "./samplerNormalizer";

/**
 * Returns true for any sampler-family node class type.
 *
 * Matches all "KSampler*" and "*KSampler" variants by substring — this covers
 * KSampler, KSamplerAdvanced, Sage_KSampler, and also KSampler Config (rgthree)
 * which, while not an execution node, carries the actual literal sampler parameters
 * (cfg, sampler_name, scheduler) that the execution node defers to via links.
 * Non-KSampler sampler types are kept explicit.
 */
function isSamplerType(ct: string): boolean {
    return ct.includes('KSampler') || ct === 'SamplerCustom' || ct === 'FaceDetailerPipe';
}

/**
 * Ordered list of input key names that carry text or conditioning in the prompt graph.
 * Tried in priority order when traversing backwards from a sampler's positive input.
 * Keys later in this list are less common but have been seen in real-world workflows.
 *
 * When a new community node is encountered that uses an unlisted key to relay
 * text/conditioning, add it here rather than adding a generic "follow all links"
 * fallback — generic traversal risks following model/vae/negative branches and
 * returning wrong strings.
 */
const PROMPT_RELAY_KEYS = [
    'positive',   // KSampler → any conditioning relay node
    'text',       // CLIPTextEncode, CR Prompt Text, etc.
    'prompt',     // generic
    'value',      // PrimitiveStringMultiline, primitive nodes
    'pos',        // Sage_DualCLIPTextEncode
    'ctx_02',     // rgthree Context Merge Big (ctx_02 = conditioning override, tried first)
    'ctx_01',     // rgthree Context Merge Big (ctx_01 = base context, fallback)
    'string_b',   // StringConcatenate (string_b usually carries main content)
    'string_a',   // StringConcatenate (fallback when string_b is absent/empty)
] as const;

// Extracts the positive prompt by following references, always tracing the 'positive' input chain
export function extractPositivePromptFromPromptObject(prompt: any, samplerNodeId: string | number): string {
    if (!prompt || typeof prompt !== 'object') return '';
    // Helper to recursively resolve prompt string
    function resolvePromptRef(ref: any, visited = new Set<string>()): string {
        if (!ref) return '';
        // Direct string
        if (typeof ref === 'string' && isPlainPromptString(ref)) return ref;
        // Object with content
        if (typeof ref === 'object' && !Array.isArray(ref) && ref.content && isPlainPromptString(ref.content)) return ref.content;
        // Array reference to another node
        if (Array.isArray(ref) && typeof ref[0] === 'string') {
            const nodeId = ref[0];
            // Use node ID as visited key (stable string comparison, prevents cycles)
            if (visited.has(nodeId)) return '';
            visited.add(nodeId);
            const refNode = prompt[nodeId];
            if (refNode && refNode.inputs) {
                for (const key of PROMPT_RELAY_KEYS) {
                    if (refNode.inputs[key] !== undefined) {
                        const result = resolvePromptRef(refNode.inputs[key], visited);
                        if (result) return result;
                    }
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
    function resolveModelRef(ref: any, visited = new Set<string>()): string {
        if (!ref) return '';
        // Stable visit key for arrays (dedup cycles)
        const key = Array.isArray(ref) ? `${ref[0]}:${ref[1]}` : String(ref);
        if (visited.has(key)) return '';
        visited.add(key);
        // Direct model filename
        if (typeof ref === 'string' && (ref.endsWith('.safetensors') || ref.endsWith('.ckpt'))) return ref;
        if (typeof ref === 'object' && ref.content && (ref.content.endsWith('.safetensors') || ref.content.endsWith('.ckpt'))) return ref.content;
        // Array reference to another node
        if (Array.isArray(ref) && typeof ref[0] === 'string') {
            const refNode = prompt[ref[0]];
            if (refNode && refNode.inputs) {
                const inp = refNode.inputs;
                // LoRA node: follow its model input
                if ((refNode.class_type === 'LoraLoader' || refNode.class_type === 'Power Lora Loader (rgthree)') && inp.model) {
                    return resolveModelRef(inp.model, visited);
                }
                // CheckpointLoader nodes (all known variants)
                const isCheckpoint = refNode.class_type === 'CheckpointLoaderSimple' || refNode.class_type === 'CheckpointLoader|pysssss' ||
                    refNode.class_type === 'ModelLoader' || refNode.class_type === 'CheckpointLoader' ||
                    refNode.class_type === 'Checkpoint Loader (Simple)' || refNode.class_type === 'Sage_CheckpointSelector';
                if (isCheckpoint && inp.ckpt_name) {
                    return resolveModelRef(inp.ckpt_name, visited);
                }
                // Sage model+lora stack loader: follow model_info to checkpoint selector
                if (refNode.class_type === 'Sage_ModelLoraStackLoader' && inp.model_info) {
                    return resolveModelRef(inp.model_info, visited);
                }
                // Generic switch detection (signature-based, works for any custom switch node)
                // Pattern A — indexed switch: literal integer `select`/`condition`/`index` + `input1`, `input2`, …
                const selectVal = inp.select ?? inp.condition ?? inp.index;
                if (typeof selectVal === 'number' && !isLink(selectVal) && inp[`input${selectVal}`]) {
                    return resolveModelRef(inp[`input${selectVal}`], visited);
                }
                // Pattern B — boolean switch: `on_true` + `on_false` + any literal boolean input
                if ('on_true' in inp && 'on_false' in inp) {
                    const boolKey = Object.keys(inp).find(k => k !== 'on_true' && k !== 'on_false' && typeof inp[k] === 'boolean' && !isLink(inp[k]));
                    if (boolKey !== undefined) {
                        return resolveModelRef(inp[boolKey] ? inp.on_true : inp.on_false, visited);
                    }
                }
                // Fallback: search for any string ending with .safetensors or .ckpt in all inputs
                for (const k in inp) {
                    const resolved = resolveModelRef(inp[k], visited);
                    if (resolved) return resolved;
                }
            }
        }
        return '';
    }

    // Pass 0 (new): trace model backwards from each top-level sampler node.
    // "Top-level" = node ID without ':' (compound IDs belong to nested sub-workflows
    // that may not have executed). Takes majority vote to handle multi-sampler graphs.
    const modelVotes: Record<string, number> = {};
    for (const nodeId in prompt) {
        if (nodeId.includes(':')) continue; // skip compound (subgraph) node IDs
        const node = prompt[nodeId];
        if (!node || !isSamplerType(node.class_type)) continue;
        const modelInput = node.inputs?.model;
        if (!modelInput) continue;
        const resolved = resolveModelRef(modelInput);
        if (resolved) modelVotes[resolved] = (modelVotes[resolved] ?? 0) + 1;
    }
    if (Object.keys(modelVotes).length > 0) {
        const winner = Object.entries(modelVotes).sort((a, b) => b[1] - a[1])[0][0];
        return winner;
    }

    // Pass 1 (Sage-specific): Sage_ModelLoraStackLoader → Sage_CheckpointSelector
    for (const nodeId in prompt) {
        const node = prompt[nodeId];
        if (!node || typeof node !== 'object') continue;
        const ct = node.class_type || node.type || '';
        const inputs = node.inputs || {};
        if (ct === 'Sage_ModelLoraStackLoader' && inputs.model_info) {
            const resolved = resolveModelRef(inputs.model_info);
            if (resolved) return resolved;
        }
        if (ct === 'Sage_CheckpointSelector' && inputs.ckpt_name && typeof inputs.ckpt_name === 'string') {
            return inputs.ckpt_name;
        }
    }
    // Pass 2: prefer CheckpointLoader, then LoRA, then any likely model filename
    for (const nodeId in prompt) {
        const node = prompt[nodeId];
        if (!node || typeof node !== 'object') continue;
        const ct = node.class_type || node.type || '';
        const inputs = node.inputs || {};
        if ((ct === 'CheckpointLoaderSimple' || ct === 'CheckpointLoader|pysssss' || ct === 'ModelLoader' || ct === 'CheckpointLoader' || ct === 'Checkpoint Loader (Simple)') && inputs.ckpt_name) {
            const resolved = resolveModelRef(inputs.ckpt_name);
            if (resolved) return resolved;
        }
        if ((ct === 'LoraLoader' || ct === 'Power Lora Loader (rgthree)') && inputs.model) {
            const resolved = resolveModelRef(inputs.model);
            if (resolved) return resolved;
        }
        for (const key in inputs) {
            const resolved = resolveModelRef(inputs[key]);
            if (resolved) return resolved;
        }
    }
    return '';
}

// ---------------------------------------------------------------------------
// Generic BFS-based sampler parameter extraction helpers
// ---------------------------------------------------------------------------

/** Check if a value is a prompt-JSON link reference [nodeId, outputIndex] */
function isLink(val: any): val is [string, number] {
    return Array.isArray(val) && val.length === 2 && typeof val[0] === 'string';
}

/**
 * Maps prompt-JSON input names to Parameters field names + expected type.
 * Order matters: entries listed first take priority when multiple map to the same field.
 */
const SAMPLER_FIELD_SPECS: Array<{ input: string; field: keyof Parameters; type: 'number' | 'string' | 'model' }> = [
    { input: 'steps',       field: 'steps',     type: 'number' },
    // KSampler Config (rgthree) uses steps_total instead of steps
    { input: 'steps_total', field: 'steps',     type: 'number' },
    { input: 'cfg',         field: 'cfg_scale',  type: 'number' },
    { input: 'cfg_scale',   field: 'cfg_scale',  type: 'number' },
    { input: 'sampler_name',field: 'sampler',    type: 'string' },
    { input: 'scheduler',   field: 'scheduler',  type: 'string' },
    { input: 'seed',        field: 'seed',       type: 'number' },
    { input: 'noise_seed',  field: 'seed',       type: 'number' },
    { input: 'ckpt_name',   field: 'model',      type: 'model'  },
];

/**
 * Find the sampler hub node: the first node whose inputs contain BOTH
 * 'positive' and 'negative' as link references (type-agnostic detection).
 */
function findSamplerHubFromPrompt(prompt: any): string | null {
    if (!prompt || typeof prompt !== 'object') return null;
    for (const nodeId in prompt) {
        const node = prompt[nodeId];
        if (!node || typeof node !== 'object') continue;
        const inputs = node.inputs || {};
        if (isLink(inputs.positive) && isLink(inputs.negative)) {
            return nodeId;
        }
    }
    return null;
}

/**
 * BFS all upstream nodes reachable from startId via link inputs.
 * Returns array of all reachable nodeIds (including startId).
 */
function bfsUpstreamNodes(prompt: any, startId: string): string[] {
    const visited = new Set<string>([startId]);
    const queue = [startId];
    while (queue.length > 0) {
        const currentId = queue.shift()!;
        const node = prompt[currentId];
        if (!node || !node.inputs) continue;
        for (const key in node.inputs) {
            const val = node.inputs[key];
            if (isLink(val) && !visited.has(val[0])) {
                visited.add(val[0]);
                queue.push(val[0]);
            }
        }
    }
    return Array.from(visited);
}

/**
 * Score a node's inputs for sampler fields and extract literal values.
 * Score = count of matching literal (non-link) inputs found.
 * Only one value per field is captured (first spec that matches wins).
 */
function scoreNodeParams(inputs: Record<string, any>): { score: number; fields: Partial<Parameters> } {
    const fields: Partial<Parameters> = {};
    let score = 0;
    for (const spec of SAMPLER_FIELD_SPECS) {
        const val = inputs[spec.input];
        if (isLink(val)) continue; // links are followed, not read as literals
        if ((fields as any)[spec.field] != null) continue; // already set by earlier spec
        if (spec.type === 'number' && typeof val === 'number') {
            (fields as any)[spec.field] = val; score++;
        } else if (spec.type === 'string' && typeof val === 'string' && val !== '') {
            (fields as any)[spec.field] = val; score++;
        } else if (spec.type === 'model' && typeof val === 'string' &&
                   (val.endsWith('.safetensors') || val.endsWith('.ckpt'))) {
            fields.model = val; score++;
        }
    }
    return { score, fields };
}

/**
 * Extract sampler parameters from a set of nodes using feature-score ranking.
 * For each field, picks the value from the highest-scoring node that has it.
 */
function extractParamsFromNodeSet(prompt: any, nodeIds: string[]): Partial<Parameters> {
    const result: Partial<Parameters> = {};
    // Score each node and sort by score descending
    const scored = nodeIds
        .map(id => {
            const node = prompt[id];
            if (!node || !node.inputs) return null;
            return scoreNodeParams(node.inputs);
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .sort((a, b) => b.score - a.score);
    // Fill in result fields from the highest-scoring nodes
    for (const { fields } of scored) {
        for (const spec of SAMPLER_FIELD_SPECS) {
            if ((result as any)[spec.field] == null && (fields as any)[spec.field] != null) {
                (result as any)[spec.field] = (fields as any)[spec.field];
            }
        }
    }
    return result;
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

type UpscaleInfo = {
    hires_upscaler?: string;
    hires_denoise?: number;
    upscale_by?: number;
};

/**
 * Extract tile-upscale node info (UltimateSDUpscale family).
 * Returns the first upscale node found — multi-pass upscale workflows are uncommon.
 */
export function extractUpscaleFromPromptObject(prompt: any): UpscaleInfo {
    if (!prompt || typeof prompt !== 'object') return {};
    for (const nodeId in prompt) {
        const node = prompt[nodeId];
        if (!node || typeof node !== 'object') continue;
        const ct: string = node.class_type || node.type || '';
        if (!ct.includes('UltimateSDUpscale')) continue;
        const inputs = node.inputs || {};
        const info: UpscaleInfo = {};

        if (typeof inputs.denoise === 'number') info.hires_denoise = inputs.denoise;
        if (typeof inputs.upscale_by === 'number') info.upscale_by = inputs.upscale_by;

        // Follow upscale_model link → UpscaleModelLoader.model_name
        if (isLink(inputs.upscale_model)) {
            const refNode = prompt[inputs.upscale_model[0]];
            const modelName = refNode?.inputs?.model_name;
            if (typeof modelName === 'string' && modelName) {
                info.hires_upscaler = normalizeModelName(modelName);
            }
        }

        return info;
    }
    return {};
}

// Extracts sampler/steps/cfg/model/seed/etc from the prompt object.
// Three-pass approach:
//   Pass 1: known class-type fast path (KSampler / SamplerCustom / FaceDetailerPipe / etc.)
//   Pass 2: hub-first BFS — find node with positive+negative link inputs, walk all upstream nodes
//   Pass 3: last-resort — score ALL nodes in the graph
export function extractParametersFromPromptObject(prompt: any): Parameters {
    const params: Parameters = {};
    if (!prompt || typeof prompt !== 'object') return params;

    // Pass 1: known class-type fast path
    for (const nodeId in prompt) {
        const node = prompt[nodeId];
        if (!node || typeof node !== 'object') continue;
        const ct = node.class_type || node.type || '';
        const inputs = node.inputs || {};
        // Standard KSampler family — only read literal (non-link) values
        // KSampler Config (rgthree) uses steps_total instead of steps
        if (isSamplerType(ct)) {
            if (inputs.steps != null && !isLink(inputs.steps)) params.steps = inputs.steps;
            else if (inputs.steps_total != null && !isLink(inputs.steps_total) && params.steps == null) params.steps = inputs.steps_total;
            if (inputs.cfg != null && !isLink(inputs.cfg)) params.cfg_scale = inputs.cfg;
            if (inputs.sampler_name && !isLink(inputs.sampler_name)) params.sampler = inputs.sampler_name;
            if (inputs.scheduler && !isLink(inputs.scheduler)) params.scheduler = inputs.scheduler;
            if (inputs.seed != null && !isLink(inputs.seed)) params.seed = inputs.seed;
            if (inputs.noise_seed != null && params.seed == null && !isLink(inputs.noise_seed)) params.seed = inputs.noise_seed;
        }
        // Sage sampler info node — all params as direct literals, high-priority source
        if (ct === 'Sage_SamplerInfo') {
            if (inputs.steps != null && !isLink(inputs.steps) && params.steps == null) params.steps = inputs.steps;
            if (inputs.cfg != null && !isLink(inputs.cfg) && params.cfg_scale == null) params.cfg_scale = inputs.cfg;
            if (inputs.sampler_name && !isLink(inputs.sampler_name) && params.sampler == null) params.sampler = inputs.sampler_name;
            if (inputs.scheduler && !isLink(inputs.scheduler) && params.scheduler == null) params.scheduler = inputs.scheduler;
            if (inputs.seed != null && !isLink(inputs.seed) && params.seed == null) params.seed = inputs.seed;
        }
        // Checkpoint nodes
        const isCheckpointNode = ct === 'CheckpointLoaderSimple' || ct === 'CheckpointLoader|pysssss' ||
            ct === 'ModelLoader' || ct === 'CheckpointLoader' ||
            ct === 'Checkpoint Loader (Simple)' || ct === 'Sage_CheckpointSelector';
        if (isCheckpointNode && inputs.ckpt_name && params.model == null) {
            if (typeof inputs.ckpt_name === 'string') params.model = inputs.ckpt_name;
            else if (typeof inputs.ckpt_name === 'object' && inputs.ckpt_name.content) params.model = inputs.ckpt_name.content;
        }
    }

    const missingAny = () => [
        params.steps, params.cfg_scale, params.sampler,
        params.scheduler, params.seed, params.model
    ].some(v => v == null);

    if (missingAny()) {
        // Pass 2: hub-first BFS topology traversal
        const hubId = findSamplerHubFromPrompt(prompt);
        if (hubId) {
            const upstreamIds = bfsUpstreamNodes(prompt, hubId);
            const hubParams = extractParamsFromNodeSet(prompt, upstreamIds);
            if (params.steps == null && hubParams.steps != null) params.steps = hubParams.steps;
            if (params.cfg_scale == null && hubParams.cfg_scale != null) params.cfg_scale = hubParams.cfg_scale;
            if (params.sampler == null && hubParams.sampler != null) params.sampler = hubParams.sampler;
            if (params.scheduler == null && hubParams.scheduler != null) params.scheduler = hubParams.scheduler;
            if (params.seed == null && hubParams.seed != null) params.seed = hubParams.seed;
            if (params.model == null && hubParams.model != null) params.model = hubParams.model;
        }
    }

    if (missingAny()) {
        // Pass 3: last-resort — score ALL nodes
        const allParams = extractParamsFromNodeSet(prompt, Object.keys(prompt));
        if (params.steps == null && allParams.steps != null) params.steps = allParams.steps;
        if (params.cfg_scale == null && allParams.cfg_scale != null) params.cfg_scale = allParams.cfg_scale;
        if (params.sampler == null && allParams.sampler != null) params.sampler = allParams.sampler;
        if (params.scheduler == null && allParams.scheduler != null) params.scheduler = allParams.scheduler;
        if (params.seed == null && allParams.seed != null) params.seed = allParams.seed;
        if (params.model == null && allParams.model != null) params.model = allParams.model;
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
        // Try other common fields — only accept literal (non-link) values
        if (refNode && refNode.inputs) {
            if (refNode.inputs.seed != null && !isLink(refNode.inputs.seed)) return String(refNode.inputs.seed);
            if (refNode.inputs.value != null && !isLink(refNode.inputs.value) && typeof refNode.inputs.value === 'number') return String(refNode.inputs.value);
            if (refNode.inputs.text != null && !isLink(refNode.inputs.text) && typeof refNode.inputs.text === 'number') return String(refNode.inputs.text);
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
            k => isSamplerType(metadata.prompt[k]?.class_type)
        );
        if (samplerNodeId) {
            const seed = extractSeedFromPromptObject(metadata.prompt, samplerNodeId);
            if (seed) return seed;
        }
        const params = extractParametersFromPromptObject(metadata.prompt);
        return params.seed != null ? String(params.seed) : undefined;
    }
    positive(metadata: Metadata): string | undefined {
        if (!metadata.prompt) return undefined;
        const samplerNodeId = Object.keys(metadata.prompt).find(
            k => isSamplerType(metadata.prompt[k]?.class_type)
        );
        if (samplerNodeId) {
            const pos = extractPositivePromptFromPromptObject(metadata.prompt, samplerNodeId);
            if (pos) return pos;
        }
        const hubId = findSamplerHubFromPrompt(metadata.prompt);
        if (hubId && hubId !== samplerNodeId) {
            const pos = extractPositivePromptFromPromptObject(metadata.prompt, hubId);
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
        // Try to find sampler node id via known class types
        if (!metadata.prompt) return null;
        const samplerNodeId = Object.keys(metadata.prompt).find(
            k => isSamplerType(metadata.prompt[k]?.class_type)
        );
        if (samplerNodeId) {
            const seed = extractSeedFromPromptObject(metadata.prompt, samplerNodeId);
            if (seed) return seed;
        }
        // Hub-first fallback via 3-pass extractParametersFromPromptObject
        const params = extractParametersFromPromptObject(metadata.prompt);
        return params.seed != null ? String(params.seed) : null;
    },
    positive(metadata: Metadata) {
        if (!metadata.prompt) return null;
        // Try known sampler types first
        const samplerNodeId = Object.keys(metadata.prompt).find(
            k => isSamplerType(metadata.prompt[k]?.class_type)
        );
        if (samplerNodeId) {
            const pos = extractPositivePromptFromPromptObject(metadata.prompt, samplerNodeId);
            if (pos) return pos;
        }
        // Hub-first fallback: find hub node and follow its positive link
        const hubId = findSamplerHubFromPrompt(metadata.prompt);
        if (hubId && hubId !== samplerNodeId) {
            const pos = extractPositivePromptFromPromptObject(metadata.prompt, hubId);
            if (pos) return pos;
        }
        // Final fallback: heuristics
        const promptPrompts = extractPromptsFromPromptObject(metadata.prompt);
        if (promptPrompts.positive) return promptPrompts.positive;
        return null;
    },
    negative(metadata: Metadata) {
        if (!metadata.prompt) return null;
        // Hub-first: follow hub's negative link chain using resolvePromptStringFromPromptObject
        const hubId = findSamplerHubFromPrompt(metadata.prompt);
        if (hubId) {
            const hub = metadata.prompt[hubId];
            if (hub?.inputs) {
                const negRef = hub.inputs.negative;
                // Use existing resolvePromptStringFromPromptObject via the heuristic scan fallback path
                // by temporarily treating negative as positive (same link-following logic)
                if (isLink(negRef)) {
                    const negNode = metadata.prompt[negRef[0]];
                    if (negNode?.inputs) {
                        for (const key of ['prompt', 'text', 'value']) {
                            const val = negNode.inputs[key];
                            if (typeof val === 'string' && val.trim()) return val;
                            if (isLink(val)) {
                                // Follow one more hop
                                const deepNode = metadata.prompt[val[0]];
                                if (deepNode?.inputs) {
                                    for (const dk of ['prompt', 'text', 'value']) {
                                        const dv = deepNode.inputs[dk];
                                        if (typeof dv === 'string' && dv.trim()) return dv;
                                    }
                                }
                            }
                        }
                    }
                } else if (typeof negRef === 'string' && negRef.trim()) {
                    return negRef;
                }
            }
        }
        // Heuristic fallback
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