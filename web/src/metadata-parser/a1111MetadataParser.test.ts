import { describe, test, expect } from 'bun:test';
import { parseA1111Parameters, extractByA1111, getA1111ModelHash, getA1111Extras } from './a1111MetadataParser';

// ── Desensitized fixtures — technical params are real; prompts are synthetic ─

/** Format A: separate Schedule type key */
const FMT_A_SCHEDULE_TYPE = `a scenic photo of mountains at dusk
Negative prompt: low quality, blurry, watermark
Steps: 6, Sampler: DPM++ SDE, Schedule type: Karras, CFG scale: 2, Seed: 1582036678, Size: 832x1216, Model hash: 609fde646e, Model: RealVisXL_V4.0, Denoising strength: 0.52, Version: v1.7.0`;

/** Format B: combined Sampler+Scheduler in one field */
const FMT_B_COMBINED_SAMPLER = `a portrait photo with soft studio lighting
Negative prompt: low quality, worst quality, blurry, watermark
Steps: 6, Sampler: DPM++ SDE Karras, CFG scale: 1.5, Seed: 983791494, Size: 512x768, Model hash: 0928b30687, Model: RVHYPO, VAE hash: e9ed949371, VAE: vae-ft-mse-840000-ema-pruned.safetensors, Denoising strength: 0.35, Hires upscale: 2, Hires steps: 2, Hires upscaler: 4x_NMKD-Superscale-SP_178000_G, Version: v1.7.0`;

/** Format C: separate Schedule type, different model */
const FMT_C_DPM2M_SCHEDULE = `an indoor scene with cinematic lighting
Negative prompt: low quality, blurry
Steps: 10, Sampler: DPM++ 2M, Schedule type: Karras, CFG scale: 7, Seed: 736727295, Size: 1248x1824, Model hash: eeaea4f37c, Model: dreamshaper_8, Denoising strength: 0.52, Version: v1.7.0`;

/** Format D: custom sampler + Schedule type: Automatic */
const FMT_D_CUSTOM_SAMPLER = `a forest landscape at sunrise
Negative prompt: low quality
Steps: 24, Sampler: Cyberdelia Ralston (RK2), Schedule type: Automatic, CFG scale: 4.5, Seed: 14533328, Size: 832x1216, Model hash: 6ce0161689, Model: v1-5-pruned-emaonly`;

/** Format E: DPM++ 2M SDE + separate Karras + multiple Civitai extras */
const FMT_E_DPM2MSDE_CIVITAI = `an architectural interior with dramatic shadows
Negative prompt: CyberRealistic_Negative_New
Steps: 32, Sampler: DPM++ 2M SDE, Schedule type: Karras, CFG scale: 7, Seed: 96817171, Size: 704x1024, Model hash: f4d3a85a81, Model: CyberRealistic_FINAL_FP32, Denoising strength: 0.25, RNG: CPU, Hires Module 1: Use same choices, Hires CFG Scale: 7, Hires upscale: 1.5, Hires steps: 12, Hires upscaler: 4x_NickelbackFS_72000_G, TI: CyberRealistic_Negative_New, Version: neo`;

/** Format F: DPM++ 2M Karras — combined 3-word scheduler suffix */
const FMT_F_DPM2M_KARRAS_COMBINED = `a misty mountain landscape
Negative prompt: low quality
Steps: 34, Sampler: DPM++ 2M Karras, CFG scale: 5.0, Seed: 838378400301630, Size: 832x1216, Clip skip: 2, Model hash: AEA4EC6C4D, Model: AnythingXL_xl, Version: v1.7.0`;

/** Format G: Euler a, no scheduler */
const FMT_G_EULER_A = `a fantasy scene with soft magical lighting
Negative prompt: low quality, ugly, deformed
Steps: 30, Sampler: Euler a, CFG scale: 3.0, Seed: 24492053, Size: 832x1216, Clip skip: 2, Model hash: 88177d224c, Model: JANKUv7`;

/** Format H: DPM++ 3M SDE Karras — combined with 3M */
const FMT_H_DPM3M_SDE_KARRAS = `a dramatic cinematic shot
Negative prompt: low quality, worst quality
Steps: 4, Sampler: DPM++ 3M SDE Karras, CFG scale: 2, Seed: 3346112079, Size: 768x1024, Model hash: fdbe56354b, Model: DreamShaperXL_Turbo-Lightning, Denoising strength: 0.52, Clip skip: 2, RNG: CPU, ADetailer model: mediapipe_face_mesh_eyes_only, ADetailer prompt: "a person walking", ADetailer confidence: 0.3, Version: v1.7.0`;

