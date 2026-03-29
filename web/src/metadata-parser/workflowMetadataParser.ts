import type { Metadata } from "../types";
import { isPlainPromptString } from "./heuristicMetadataParser";
import type { NodeType, ExtractedPrompts, MetadataExtractionPass } from "./metadataParser";
import { isNegativePrompt, isPositivePrompt } from "./validator";

// Node types that usually contain model info
export const MODEL_NODE_TYPES = [
    'CheckpointLoaderSimple', 'CheckpointLoader|pysssss', 'ModelLoader', 'CheckpointLoader',
    'UnetLoaderGGUF', 'DualCLIPLoaderGGUF', 'UnetLoader', 'UnetLoaderGGML', 'UnetLoaderGGMLv3'
];

// ---------------------------------------------------------------------------
// Generic BFS-based sampler parameter extraction for workflow JSON
// ---------------------------------------------------------------------------

/**
 * Find sampler hub in workflow.nodes: first node with both 'positive' and 'negative' inputs
 * (via link IDs). These nodes have inputs as an array of {name, type, link?} objects.
 */
function findSamplerHubFromWorkflow(nodes: NodeType[]): NodeType | undefined {
    return nodes.find(n => {
        if (Array.isArray(n.inputs)) {
            const hasPos = n.inputs.some((inp: any) => inp.name === 'positive');
            const hasNeg = n.inputs.some((inp: any) => inp.name === 'negative');
            return hasPos && hasNeg;
        }
        // Object-form inputs: check for link-valued positive+negative
        if (n.inputs && typeof n.inputs === 'object' && !Array.isArray(n.inputs)) {
            const inp = n.inputs as any;
            return (Array.isArray(inp.positive) || typeof inp.positive === 'number') &&
                   (Array.isArray(inp.negative) || typeof inp.negative === 'number');
        }
        return false;
    });
}

/** Build a map from link ID → source node for BFS traversal. */
function buildWorkflowLinkMap(nodes: NodeType[]): Map<number, NodeType> {
    const map = new Map<number, NodeType>();
    for (const node of nodes) {
        if (!Array.isArray(node.outputs)) continue;
        for (const out of node.outputs) {
            if (Array.isArray(out.links)) {
                for (const linkId of out.links) {
                    map.set(linkId, node);
                }
            }
        }
    }
    return map;
}

/** BFS all upstream nodes from startNode using the link map. */
function bfsUpstreamNodesWorkflow(startNode: NodeType, linkMap: Map<number, NodeType>): NodeType[] {
    const visited = new Set<number>([startNode.id]);
    const result: NodeType[] = [startNode];
    const queue: NodeType[] = [startNode];
    while (queue.length > 0) {
        const current = queue.shift()!;
        if (Array.isArray(current.inputs)) {
            for (const inp of current.inputs) {
                if (typeof inp.link === 'number') {
                    const upstream = linkMap.get(inp.link);
                    if (upstream && !visited.has(upstream.id)) {
                        visited.add(upstream.id);
                        result.push(upstream);
                        queue.push(upstream);
                    }
                }
            }
        }
    }
    return result;
}

/**
 * Score a workflow node for sampler-related fields.
 * Checks both object-form inputs (named fields) and widgets_values (model filename).
 */
function scoreWorkflowNodeParams(node: NodeType): { score: number; fields: Record<string, any> } {
    const fields: Record<string, any> = {};
    let score = 0;
    const inp = node.inputs;
    if (inp && !Array.isArray(inp) && typeof inp === 'object') {
        if (typeof inp.steps === 'number') { fields.steps = inp.steps; score++; }
        if (typeof inp.cfg === 'number') { fields.cfg_scale = inp.cfg; score++; }
        if (typeof inp.cfg_scale === 'number' && fields.cfg_scale == null) { fields.cfg_scale = inp.cfg_scale; score++; }
        if (typeof inp.sampler_name === 'string' && inp.sampler_name) { fields.sampler = inp.sampler_name; score++; }
        if (typeof inp.scheduler === 'string' && inp.scheduler) { fields.scheduler = inp.scheduler; score++; }
        if (typeof inp.seed === 'number') { fields.seed = inp.seed; score++; }
        if (typeof inp.noise_seed === 'number' && fields.seed == null) { fields.seed = inp.noise_seed; score++; }
        if (typeof inp.ckpt_name === 'string' &&
            (inp.ckpt_name.endsWith('.safetensors') || inp.ckpt_name.endsWith('.ckpt'))) {
            fields.model = inp.ckpt_name; score++;
        }
    }
    // widgets_values[0] as model filename fallback
    if (!fields.model && Array.isArray(node.widgets_values) && typeof node.widgets_values[0] === 'string') {
        const wv = node.widgets_values[0];
        if (wv.endsWith('.safetensors') || wv.endsWith('.ckpt')) {
            fields.model = wv; score++;
        }
    }
    return { score, fields };
}

