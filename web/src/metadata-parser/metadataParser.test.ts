/**
 * Integration snapshot tests for the full metadata parser pipeline.
 *
 * Fixtures are synthetic — technical params match real example images but
 * prompts are replaced with neutral/generic text.
 *
 * Coverage:
 *  - A1111 PNG: 8 distinct sampler/scheduler format variants
 *  - A1111 JPEG: ExifIFD.UserComment path
 *  - ComfyUI prompt-only (no parameters)
 *  - Mixed: ComfyUI image with both A1111 parameters + prompt/workflow
 *  - detectMetadataSources: correct flags for all source types
 *  - Model normalization: ComfyUI ckpt_name vs A1111 model stem
 *  - Sampler/scheduler normalization: ComfyUI snake_case → display name
 *  - Extras passthrough: VAE, Hires, ADetailer, Civitai TI, etc.
 */

import { describe, test, expect } from 'bun:test';
import { parseComfyMetadata, detectMetadataSources } from './metadataParser';

// ── Desensitized A1111 fixture strings ─────────────────────────────────────

const A = {
    /** DPM++ SDE + separate Schedule type: Karras */
    dpmpp_sde_karras_separate: `a scenic photo of mountains at dusk
Negative prompt: low quality, blurry, watermark
Steps: 6, Sampler: DPM++ SDE, Schedule type: Karras, CFG scale: 2, Seed: 1582036678, Size: 832x1216, Model hash: 609fde646e, Model: RealVisXL_V4.0, Denoising strength: 0.52, Version: v1.7.0`,

    /** DPM++ SDE Karras — combined field. VAE, Hires extras. */
    dpmpp_sde_karras_combined_vae: `a portrait photo with soft studio lighting
Negative prompt: low quality, worst quality, blurry
Steps: 6, Sampler: DPM++ SDE Karras, CFG scale: 1.5, Seed: 983791494, Size: 512x768, Model hash: 0928b30687, Model: RVHYPO, VAE hash: e9ed949371, VAE: vae-ft-mse-840000-ema-pruned.safetensors, Denoising strength: 0.35, Hires upscale: 2, Hires steps: 2, Hires upscaler: 4x_NMKD-Superscale-SP_178000_G, Version: v1.7.0`,

    /** DPM++ 2M + separate Karras */
    dpmpp_2m_karras_separate: `an indoor scene with cinematic lighting
Negative prompt: low quality, blurry
Steps: 10, Sampler: DPM++ 2M, Schedule type: Karras, CFG scale: 7, Seed: 736727295, Size: 1248x1824, Model hash: eeaea4f37c, Model: dreamshaper_8, Denoising strength: 0.52, Version: v1.7.0`,

    /** Custom sampler + Schedule type: Automatic */
    custom_sampler_automatic: `a forest path at sunrise
Negative prompt: low quality
Steps: 24, Sampler: Cyberdelia Ralston (RK2), Schedule type: Automatic, CFG scale: 4.5, Seed: 14533328, Size: 832x1216, Model hash: 6ce0161689, Model: v1-5-pruned-emaonly`,

    /** DPM++ 2M SDE + separate Karras + heavy Civitai extras */
    dpmpp_2m_sde_civitai_extras: `an architectural scene with dramatic lighting
Negative prompt: CyberRealistic_Negative_New
Steps: 32, Sampler: DPM++ 2M SDE, Schedule type: Karras, CFG scale: 7, Seed: 96817171, Size: 704x1024, Model hash: f4d3a85a81, Model: CyberRealistic_FINAL_FP32, Denoising strength: 0.25, RNG: CPU, Hires Module 1: Use same choices, Hires CFG Scale: 7, Hires upscale: 1.5, Hires steps: 12, Hires upscaler: 4x_NickelbackFS_72000_G, TI: CyberRealistic_Negative_New, Version: neo`,

    /** DPM++ 2M Karras — combined (no separate Schedule type) */
    dpmpp_2m_karras_combined: `a misty mountain valley
Negative prompt: low quality
Steps: 34, Sampler: DPM++ 2M Karras, CFG scale: 5.0, Seed: 838378400301630, Size: 832x1216, Clip skip: 2, Model hash: AEA4EC6C4D, Model: AnythingXL_xl, Version: v1.7.0`,

    /** Euler a — no scheduler */
    euler_a_no_scheduler: `a fantasy scene with soft glowing light
Negative prompt: low quality, ugly
Steps: 30, Sampler: Euler a, CFG scale: 3.0, Seed: 24492053, Size: 832x1216, Clip skip: 2, Model hash: 88177d224c, Model: JANKUv7`,

    /** DPM++ 3M SDE Karras — combined + ADetailer extras */
    dpmpp_3m_sde_karras_adetailer: `a dramatic cinematic landscape
Negative prompt: low quality, worst quality
Steps: 4, Sampler: DPM++ 3M SDE Karras, CFG scale: 2, Seed: 3346112079, Size: 768x1024, Model hash: fdbe56354b, Model: DreamShaperXL_Turbo-Lightning, Denoising strength: 0.52, Clip skip: 2, RNG: CPU, ADetailer model: mediapipe_face_mesh_eyes_only, ADetailer prompt: "a person outdoors", ADetailer confidence: 0.3, Version: v1.7.0`,
};