// ── parseA1111Parameters — sampler/scheduler splitting ──────────────────────

describe('parseA1111Parameters — sampler/scheduler splitting', () => {
    test('Format A: separate Schedule type key', () => {
        const r = parseA1111Parameters(FMT_A_SCHEDULE_TYPE)!;
        expect(r.sampler).toBe('DPM++ SDE');
        expect(r.scheduler).toBe('Karras');
    });

    test('Format B: combined "DPM++ SDE Karras" splits correctly', () => {
        const r = parseA1111Parameters(FMT_B_COMBINED_SAMPLER)!;
        expect(r.sampler).toBe('DPM++ SDE');
        expect(r.scheduler).toBe('Karras');
    });

    test('Format C: DPM++ 2M + separate Karras', () => {
        const r = parseA1111Parameters(FMT_C_DPM2M_SCHEDULE)!;
        expect(r.sampler).toBe('DPM++ 2M');
        expect(r.scheduler).toBe('Karras');
    });

    test('Format D: custom sampler not split, Automatic scheduler kept', () => {
        const r = parseA1111Parameters(FMT_D_CUSTOM_SAMPLER)!;
        expect(r.sampler).toBe('Cyberdelia Ralston (RK2)');
        expect(r.scheduler).toBe('Automatic');
    });

    test('Format F: "DPM++ 2M Karras" combined (3-word + scheduler suffix)', () => {
        const r = parseA1111Parameters(FMT_F_DPM2M_KARRAS_COMBINED)!;
        expect(r.sampler).toBe('DPM++ 2M');
        expect(r.scheduler).toBe('Karras');
    });

    test('Format G: Euler a — no scheduler suffix present', () => {
        const r = parseA1111Parameters(FMT_G_EULER_A)!;
        expect(r.sampler).toBe('Euler a');
        expect(r.scheduler).toBeNull();
    });

    test('Format H: "DPM++ 3M SDE Karras" combined (4-word with 3M variant)', () => {
        const r = parseA1111Parameters(FMT_H_DPM3M_SDE_KARRAS)!;
        expect(r.sampler).toBe('DPM++ 3M SDE');
        expect(r.scheduler).toBe('Karras');
    });
});

// ── parseA1111Parameters — model / model_hash ───────────────────────────────

describe('parseA1111Parameters — model and model_hash', () => {
    test('Model and Model hash are split into separate fields', () => {
        const r = parseA1111Parameters(FMT_A_SCHEDULE_TYPE)!;
        expect(r.model).toBe('RealVisXL_V4.0');
        expect(r.model_hash).toBe('609fde646e');
        expect(r.model).not.toBe('609fde646e');
    });

    test('model_hash never leaks into model field', () => {
        for (const raw of [FMT_B_COMBINED_SAMPLER, FMT_C_DPM2M_SCHEDULE, FMT_E_DPM2MSDE_CIVITAI]) {
            const r = parseA1111Parameters(raw)!;
            expect(r.model).not.toMatch(/^[0-9a-f]{8,}$/i);
        }
    });
});

// ── parseA1111Parameters — prompts ──────────────────────────────────────────

describe('parseA1111Parameters — prompts', () => {
    test('positive prompt extracted (single line)', () => {
        const r = parseA1111Parameters(FMT_A_SCHEDULE_TYPE)!;
        expect(r.positive).toBe('a scenic photo of mountains at dusk');
    });

    test('negative prompt extracted', () => {
        const r = parseA1111Parameters(FMT_A_SCHEDULE_TYPE)!;
        expect(r.negative).toBe('low quality, blurry, watermark');
    });

    test('numeric params are strings', () => {
        const r = parseA1111Parameters(FMT_B_COMBINED_SAMPLER)!;
        expect(r.steps).toBe('6');
        expect(r.cfg_scale).toBe('1.5');
        expect(r.seed).toBe('983791494');
    });

    test('no negative prompt → null', () => {
        const simple = `a photo\nSteps: 10, Sampler: Euler, CFG scale: 7, Seed: 1, Size: 512x512`;
        const r = parseA1111Parameters(simple)!;
        expect(r.positive).toBe('a photo');
        expect(r.negative).toBeNull();
    });
});