/** Extract params from a set of workflow nodes using feature-score ranking. */
function extractParamsFromWorkflowNodes(nodes: NodeType[]): Record<string, any> {
    const result: Record<string, any> = {};
    const scored = nodes
        .map(n => scoreWorkflowNodeParams(n))
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score);
    for (const { fields } of scored) {
        for (const key of ['steps', 'cfg_scale', 'sampler', 'scheduler', 'seed', 'model']) {
            if (result[key] == null && fields[key] != null) result[key] = fields[key];
        }
    }
    return result;
}

// Recursively traces graph nodes to extract prompt strings
export function resolvePromptStringFromGraph(nodes: NodeType[], node: NodeType, visited = new Set<number>()): string | null {
    if (!node || visited.has(node.id)) return null;
    visited.add(node.id);
    let foundPrompts: string[] = [];
    // Try widgets_values[0] (most common place for prompt)
    if (isPlainPromptString(node.widgets_values?.[0]) && node.widgets_values[0].trim() !== '') {
        foundPrompts.push(node.widgets_values[0]);
    }
    // Try direct input fields
    const inputs = node.inputs || {};
    if (isPlainPromptString(inputs.text) && inputs.text.trim() !== '') {
        foundPrompts.push(inputs.text);
    }
    if (isPlainPromptString(inputs.prompt) && inputs.prompt.trim() !== '') {
        foundPrompts.push(inputs.prompt);
    }
    // Follow references in input fields
    for (const key of ['text', 'prompt', 'positive', 'negative']) {
        const val = inputs[key];
        if (Array.isArray(val) && typeof val[0] === 'string') {
            // Find referenced node by id
            const refNode = nodes.find(n => String(n.id) === val[0]);
            if (refNode) {
                const result = resolvePromptStringFromGraph(nodes, refNode, visited);
                if (result && result.trim() !== '') foundPrompts.push(result);
            }
        } else if (typeof val === 'string' && val.trim() !== '') {
            foundPrompts.push(val);
        }
    }
    // Follow input links for graph nodes
    if (Array.isArray(node.inputs)) {
        for (const inp of node.inputs) {
            if ((inp.name === 'text' || inp.name === 'prompt' || inp.name === 'positive' || inp.name === 'negative') && inp.link !== undefined) {
                const upstream = findSourcePromptNode(nodes, inp.link, visited);
                if (upstream) {
                    const result = resolvePromptStringFromGraph(nodes, upstream, visited);
                    if (result && result.trim() !== '') foundPrompts.push(result);
                }
            }
        }
    }
    // Return the deepest, last non-empty string found
    if (foundPrompts.length > 0) {
        return foundPrompts[foundPrompts.length - 1];
    }
    return null;
}

// Finds the node that is the source of a prompt link
export function findSourcePromptNode(nodes: NodeType[], linkId: number | undefined, visited = new Set<number>()): NodeType | undefined {
    if (typeof linkId !== 'number') return undefined;
    for (const node of nodes) {
        if (!Array.isArray(node.outputs)) continue;
        for (const out of node.outputs) {
            if (Array.isArray(out.links) && out.links.includes(linkId)) {
                // Prefer CLIPTextEncode nodes with a prompt string
                if (node.type === 'CLIPTextEncode' && isPlainPromptString(node.widgets_values?.[0])) return node;
                if (!visited.has(node.id)) {
                    visited.add(node.id);
                    // Recursively follow input links
                    if (Array.isArray(node.inputs)) {
                        for (const inp of node.inputs) {
                            if (typeof inp.link === 'number') {
                                const found = findSourcePromptNode(nodes, inp.link, visited);
                                if (found) return found;
                            }
                        }
                    }
                }
            }
        }
    }
    return undefined;
}