/** Minimal ComfyUI prompt JSON matching the structure of anima-* examples */
const COMFYUI_PROMPT = {
    '1': {
        class_type: 'UNETLoader',
        inputs: { unet_name: 'fictional-model.safetensors', weight_dtype: 'default' },
        _meta: { title: 'Load Diffusion Model' },
    },
    '2': {
        class_type: 'CLIPLoader',
        inputs: { clip_name: 'clip.safetensors', type: 'flux' },
    },
    '3': {
        class_type: 'CLIPTextEncode',
        inputs: {
            text: 'low quality, blurry, watermark',
            clip: ['2', 1],
        },
        _meta: { title: 'CLIP Text Encode (Negative Prompt)' },
    },
    '4': {
        class_type: 'CLIPTextEncode',
        inputs: {
            text: 'a scenic landscape with mountains and clear blue sky, photorealistic',
            clip: ['2', 0],
        },
        _meta: { title: 'CLIP Text Encode (Positive Prompt)' },
    },
    '5': {
        class_type: 'KSampler',
        inputs: {
            seed: 772478975987357,
            steps: 25,
            cfg: 4.0,
            sampler_name: 'dpmpp_sde',
            scheduler: 'karras',
            denoise: 1.0,
            model: ['1', 0],
            positive: ['4', 0],
            negative: ['3', 0],
            latent_image: ['6', 0],
        },
        _meta: { title: 'KSampler' },
    },
};

/** LoRA-chained ComfyUI prompt: model → LoraLoader → KSampler */
const COMFYUI_PROMPT_WITH_LORA = {
    ...COMFYUI_PROMPT,
    '7': {
        class_type: 'LoraLoader',
        inputs: {
            lora_name: 'style-lora.safetensors',
            strength_model: 1.0,
            strength_clip: 1.0,
            model: ['1', 0],
            clip: ['2', 0],
        },
        _meta: { title: 'Load LoRA' },
    },
    '5': {
        ...COMFYUI_PROMPT['5'],
        inputs: {
            ...COMFYUI_PROMPT['5'].inputs,
            model: ['7', 0],
        },
    },
};

// ── Helper to build a metadata object ──────────────────────────────────────

function a1111Meta(parameters: string) {
    return { parameters, fileinfo: { filename: 'test.png', resolution: '512x512', size: '1 MB', date: '2024-01-01' } };
}

function comfyMeta(prompt: any) {
    return { prompt, fileinfo: { filename: 'test.png', resolution: '1024x1024', size: '2 MB', date: '2024-01-01' } };
}

function jpegMeta(userComment: string) {
    return { ExifIFD: { UserComment: userComment }, fileinfo: { filename: 'test.jpg', resolution: '512x768', size: '800 KB', date: '2024-01-01' } };
}

// ── detectMetadataSources ───────────────────────────────────────────────────

