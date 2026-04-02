/**
 * TypeScript metadata parser CLI.
 *
 * Reads a metadata JSON object (as produced by metadata_extractor.py) from a
 * file argument or stdin, then prints the fully-parsed display record.
 *
 * Usage:
 *   bun src/metadata-parser/cli.ts <metadata.json>        # from file
 *   python metadata_extractor.py image.png | \
 *     bun src/metadata-parser/cli.ts                       # piped
 *   bun src/metadata-parser/cli.ts --source comfyui <metadata.json>
 *
 * The input JSON may be a single metadata object OR a map of { path: metadata }
 * as produced by the Python CLI when multiple files are given.
 */

import { parseComfyMetadata, detectMetadataSources } from './metadataParser';
import type { MetadataSource } from './metadataParser';

async function readInput(filePath?: string): Promise<string> {
    if (filePath) {
        return await Bun.file(filePath).text();
    }
    return await new Response(Bun.stdin.stream()).text();
}

function parseArgs(args: string[]): { filePath?: string; source: MetadataSource } {
    let source: MetadataSource = 'auto';
    let filePath: string | undefined;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--source' && args[i + 1]) {
            source = args[++i] as MetadataSource;
        } else if (!args[i].startsWith('--')) {
            filePath = args[i];
        }
    }
    return { filePath, source };
}

async function main() {
    const { filePath, source } = parseArgs(process.argv.slice(2));
    const raw = await readInput(filePath);
    const json = JSON.parse(raw);

    // Accept either a bare metadata object or a { path: metadata } map from the Python CLI
    const entries: Array<[string, any]> = (
        typeof json === 'object' && json !== null &&
        !('fileinfo' in json || 'parameters' in json || 'prompt' in json || 'workflow' in json)
    )
        ? Object.entries(json)          // multi-file map
        : [['<metadata>', json]];       // single object

    for (const [label, metadata] of entries) {
        const sources = detectMetadataSources(metadata);
        const parsed = parseComfyMetadata(metadata, source);
        console.log(`\n── ${label} ──`);
        console.log(`Sources detected: A1111=${sources.hasA1111} prompt=${sources.hasPrompt} workflow=${sources.hasWorkflow}`);
        console.log(JSON.stringify(parsed, null, 2));
    }
}

main().catch(err => { console.error(err); process.exit(1); });
