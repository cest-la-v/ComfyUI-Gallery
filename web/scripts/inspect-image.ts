/**
 * Full-pipeline image inspection tool.
 *
 * Runs the Python metadata extractor on each image, then feeds the result
 * through the TypeScript parser — mimicking exactly what the gallery does at
 * runtime.  Useful for exploring new images and building unit test fixtures.
 *
 * Usage:
 *   bun web/scripts/inspect-image.ts <image> [<image> ...]
 *   bun web/scripts/inspect-image.ts --source comfyui <image>
 *   bun web/scripts/inspect-image.ts --raw <image>        # raw metadata only, no parsing
 *   bun web/scripts/inspect-image.ts --json <image>       # machine-readable JSON output
 *
 * Run from the repo root (ComfyUI-Gallery/).
 */

import { parseComfyMetadata, detectMetadataSources } from '../src/metadata-parser/metadataParser';
import type { MetadataSource } from '../src/metadata-parser/metadataParser';
import { resolve } from 'path';

const EXTRACTOR = resolve(import.meta.dir, '../../metadata_extractor.py');

async function extractPython(imagePath: string): Promise<any> {
    const proc = Bun.spawn(['python3', EXTRACTOR, imagePath], {
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    const code = await proc.exited;
    if (code !== 0 || !out.trim()) {
        throw new Error(`Python extractor failed (exit ${code}): ${err.trim()}`);
    }
    const map = JSON.parse(out);
    return map[imagePath] ?? Object.values(map)[0];
}

function parseArgs(args: string[]) {
    let source: MetadataSource = 'auto';
    let rawOnly = false;
    let jsonMode = false;
    const images: string[] = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--source' && args[i + 1]) { source = args[++i] as MetadataSource; }
        else if (args[i] === '--raw') { rawOnly = true; }
        else if (args[i] === '--json') { jsonMode = true; }
        else if (!args[i].startsWith('--')) { images.push(args[i]); }
    }
    return { source, rawOnly, jsonMode, images };
}

async function main() {
    const { source, rawOnly, jsonMode, images } = parseArgs(process.argv.slice(2));

    if (images.length === 0) {
        console.error('Usage: bun web/scripts/inspect-image.ts [--source auto|civitai|comfyui] [--raw] [--json] <image> ...');
        process.exit(1);
    }

    const results: Record<string, any> = {};

    for (const img of images) {
        const absPath = resolve(img);
        const label = img;
        try {
            const metadata = await extractPython(absPath);

            if (rawOnly) {
                results[label] = metadata;
                if (!jsonMode) {
                    console.log(`\n── ${label} (raw metadata) ──`);
                    console.log(JSON.stringify(metadata, null, 2));
                }
                continue;
            }

            const sources = detectMetadataSources(metadata);
            const parsed = parseComfyMetadata(metadata, source);

            results[label] = { sources, parsed, metadata };
            if (!jsonMode) {
                console.log(`\n── ${label} ──`);
                console.log(`Sources: A1111=${sources.hasA1111} prompt=${sources.hasPrompt} workflow=${sources.hasWorkflow}`);
                console.log(JSON.stringify(parsed, null, 2));
            }
        } catch (err) {
            results[label] = { error: String(err) };
            if (!jsonMode) console.error(`Error processing ${label}:`, err);
        }
    }

    if (jsonMode) {
        console.log(JSON.stringify(rawOnly ? results : Object.fromEntries(
            Object.entries(results).map(([k, v]) => [k, (v as any).parsed ?? v])
        ), null, 2));
    }
}

main().catch(err => { console.error(err); process.exit(1); });