describe('detectMetadataSources', () => {
    test('A1111 PNG: hasA1111=true, others=false', () => {
        const src = detectMetadataSources(a1111Meta(A.dpmpp_sde_karras_separate));
        expect(src.hasA1111).toBe(true);
        expect(src.hasPrompt).toBe(false);
        expect(src.hasWorkflow).toBe(false);
    });

    test('A1111 JPEG (UserComment): hasA1111=true', () => {
        const src = detectMetadataSources(jpegMeta(A.dpmpp_sde_karras_combined_vae));
        expect(src.hasA1111).toBe(true);
        expect(src.hasPrompt).toBe(false);
    });

    test('ComfyUI-only: hasPrompt=true, hasA1111=false', () => {
        const src = detectMetadataSources(comfyMeta(COMFYUI_PROMPT));
        expect(src.hasA1111).toBe(false);
        expect(src.hasPrompt).toBe(true);
        expect(src.hasWorkflow).toBe(false);
    });

    test('Mixed (ComfyUI + A1111 params): all flags set', () => {
        const meta = { ...a1111Meta(A.dpmpp_2m_karras_combined), prompt: COMFYUI_PROMPT, workflow: { nodes: [] } };
        const src = detectMetadataSources(meta);
        expect(src.hasA1111).toBe(true);
        expect(src.hasPrompt).toBe(true);
        expect(src.hasWorkflow).toBe(true);
    });

    test('Empty metadata: all false', () => {
        const src = detectMetadataSources({} as any);
        expect(src.hasA1111).toBe(false);
        expect(src.hasPrompt).toBe(false);
        expect(src.hasWorkflow).toBe(false);
    });
});

// ── parseComfyMetadata — A1111 PNG ─────────────────────────────────────────

describe('parseComfyMetadata — A1111 PNG formats', () => {
    test('DPM++ SDE + separate Karras', () => {
        const r = parseComfyMetadata(a1111Meta(A.dpmpp_sde_karras_separate));
        expect(r['Sampler']).toBe('DPM++ SDE');
        expect(r['Scheduler']).toBe('Karras');
        expect(r['Model']).toBe('RealVisXL_V4.0');
        expect(r['Model Hash']).toBe('609fde646e');
        expect(r['Steps']).toBe('6');
        expect(r['CFG Scale']).toBe('2');
        expect(r['Seed']).toBe('1582036678');
    });

    test('Combined "DPM++ SDE Karras" splits correctly at output', () => {
        const r = parseComfyMetadata(a1111Meta(A.dpmpp_sde_karras_combined_vae));
        expect(r['Sampler']).toBe('DPM++ SDE');
        expect(r['Scheduler']).toBe('Karras');
        expect(r['Model']).toBe('RVHYPO');
    });

    test('DPM++ 2M + Karras', () => {
        const r = parseComfyMetadata(a1111Meta(A.dpmpp_2m_karras_separate));
        expect(r['Sampler']).toBe('DPM++ 2M');
        expect(r['Scheduler']).toBe('Karras');
        expect(r['Model']).toBe('dreamshaper_8');
    });

    test('Custom sampler + Automatic scheduler pass through as-is', () => {
        const r = parseComfyMetadata(a1111Meta(A.custom_sampler_automatic));
        expect(r['Sampler']).toBe('Cyberdelia Ralston (RK2)');
        expect(r['Scheduler']).toBe('Automatic');
    });

    test('DPM++ 2M Karras combined (from ComfyUI-generated image with A1111 params)', () => {
        const r = parseComfyMetadata(a1111Meta(A.dpmpp_2m_karras_combined));
        expect(r['Sampler']).toBe('DPM++ 2M');
        expect(r['Scheduler']).toBe('Karras');
        expect(r['Model']).toBe('AnythingXL_xl');
        expect(r['Model Hash']).toBe('AEA4EC6C4D');
    });

    test('Euler a — no scheduler → empty string', () => {
        const r = parseComfyMetadata(a1111Meta(A.euler_a_no_scheduler));
        expect(r['Sampler']).toBe('Euler a');
        expect(r['Scheduler']).toBe('');
        expect(r['Model']).toBe('JANKUv7');
    });

    test('DPM++ 3M SDE Karras combined', () => {
        const r = parseComfyMetadata(a1111Meta(A.dpmpp_3m_sde_karras_adetailer));
        expect(r['Sampler']).toBe('DPM++ 3M SDE');
        expect(r['Scheduler']).toBe('Karras');
        expect(r['Model']).toBe('DreamShaperXL_Turbo-Lightning');
    });
});

// ── parseComfyMetadata — extras passthrough ─────────────────────────────────