// Recursively resolves a prompt string from a node, following links
export function resolvePromptStringFromNode(nodes: NodeType[], node: NodeType, visited = new Set<number>()): string | null {
    if (!node || visited.has(node.id)) return null;
    visited.add(node.id);
    // Try widgets_values[0] first
    if (isPlainPromptString(node.widgets_values?.[0]) && node.widgets_values[0].trim() !== '') {
        return node.widgets_values[0];
    }
    // Try to follow 'text' or 'prompt' input recursively
    if (Array.isArray(node.inputs)) {
        for (const inp of node.inputs) {
            if ((inp.name === 'text' || inp.name === 'prompt' || inp.name === 'positive' || inp.name === 'negative') && inp.link !== undefined) {
                // Find the upstream node by link
                const upstream = findSourcePromptNode(nodes, inp.link, visited);
                if (upstream) {
                    // Try widgets_values[0] or inputs.text/prompt
                    let result = resolvePromptStringFromNode(nodes, upstream, visited);
                    if (result && result.trim() !== '') return result;
                    // Try direct input fields if widgets_values is empty
                    const upstreamInputs = upstream.inputs || {};
                    if (isPlainPromptString(upstreamInputs.text) && upstreamInputs.text.trim() !== '') return upstreamInputs.text;
                    if (isPlainPromptString(upstreamInputs.prompt) && upstreamInputs.prompt.trim() !== '') return upstreamInputs.prompt;
                }
            }
        }
    }
    return null;
}

// Extracts positive/negative prompts from the graph by tracing sampler node inputs
export function extractPromptsFromGraph(nodes: NodeType[]): ExtractedPrompts {
    const samplerTypes = ['KSampler', 'UltimateSDUpscale', 'KSamplerAdvanced', 'SamplerCustom', 'FaceDetailerPipe'];
    // Pass 1: known class types
    let sampler = nodes.find(n => samplerTypes.includes(n.type));
    // Pass 2: hub-first topology — find node with both positive+negative inputs
    if (!sampler) {
        sampler = findSamplerHubFromWorkflow(nodes);
    }
    if (!sampler || !Array.isArray(sampler.inputs)) return { positive: null, negative: null };
    let positive: string | null = null, negative: string | null = null;
    // Find input links for positive/negative
    const posInput = sampler.inputs.find((inp: any) => inp.name === 'positive');
    const negInput = sampler.inputs.find((inp: any) => inp.name === 'negative');
    let posNode: NodeType | undefined, negNode: NodeType | undefined;
    if (posInput && typeof posInput.link === 'number') {
        posNode = findSourcePromptNode(nodes, posInput.link);
        if (posNode) {
            positive = resolvePromptStringFromGraph(nodes, posNode) || '';
        }
    }
    if (negInput && typeof negInput.link === 'number') {
        negNode = findSourcePromptNode(nodes, negInput.link);
        if (negNode) {
            negative = resolvePromptStringFromGraph(nodes, negNode) || '';
        }
    }
    // Heuristic: If both resolve to the same string, try to deduplicate
    if (positive && negative && positive === negative) {
        if (isNegativePrompt(negative) && !isPositivePrompt(positive)) {
            positive = null;
        } else if (isPositivePrompt(positive) && !isNegativePrompt(negative)) {
            negative = null;
        } else {
            // If both are ambiguous, clear negative
            negative = null;
        }
    }
    return { positive, negative };
}