// ── parseA1111Parameters — extras ───────────────────────────────────────────

describe('parseA1111Parameters — extras passthrough', () => {
    test('VAE and VAE hash go to extras (Format B)', () => {
        const r = parseA1111Parameters(FMT_B_COMBINED_SAMPLER)!;
        expect(r.extras['vae']).toBe('vae-ft-mse-840000-ema-pruned.safetensors');
        expect(r.extras['vae hash']).toBe('e9ed949371');
    });

    test('Hires fields go to extras (Format B)', () => {
        const r = parseA1111Parameters(FMT_B_COMBINED_SAMPLER)!;
        expect(r.extras['hires upscale']).toBe('2');
        expect(r.extras['hires steps']).toBe('2');
        expect(r.extras['hires upscaler']).toBe('4x_NMKD-Superscale-SP_178000_G');
    });

    test('ADetailer fields go to extras (Format H)', () => {
        const r = parseA1111Parameters(FMT_H_DPM3M_SDE_KARRAS)!;
        expect(r.extras['adetailer model']).toBe('mediapipe_face_mesh_eyes_only');
        expect(r.extras['adetailer confidence']).toBe('0.3');
    });

    test('Civitai-specific extras (RNG, TI, Version) go to extras (Format E)', () => {
        const r = parseA1111Parameters(FMT_E_DPM2MSDE_CIVITAI)!;
        expect(r.extras['rng']).toBe('CPU');
        expect(r.extras['ti']).toBe('CyberRealistic_Negative_New');
        expect(r.extras['version']).toBe('neo');
    });

    test('Clip skip goes to extras', () => {
        const r = parseA1111Parameters(FMT_F_DPM2M_KARRAS_COMBINED)!;
        expect(r.extras['clip skip']).toBe('2');
    });
});

// ── parseA1111Parameters — invalid input ────────────────────────────────────

describe('parseA1111Parameters — invalid input', () => {
    test('returns null for non-A1111 strings', () => {
        expect(parseA1111Parameters('hello world')).toBeNull();
        expect(parseA1111Parameters('')).toBeNull();
        expect(parseA1111Parameters('{"prompt": "test"}')).toBeNull();
    });
});

// ── extractByA1111 — Exif.UserComment fallback ──────────────────────────────

describe('extractByA1111 — Exif.UserComment fallback', () => {
    const JPEG_UC = FMT_B_COMBINED_SAMPLER; // same format as JPEG example

    test('falls back to ExifIFD.UserComment when parameters absent', () => {
        const metadata = { ExifIFD: { UserComment: JPEG_UC } };
        expect(extractByA1111.model!(metadata)).toBe('RVHYPO');
        expect(extractByA1111.sampler!(metadata)).toBe('DPM++ SDE');
        expect(extractByA1111.seed!(metadata)).toBe('983791494');
    });

    test('falls back to Exif.UserComment', () => {
        const metadata = { Exif: { UserComment: JPEG_UC } };
        expect(extractByA1111.model!(metadata)).toBe('RVHYPO');
    });

    test('parameters takes priority over UserComment', () => {
        const metadata = {
            parameters: FMT_C_DPM2M_SCHEDULE,
            ExifIFD: { UserComment: JPEG_UC },
        };
        expect(extractByA1111.model!(metadata)).toBe('dreamshaper_8');
    });

    test('non-A1111 UserComment is ignored', () => {
        const metadata = { ExifIFD: { UserComment: 'some random comment' } };
        expect(extractByA1111.model!(metadata)).toBeNull();
    });
});

// ── getA1111ModelHash / getA1111Extras ──────────────────────────────────────

describe('getA1111ModelHash', () => {
    test('returns hash string', () => {
        expect(getA1111ModelHash({ parameters: FMT_A_SCHEDULE_TYPE })).toBe('609fde646e');
    });
    test('returns null when no A1111 data', () => {
        expect(getA1111ModelHash({ prompt: {} })).toBeNull();
        expect(getA1111ModelHash({})).toBeNull();
    });
});

describe('getA1111Extras', () => {
    test('returns full extras map', () => {
        const extras = getA1111Extras({ parameters: FMT_E_DPM2MSDE_CIVITAI });
        expect(extras['version']).toBe('neo');
        expect(extras['rng']).toBe('CPU');
    });
    test('returns empty object when no A1111 data', () => {
        expect(getA1111Extras({})).toEqual({});
    });
});