describe('parseComfyMetadata — extras passthrough', () => {
    test('VAE and VAE Hash surfaced as top-level display fields', () => {
        const r = parseComfyMetadata(a1111Meta(A.dpmpp_sde_karras_combined_vae));
        expect(r['Vae']).toBe('vae-ft-mse-840000-ema-pruned.safetensors');
        expect(r['Vae Hash']).toBe('e9ed949371');
    });

    test('Hires fields surfaced', () => {
        const r = parseComfyMetadata(a1111Meta(A.dpmpp_sde_karras_combined_vae));
        expect(r['Hires Upscale']).toBe('2');
        expect(r['Hires Upscaler']).toBe('4x_NMKD-Superscale-SP_178000_G');
    });

    test('ADetailer fields surfaced', () => {
        const r = parseComfyMetadata(a1111Meta(A.dpmpp_3m_sde_karras_adetailer));
        expect(r['Adetailer Model']).toBe('mediapipe_face_mesh_eyes_only');
        expect(r['Adetailer Confidence']).toBe('0.3');
    });

    test('Civitai TI / RNG / Version surfaced', () => {
        const r = parseComfyMetadata(a1111Meta(A.dpmpp_2m_sde_civitai_extras));
        expect(r['Rng']).toBe('CPU');
        expect(r['Ti']).toBe('CyberRealistic_Negative_New');
        expect(r['Version']).toBe('neo');
    });
});

// ── parseComfyMetadata — A1111 JPEG (UserComment path) ─────────────────────

describe('parseComfyMetadata — A1111 JPEG via ExifIFD.UserComment', () => {
    test('model, sampler, scheduler correctly parsed', () => {
        const r = parseComfyMetadata(jpegMeta(A.dpmpp_sde_karras_combined_vae));
        expect(r['Model']).toBe('RVHYPO');
        expect(r['Sampler']).toBe('DPM++ SDE');
        expect(r['Scheduler']).toBe('Karras');
        expect(r['Model Hash']).toBe('0928b30687');
    });

    test('file info still populated', () => {
        const r = parseComfyMetadata(jpegMeta(A.dpmpp_sde_karras_combined_vae));
        expect(r['Filename']).toBe('test.jpg');
    });
});

// ── parseComfyMetadata — source toggle ─────────────────────────────────────

describe('parseComfyMetadata — source toggle', () => {
    const mixedMeta = {
        ...a1111Meta(A.dpmpp_2m_karras_combined),
        prompt: COMFYUI_PROMPT,
    };

    test('"civitai" source → uses A1111 only', () => {
        const r = parseComfyMetadata(mixedMeta, 'civitai');
        expect(r['Model']).toBe('AnythingXL_xl');
        expect(r['Sampler']).toBe('DPM++ 2M');
    });

    test('"comfyui" source → uses prompt only', () => {
        const r = parseComfyMetadata(mixedMeta, 'comfyui');
        expect(r['Sampler']).toBe('DPM++ SDE');   // from COMFYUI_PROMPT KSampler: dpmpp_sde normalized
        expect(r['Scheduler']).toBe('Karras');     // from KSampler: karras normalized
        expect(r['Model']).toBe('fictional-model'); // from UNETLoader, extension stripped
    });

    test('"auto" source → A1111 wins (first pass)', () => {
        const r = parseComfyMetadata(mixedMeta, 'auto');
        expect(r['Model']).toBe('AnythingXL_xl');
    });
});

// ── parseComfyMetadata — ComfyUI prompt-only ────────────────────────────────

describe('parseComfyMetadata — ComfyUI prompt extraction', () => {
    test('model extracted from UNETLoader, extension stripped', () => {
        const r = parseComfyMetadata(comfyMeta(COMFYUI_PROMPT));
        expect(r['Model']).toBe('fictional-model');
    });

    test('sampler normalized from snake_case', () => {
        const r = parseComfyMetadata(comfyMeta(COMFYUI_PROMPT));
        expect(r['Sampler']).toBe('DPM++ SDE');
    });

    test('scheduler normalized from snake_case', () => {
        const r = parseComfyMetadata(comfyMeta(COMFYUI_PROMPT));
        expect(r['Scheduler']).toBe('Karras');
    });

    test('positive prompt extracted from CLIPTextEncode', () => {
        const r = parseComfyMetadata(comfyMeta(COMFYUI_PROMPT));
        expect(r['Positive Prompt']).toContain('scenic landscape');
    });

    test('negative prompt extracted from CLIPTextEncode', () => {
        const r = parseComfyMetadata(comfyMeta(COMFYUI_PROMPT));
        expect(r['Negative Prompt']).toContain('low quality');
    });

    test('steps extracted', () => {
        const r = parseComfyMetadata(comfyMeta(COMFYUI_PROMPT));
        expect(r['Steps']).toBe('25');
    });

    test('LoRA-chained model still resolves UNETLoader', () => {
        const r = parseComfyMetadata(comfyMeta(COMFYUI_PROMPT_WITH_LORA));
        expect(r['Model']).toBe('fictional-model');
    });

    test('no A1111 data → model hash absent', () => {
        const r = parseComfyMetadata(comfyMeta(COMFYUI_PROMPT));
        expect(r['Model Hash']).toBeUndefined();
    });
});