// Recursively traces graph nodes to extract seed value
export function resolveSeedFromGraph(nodes: NodeType[], node: NodeType, visited = new Set<number>()): string | null {
    if (!node || visited.has(node.id)) return null;
    visited.add(node.id);
    // Prefer widgets_values[1] for FooocusV2Expansion
    if (node.type === 'FooocusV2Expansion' && Array.isArray(node.widgets_values) && node.widgets_values.length > 1 && node.widgets_values[1] != null && node.widgets_values[1] !== '') {
        return String(node.widgets_values[1]);
    }
    // Otherwise, try widgets_values[0]
    if (Array.isArray(node.widgets_values) && node.widgets_values.length > 0 && node.widgets_values[0] != null && node.widgets_values[0] !== '') {
        return String(node.widgets_values[0]);
    }
    // Try direct input fields
    if (node.inputs && node.inputs.seed != null) {
        return String(node.inputs.seed);
    }
    // Try to follow input links (for graph nodes)
    if (Array.isArray(node.inputs)) {
        for (const inp of node.inputs) {
            if (inp.name === 'seed' && typeof inp.link === 'number') {
                const upstream = findSourcePromptNode(nodes, inp.link, visited);
                if (upstream) {
                    const result = resolveSeedFromGraph(nodes, upstream, visited);
                    if (result && result !== '') return result;
                }
            }
        }
    }
    // Try to find a direct seed value in the inputs array
    if (Array.isArray(node.inputs)) {
        const directSeed = node.inputs.find((inp: any) => inp.name === 'seed' && inp.value != null);
        if (directSeed) {
            return String(directSeed.value);
        }
    }
    return null;
}

// Extracts seed from the graph by tracing sampler node inputs
export function extractSeedFromGraph(nodes: NodeType[], samplerNode: NodeType): string {
    if (!samplerNode || !Array.isArray(samplerNode.inputs)) return '';
    const seedInput = samplerNode.inputs.find((inp: any) => inp.name === 'seed');
    if (seedInput && typeof seedInput.link === 'number') {
        const upstream = findSourcePromptNode(nodes, seedInput.link);
        if (upstream) {
            const result = resolveSeedFromGraph(nodes, upstream);
            if (result && result !== '') return result;
        }
    }
    // Fallback: try direct value on the input
    if (seedInput && seedInput.value != null) {
        return String(seedInput.value);
    }
    // Fallback: try to find a direct seed value in the inputs array
    const directSeed = samplerNode.inputs.find((inp: any) => inp.name === 'seed' && inp.value != null);
    if (directSeed) {
        return String(directSeed.value);
    }
    return '';
}

