/**
 * A1111-compatible parameters PNG text chunk parser.
 *
 * Parses the `parameters` text chunk written by Automatic1111, ComfyUI (with our
 * generation context patch), and most other SD frontends.
 *
 * Format:
 *   <positive prompt>
 *   Negative prompt: <negative prompt>
 *   Steps: 20, Sampler: euler, Schedule type: karras, CFG scale: 7, Seed: 42, Model: v1-5
 *
 * The "Negative prompt:" and params lines are optional.
 */

import type { MetadataExtractionPass } from './metadataParser';

interface A1111Fields {
    positive: string | null;
    negative: string | null;
    steps: string | null;
    sampler: string | null;
    scheduler: string | null;
    cfg_scale: string | null;
    seed: string | null;
    model: string | null;
    model_hash: string | null;
    loras: string | null;
    extras: Record<string, string>;
}

/** Key aliases from A1111 param line → our internal field names */
const PARAM_KEY_MAP: Record<string, keyof A1111Fields> = {
    'steps': 'steps',
    'sampler': 'sampler',
    'sampler name': 'sampler',
    'schedule type': 'scheduler',
    'scheduler': 'scheduler',
    'cfg scale': 'cfg_scale',
    'cfg': 'cfg_scale',
    'seed': 'seed',
    'model': 'model',
    'model hash': 'model_hash',
    'lora hashes': 'loras',
};

/**
 * Scheduler display-name suffixes that may appear at the end of the A1111 combined
 * Sampler field (e.g. "DPM++ 3M SDE Karras" → sampler="DPM++ 3M SDE", scheduler="Karras").
 * Longer entries are tested first so multi-word suffixes match before single words.
 */
const SCHEDULER_SUFFIX_MAP: Array<[string, string]> = [
    ['sgm uniform',      'SGM Uniform'],
    ['ddim uniform',     'DDIM Uniform'],
    ['linear quadratic', 'Linear Quadratic'],
    ['exponential',      'Exponential'],
    ['karras',           'Karras'],
    ['simple',           'Simple'],
    ['beta',             'Beta'],
    ['normal',           'Normal'],
];

/**
 * Split a combined A1111 Sampler string (e.g. "DPM++ 3M SDE Karras") into
 * separate sampler and scheduler values.
 */
function splitA1111SamplerScheduler(combined: string): { sampler: string; scheduler: string | null } {
    const lower = combined.toLowerCase().trim();
    for (const [suffix, display] of SCHEDULER_SUFFIX_MAP) {
        if (lower === suffix) return { sampler: '', scheduler: display };
        if (lower.endsWith(' ' + suffix)) {
            return {
                sampler: combined.slice(0, combined.length - suffix.length - 1).trim(),
                scheduler: display,
            };
        }
    }
    return { sampler: combined, scheduler: null };
}

/**
 * Split a params line (e.g. `Steps: 20, Sampler: euler, Model: "some, model"`)
 * into key-value pairs, respecting quoted strings.
 */
function splitParamLine(line: string): Array<[string, string]> {
    const result: Array<[string, string]> = [];
    // Match: Key: "quoted value" or Key: unquoted value (no comma inside)
    const re = /([^:,]+):\s*(?:"([^"]*)"|((?:[^,"]|"[^"]*")*))(?:,|$)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(line)) !== null) {
        const key = match[1].trim().toLowerCase();
        const value = (match[2] !== undefined ? match[2] : match[3] ?? '').trim();
        if (key && value) {
            result.push([key, value]);
        }
    }
    return result;
}

/**
 * Detect whether a line looks like an A1111 params line.
 * Must contain at least one "Key: value" pair with a known key.
 */
function isParamsLine(line: string): boolean {
    const lower = line.toLowerCase();
    return Object.keys(PARAM_KEY_MAP).some(k => {
        const idx = lower.indexOf(k + ':');
        return idx !== -1 && (idx === 0 || lower[idx - 2] === ',');
    });
}

/**
 * Parse an A1111 `parameters` text chunk into structured fields.
 * Returns null if the string doesn't look like A1111 format.
 */