// ── Model normalization: ComfyUI vs A1111 produce same stem ────────────────

describe('Model name normalization — group-by compatibility', () => {
    test('ComfyUI ckpt_name with extension normalizes to same stem as A1111', () => {
        // A1111 uses the stem; ComfyUI emits full filename — they must compare equal
        const comfyR = parseComfyMetadata(comfyMeta({
            '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'dreamshaper_8.safetensors' } },
            '2': { class_type: 'KSampler', inputs: { seed: 1, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['1', 0], positive: ['3', 0], negative: ['3', 0], latent_image: ['4', 0] } },
            '3': { class_type: 'CLIPTextEncode', inputs: { text: 'test prompt', clip: ['1', 1] } },
            '4': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
        }));
        const a1111R = parseComfyMetadata(a1111Meta(A.dpmpp_2m_karras_separate));
        expect(comfyR['Model']).toBe('dreamshaper_8');   // extension stripped
        expect(a1111R['Model']).toBe('dreamshaper_8');   // already a stem
    });

    test('ComfyUI path prefix stripped', () => {
        const r = parseComfyMetadata(comfyMeta({
            '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'checkpoints/mymodel.safetensors' } },
            '2': { class_type: 'KSampler', inputs: { seed: 1, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['1', 0], positive: ['3', 0], negative: ['3', 0], latent_image: ['4', 0] } },
            '3': { class_type: 'CLIPTextEncode', inputs: { text: 'a test', clip: ['1', 1] } },
            '4': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
        }));
        expect(r['Model']).toBe('mymodel');
    });
});

// ── Sampler/Scheduler normalization — group-by compatibility ────────────────

describe('Sampler/Scheduler normalization — group-by compatibility', () => {
    test('ComfyUI dpmpp_sde → display "DPM++ SDE" matches A1111 "DPM++ SDE"', () => {
        const comfyR = parseComfyMetadata(comfyMeta(COMFYUI_PROMPT));
        const a1111R = parseComfyMetadata(a1111Meta(A.dpmpp_sde_karras_separate));
        expect(comfyR['Sampler']).toBe(a1111R['Sampler']);
    });

    test('ComfyUI karras → display "Karras" matches A1111 "Karras"', () => {
        const comfyR = parseComfyMetadata(comfyMeta(COMFYUI_PROMPT));
        const a1111R = parseComfyMetadata(a1111Meta(A.dpmpp_sde_karras_separate));
        expect(comfyR['Scheduler']).toBe(a1111R['Scheduler']);
    });
});

// ── Edge cases ───────────────────────────────────────────────────────────────

describe('parseComfyMetadata — edge cases', () => {
    test('null metadata returns empty fileinfo fields', () => {
        const r = parseComfyMetadata(null as any);
        expect(r).toEqual({});
    });

    test('empty metadata returns all-empty strings', () => {
        const r = parseComfyMetadata({ fileinfo: { filename: 'x', resolution: '', size: '', date: '' } } as any);
        expect(r['Model']).toBe('');
        expect(r['Sampler']).toBe('');
    });

    test('positive === negative heuristic resolves to empty negative', () => {
        // If both prompts resolve to the same string, negative should be cleared
        const raw = `some prompt
Negative prompt: some prompt
Steps: 10, Sampler: Euler, CFG scale: 7, Seed: 1, Size: 512x512, Model: test`;
        const r = parseComfyMetadata(a1111Meta(raw));
        // The heuristic should try to find a better negative; with no candidates it clears it
        expect(r['Positive Prompt']).toBe('some prompt');
        expect(r['Negative Prompt']).toBe('');
    });
});