// Main workflow metadata parser class
export class WorkflowMetadataParser {
    constructor() {}
    // Finds model filename from model loader nodes
    model(metadata: Metadata): string | undefined {
        const workflow = metadata.workflow;
        if (!workflow || !Array.isArray(workflow.nodes)) return undefined;
        for (const node of workflow.nodes) {
            if (MODEL_NODE_TYPES.includes(node.type)) {
                if (Array.isArray(node.widgets_values) && typeof node.widgets_values[0] === 'string') {
                    return node.widgets_values[0];
                }
                if (Array.isArray(node.widgets_values) && typeof node.widgets_values[0] === 'object' && node.widgets_values[0]?.content) {
                    return node.widgets_values[0].content;
                }
            }
        }
        return undefined;
    }
    // Finds seed value by tracing sampler node inputs
    seed(metadata: Metadata): string | undefined {
        const workflow = metadata.workflow;
        if (!workflow || !Array.isArray(workflow.nodes)) return undefined;
        const samplerTypes = ['KSampler', 'UltimateSDUpscale', 'KSamplerAdvanced', 'SamplerCustom', 'FaceDetailerPipe'];
        let samplerNode = workflow.nodes.find((n: any) => samplerTypes.includes(n.type));
        if (!samplerNode) samplerNode = findSamplerHubFromWorkflow(workflow.nodes);
        if (samplerNode) {
            const result = extractSeedFromGraph(workflow.nodes, samplerNode);
            if (result) return result;
        }
        // BFS fallback
        const linkMap = buildWorkflowLinkMap(workflow.nodes);
        const hub = samplerNode || findSamplerHubFromWorkflow(workflow.nodes);
        const candidates = hub ? bfsUpstreamNodesWorkflow(hub, linkMap) : workflow.nodes;
        const params = extractParamsFromWorkflowNodes(candidates);
        return params.seed != null ? String(params.seed) : undefined;
    }
    // Finds positive prompt by tracing sampler node inputs
    positive(metadata: Metadata): string | undefined {
        const workflow = metadata.workflow;
        if (!workflow || !Array.isArray(workflow.nodes)) return undefined;
        const prompts = extractPromptsFromGraph(workflow.nodes);
        return prompts.positive || undefined;
    }
    // Finds negative prompt by tracing sampler node inputs
    negative(metadata: Metadata): string | undefined {
        const workflow = metadata.workflow;
        if (!workflow || !Array.isArray(workflow.nodes)) return undefined;
        const prompts = extractPromptsFromGraph(workflow.nodes);
        return prompts.negative || undefined;
    }
    // Finds sampler name from sampler node
    sampler(metadata: Metadata): string | undefined {
        const workflow = metadata.workflow;
        if (!workflow || !Array.isArray(workflow.nodes)) return undefined;
        for (const node of workflow.nodes) {
            if (node.type === 'KSampler' || node.type === 'SamplerCustom' || node.type === 'FaceDetailerPipe') {
                if (node.widgets_values && typeof node.widgets_values[4] === 'string') return node.widgets_values[4];
                if (node.inputs && node.inputs.sampler_name) return node.inputs.sampler_name;
            }
        }
        // Hub-first BFS fallback
        const hub = findSamplerHubFromWorkflow(workflow.nodes);
        const linkMap = buildWorkflowLinkMap(workflow.nodes);
        const candidates = hub ? bfsUpstreamNodesWorkflow(hub, linkMap) : workflow.nodes;
        const params = extractParamsFromWorkflowNodes(candidates);
        return params.sampler || undefined;
    }
    // Finds step count from sampler node
    steps(metadata: Metadata): string | undefined {
        const workflow = metadata.workflow;
        if (!workflow || !Array.isArray(workflow.nodes)) return undefined;
        for (const node of workflow.nodes) {
            if (node.type === 'KSampler' || node.type === 'SamplerCustom' || node.type === 'FaceDetailerPipe') {
                if (node.widgets_values && typeof node.widgets_values[2] === 'number') return String(node.widgets_values[2]);
                if (node.inputs && node.inputs.steps != null) return String(node.inputs.steps);
            }
        }
        // Hub-first BFS fallback
        const hub = findSamplerHubFromWorkflow(workflow.nodes);
        const linkMap = buildWorkflowLinkMap(workflow.nodes);
        const candidates = hub ? bfsUpstreamNodesWorkflow(hub, linkMap) : workflow.nodes;
        const params = extractParamsFromWorkflowNodes(candidates);
        return params.steps != null ? String(params.steps) : undefined;
    }
    // Finds CFG scale from sampler node
    cfg_scale(metadata: Metadata): string | undefined {
        const workflow = metadata.workflow;
        if (!workflow || !Array.isArray(workflow.nodes)) return undefined;
        for (const node of workflow.nodes) {
            if (node.type === 'KSampler' || node.type === 'SamplerCustom' || node.type === 'FaceDetailerPipe') {
                if (node.widgets_values && typeof node.widgets_values[3] === 'number') return String(node.widgets_values[3]);
                if (node.inputs && node.inputs.cfg != null) return String(node.inputs.cfg);
            }
        }
        // Hub-first BFS fallback
        const hub = findSamplerHubFromWorkflow(workflow.nodes);
        const linkMap = buildWorkflowLinkMap(workflow.nodes);
        const candidates = hub ? bfsUpstreamNodesWorkflow(hub, linkMap) : workflow.nodes;
        const params = extractParamsFromWorkflowNodes(candidates);
        return params.cfg_scale != null ? String(params.cfg_scale) : undefined;
    }
}