export function parseA1111Parameters(raw: string): A1111Fields | null {
    if (!raw || typeof raw !== 'string') return null;

    const lines = raw.split('\n');
    if (lines.length === 0) return null;

    let paramsLineIdx = -1;
    let negativeLineIdx = -1;

    // Walk from the bottom to find the params line (last line with Key: value pattern)
    for (let i = lines.length - 1; i >= 0; i--) {
        const trimmed = lines[i].trim();
        if (paramsLineIdx === -1 && isParamsLine(trimmed)) {
            paramsLineIdx = i;
        }
        if (trimmed.startsWith('Negative prompt:')) {
            negativeLineIdx = i;
            break;
        }
    }

    // Need either a params line or a "Negative prompt:" marker to be A1111-like.
    // Some images carry positive+negative prompts in `parameters` but no generation
    // params line (e.g. ComfyUI nodes that write only the prompt text). Still useful.
    if (paramsLineIdx === -1 && negativeLineIdx === -1) return null;

    const fields: A1111Fields = {
        positive: null,
        negative: null,
        steps: null,
        sampler: null,
        scheduler: null,
        cfg_scale: null,
        seed: null,
        model: null,
        model_hash: null,
        loras: null,
        extras: {},
    };

    // Parse params line (only if present)
    if (paramsLineIdx !== -1) {
    const pairs = splitParamLine(lines[paramsLineIdx].trim());
    for (const [key, value] of pairs) {
        const fieldName = PARAM_KEY_MAP[key];
        if (fieldName) {
            if (fieldName === 'extras') continue; // shouldn't happen, guard only
            if ((fields[fieldName] as string | null) === null) {
                (fields[fieldName] as string) = value;
            }
        } else {
            // Store unrecognized A1111 extension fields for passthrough display
            fields.extras[key] = value;
        }
    }

    // Split combined "Sampler: DPM++ 3M SDE Karras" into sampler + scheduler.
    // Always strip the scheduler suffix from the sampler field, even if Schedule type is present.
    if (fields.sampler) {
        const { sampler, scheduler } = splitA1111SamplerScheduler(fields.sampler);
        fields.sampler = sampler || null;
        if (scheduler && !fields.scheduler) fields.scheduler = scheduler;
    }
    }

    // Extract negative prompt
    if (negativeLineIdx !== -1) {
        const negLine = lines[negativeLineIdx].trim();
        const negText = negLine.replace(/^Negative prompt:\s*/i, '').trim();
        // Collect continuation lines between negativeLineIdx and paramsLineIdx
        const negParts = [negText];
        // Collect continuation lines up to params line (or end of string if no params line)
        const negEnd = paramsLineIdx !== -1 ? paramsLineIdx : lines.length;
        for (let i = negativeLineIdx + 1; i < negEnd; i++) {
            negParts.push(lines[i]);
        }
        fields.negative = negParts.join('\n').trim() || null;
    }

    // Extract positive prompt (everything above the negative prompt line or params line)
    const positiveEnd = negativeLineIdx !== -1 ? negativeLineIdx : paramsLineIdx;
    const positiveLines = lines.slice(0, positiveEnd);
    fields.positive = positiveLines.join('\n').trim() || null;

    return fields;
}

/**
 * Extraction pass that reads the A1111 `parameters` PNG text chunk.
 * This is inserted as the first (highest-priority) pass in metadataParser.ts.
 */
export const extractByA1111: MetadataExtractionPass = {
    positive(metadata: any): string | null {
        const parsed = _getParsed(metadata);
        return parsed?.positive ?? null;
    },
    negative(metadata: any): string | null {
        const parsed = _getParsed(metadata);
        return parsed?.negative ?? null;
    },
    steps(metadata: any): string | null {
        const parsed = _getParsed(metadata);
        return parsed?.steps ?? null;
    },
    sampler(metadata: any): string | null {
        const parsed = _getParsed(metadata);
        return parsed?.sampler ?? null;
    },
    scheduler(metadata: any): string | null {
        const parsed = _getParsed(metadata);
        return parsed?.scheduler ?? null;
    },
    cfg_scale(metadata: any): string | null {
        const parsed = _getParsed(metadata);
        return parsed?.cfg_scale ?? null;
    },
    seed(metadata: any): string | null {
        const parsed = _getParsed(metadata);
        return parsed?.seed ?? null;
    },
    model(metadata: any): string | null {
        const parsed = _getParsed(metadata);
        return parsed?.model ?? null;
    },
    loras(metadata: any): string | null {
        const parsed = _getParsed(metadata);
        return parsed?.loras ?? null;
    },
};

/** Expose model_hash and extras for use in metadataParser.ts */
export function hasA1111Data(metadata: any): boolean {
    return _getParsed(metadata) !== null;
}

export function getA1111ModelHash(metadata: any): string | null {
    return _getParsed(metadata)?.model_hash ?? null;
}

export function getA1111Extras(metadata: any): Record<string, string> {
    return _getParsed(metadata)?.extras ?? {};
}

// Cache parsed result per metadata object to avoid re-parsing for each field.
// Null results are also cached so repeated calls on non-A1111 objects are O(1).
const _NONE = Symbol('none');
const _cache = new WeakMap<object, A1111Fields | null | typeof _NONE>();

function _getParsed(metadata: any): A1111Fields | null {
    if (!metadata || typeof metadata !== 'object') return null;
    if (_cache.has(metadata)) {
        const cached = _cache.get(metadata)!;
        return cached === _NONE ? null : cached as A1111Fields | null;
    }

    // Primary: PNG parameters text chunk
    let raw: string | null = (typeof metadata.parameters === 'string') ? metadata.parameters : null;

    // Fallback: JPEG Exif.UserComment decoded by the Python extractor
    if (!raw) {
        const uc = metadata?.Exif?.UserComment ?? metadata?.ExifIFD?.UserComment;
        if (typeof uc === 'string' && uc.includes('Steps:')) raw = uc;
    }

    if (!raw) { _cache.set(metadata, _NONE); return null; }
    const result = parseA1111Parameters(raw);
    _cache.set(metadata, result ?? _NONE);
    return result;
}