// Extraction pass for workflow graph
export const extractByWorkflow: MetadataExtractionPass = {
    model(metadata: Metadata) {
        const workflow = metadata.workflow;
        if (!workflow || !Array.isArray(workflow.nodes)) return null;
        for (const node of workflow.nodes) {
            if (MODEL_NODE_TYPES.includes(node.type)) {
                if (Array.isArray(node.widgets_values) && typeof node.widgets_values[0] === 'string') {
                    return node.widgets_values[0];
                }
                if (Array.isArray(node.widgets_values) && typeof node.widgets_values[0] === 'object' && node.widgets_values[0]?.content) {
                    return node.widgets_values[0].content;
                }
            }
        }
        return null;
    },
    seed(metadata: Metadata) {
        const workflow = metadata.workflow;
        if (!workflow || !Array.isArray(workflow.nodes)) return null;
        const samplerTypes = ['KSampler', 'UltimateSDUpscale', 'KSamplerAdvanced', 'SamplerCustom', 'FaceDetailerPipe'];
        let samplerNode = workflow.nodes.find((n: any) => samplerTypes.includes(n.type));
        if (!samplerNode) samplerNode = findSamplerHubFromWorkflow(workflow.nodes);
        if (samplerNode) {
            const result = extractSeedFromGraph(workflow.nodes, samplerNode);
            if (result) return result;
        }
        // BFS fallback
        const linkMap = buildWorkflowLinkMap(workflow.nodes);
        const hub = samplerNode || findSamplerHubFromWorkflow(workflow.nodes);
        const candidates = hub ? bfsUpstreamNodesWorkflow(hub, linkMap) : workflow.nodes;
        const params = extractParamsFromWorkflowNodes(candidates);
        return params.seed != null ? String(params.seed) : null;
    },
    positive(metadata: Metadata) {
        const workflow = metadata.workflow;
        if (!workflow || !Array.isArray(workflow.nodes)) return null;
        const prompts = extractPromptsFromGraph(workflow.nodes);
        return prompts.positive || null;
    },
    negative(metadata: Metadata) {
        const workflow = metadata.workflow;
        if (!workflow || !Array.isArray(workflow.nodes)) return null;
        const prompts = extractPromptsFromGraph(workflow.nodes);
        return prompts.negative || null;
    },
    sampler(metadata: Metadata) {
        const workflow = metadata.workflow;
        if (!workflow || !Array.isArray(workflow.nodes)) return null;
        for (const node of workflow.nodes) {
            if (node.type === 'KSampler' || node.type === 'SamplerCustom' || node.type === 'FaceDetailerPipe') {
                if (node.widgets_values && typeof node.widgets_values[4] === 'string') return node.widgets_values[4];
                if (node.inputs && node.inputs.sampler_name) return node.inputs.sampler_name;
            }
        }
        // Hub-first BFS fallback
        const hub = findSamplerHubFromWorkflow(workflow.nodes);
        const linkMap = buildWorkflowLinkMap(workflow.nodes);
        const candidates = hub ? bfsUpstreamNodesWorkflow(hub, linkMap) : workflow.nodes;
        const params = extractParamsFromWorkflowNodes(candidates);
        return params.sampler || null;
    },
    steps(metadata: Metadata) {
        const workflow = metadata.workflow;
        if (!workflow || !Array.isArray(workflow.nodes)) return null;
        for (const node of workflow.nodes) {
            if (node.type === 'KSampler' || node.type === 'SamplerCustom' || node.type === 'FaceDetailerPipe') {
                if (node.widgets_values && typeof node.widgets_values[2] === 'number') return String(node.widgets_values[2]);
                if (node.inputs && node.inputs.steps != null) return String(node.inputs.steps);
            }
        }
        // Hub-first BFS fallback
        const hub = findSamplerHubFromWorkflow(workflow.nodes);
        const linkMap = buildWorkflowLinkMap(workflow.nodes);
        const candidates = hub ? bfsUpstreamNodesWorkflow(hub, linkMap) : workflow.nodes;
        const params = extractParamsFromWorkflowNodes(candidates);
        return params.steps != null ? String(params.steps) : null;
    },
    cfg_scale(metadata: Metadata) {
        const workflow = metadata.workflow;
        if (!workflow || !Array.isArray(workflow.nodes)) return null;
        for (const node of workflow.nodes) {
            if (node.type === 'KSampler' || node.type === 'SamplerCustom' || node.type === 'FaceDetailerPipe') {
                if (node.widgets_values && typeof node.widgets_values[3] === 'number') return String(node.widgets_values[3]);
                if (node.inputs && node.inputs.cfg != null) return String(node.inputs.cfg);
            }
        }
        // Hub-first BFS fallback
        const hub = findSamplerHubFromWorkflow(workflow.nodes);
        const linkMap = buildWorkflowLinkMap(workflow.nodes);
        const candidates = hub ? bfsUpstreamNodesWorkflow(hub, linkMap) : workflow.nodes;
        const params = extractParamsFromWorkflowNodes(candidates);
        return params.cfg_scale != null ? String(params.cfg_scale) : null;
    }
};

