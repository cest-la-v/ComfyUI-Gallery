import { describe, test, expect } from 'bun:test';
import { parseA1111Parameters } from './a1111MetadataParser';
import { getA1111ModelHash, getA1111Extras } from './a1111MetadataParser';
import { extractByA1111 } from './a1111MetadataParser';

// ── Shared fixtures derived from actual example images ──────────────────────

/** 6f348cb1-4179-4e04-81a3-0071ff213f12.png — combined Sampler+Scheduler, no Schedule type key */
const PNG_DREAMSHAPERXL = `cinematic film still, close up, photo of redheaded girl near grasses, fictional landscapes, (intense sunlight:1.4), realist detail, brooding mood, ue5, detailed character expressions, light amber and red, amazing quality, wallpaper, analog film grain
Negative prompt: (low quality, worst quality:1.4), cgi,  text, signature, watermark, extra limbs, ((nipples))
Steps: 4, Sampler: DPM++ SDE Karras, CFG scale: 2, Seed: 3346112079, Size: 768x1024, Model hash: fdbe56354b, Model: DreamShaperXL_Turbo-Lightning, Denoising strength: 0.52, Clip skip: 2, RNG: CPU, ADetailer model: mediapipe_face_mesh_eyes_only, ADetailer prompt: "cinematic film still, photo of a girl", ADetailer confidence: 0.3, Version: v1.7.0`;

/** 00c2690e-f71b-491a-a5cb-0199d8956e0f.png — separate Schedule type key (newer A1111 format) */
const PNG_CYBERREALISTIC = `masterpiece, best quality, ultra-detailed, photorealistic, cinematic ambient glow, colorful lighting, artistic bedroom, messy bed, indie poster on wall, casual aesthetic, relaxed mood, soft focus, 1girl, long hair, wearing crop top and jogger pants, hand on headphones, casual smile, dreamy expression, artistic vibe, indie bedroom lighting, chill atmosphere
Negative prompt: CyberRealistic_Negative_New
Steps: 32, Sampler: DPM++ 2M SDE, Schedule type: Karras, CFG scale: 7, Seed: 96817171, Size: 704x1024, Model hash: f4d3a85a81, Model: CyberRealistic_FINAL_FP32, Denoising strength: 0.25, RNG: CPU, Hires Module 1: Use same choices, Hires CFG Scale: 7, Hires upscale: 1.5, Hires steps: 12, Hires upscaler: 4x_NickelbackFS_72000_G, TI: CyberRealistic_Negative_New, Version: neo`;

/** 00012-3277121308.jpeg — Exif.UserComment decoded from UTF-16 BE */
const JPEG_RVHYPO_DECODED = `instagram photo, closeup face photo of 23 y.o Chloe in black sweater, cleavage, pale skin, (smile:0.4), hard shadows
Negative prompt: (nsfw, naked, nude, deformed iris, deformed pupils, semi-realistic, cgi, 3d, render, sketch, cartoon, drawing, anime, mutated hands and fingers:1.4), (deformed, distorted, disfigured:1.3), poorly drawn, bad anatomy, wrong anatomy, extra limb, missing limb, floating limbs, disconnected limbs, mutation, mutated, ugly, disgusting, amputation
Steps: 6, Sampler: DPM++ SDE Karras, CFG scale: 1.5, Seed: 3277121308, Size: 512x768, Model hash: 0928b30687, Model: RVHYPO, VAE hash: e9ed949371, VAE: vae-ft-mse-840000-ema-pruned.safetensors, Denoising strength: 0.35, Hires upscale: 2, Hires steps: 2, Hires upscaler: 4x_NMKD-Superscale-SP_178000_G, Version: v1.7.0`;

// ── parseA1111Parameters ────────────────────────────────────────────────────

describe('parseA1111Parameters — sampler/scheduler splitting', () => {
    test('combined "Sampler: DPM++ SDE Karras" splits into sampler + scheduler', () => {
        const r = parseA1111Parameters(PNG_DREAMSHAPERXL)!;
        expect(r.sampler).toBe('DPM++ SDE');
        expect(r.scheduler).toBe('Karras');
    });

    test('separate "Schedule type: Karras" key is respected', () => {
        const r = parseA1111Parameters(PNG_CYBERREALISTIC)!;
        expect(r.sampler).toBe('DPM++ 2M SDE');
        expect(r.scheduler).toBe('Karras');
    });

    test('JPEG decoded UserComment — combined sampler field', () => {
        const r = parseA1111Parameters(JPEG_RVHYPO_DECODED)!;
        expect(r.sampler).toBe('DPM++ SDE');
        expect(r.scheduler).toBe('Karras');
    });
});

describe('parseA1111Parameters — model field', () => {
    test('Model: key sets model; Model hash: key goes to model_hash, not model', () => {
        const r = parseA1111Parameters(PNG_DREAMSHAPERXL)!;
        expect(r.model).toBe('DreamShaperXL_Turbo-Lightning');
        expect(r.model_hash).toBe('fdbe56354b');
        // model must NOT be the hash value
        expect(r.model).not.toBe('fdbe56354b');
    });

    test('model_hash populated separately from model (CyberRealistic)', () => {
        const r = parseA1111Parameters(PNG_CYBERREALISTIC)!;
        expect(r.model).toBe('CyberRealistic_FINAL_FP32');
        expect(r.model_hash).toBe('f4d3a85a81');
    });

    test('JPEG model and hash correctly split', () => {
        const r = parseA1111Parameters(JPEG_RVHYPO_DECODED)!;
        expect(r.model).toBe('RVHYPO');
        expect(r.model_hash).toBe('0928b30687');
    });
});

describe('parseA1111Parameters — prompts', () => {
    test('positive prompt extracted correctly', () => {
        const r = parseA1111Parameters(PNG_DREAMSHAPERXL)!;
        expect(r.positive).toContain('cinematic film still');
        expect(r.positive).toContain('analog film grain');
    });

    test('negative prompt extracted correctly', () => {
        const r = parseA1111Parameters(PNG_DREAMSHAPERXL)!;
        expect(r.negative).toContain('low quality, worst quality');
        expect(r.negative).not.toContain('cinematic film still');
    });

    test('numeric fields parsed as strings', () => {
        const r = parseA1111Parameters(PNG_DREAMSHAPERXL)!;
        expect(r.steps).toBe('4');
        expect(r.cfg_scale).toBe('2');
        expect(r.seed).toBe('3346112079');
    });
});

describe('parseA1111Parameters — extras (Civitai extension fields)', () => {
    test('unrecognized keys go to extras, not dropped', () => {
        const r = parseA1111Parameters(PNG_CYBERREALISTIC)!;
        expect(r.extras['denoising strength']).toBe('0.25');
        expect(r.extras['version']).toBe('neo');
        expect(r.extras['hires upscale']).toBe('1.5');
        expect(r.extras['hires steps']).toBe('12');
    });

    test('VAE and VAE hash captured in extras (JPEG)', () => {
        const r = parseA1111Parameters(JPEG_RVHYPO_DECODED)!;
        expect(r.extras['vae']).toBe('vae-ft-mse-840000-ema-pruned.safetensors');
        expect(r.extras['vae hash']).toBe('e9ed949371');
    });

    test('ADetailer fields captured in extras', () => {
        const r = parseA1111Parameters(PNG_DREAMSHAPERXL)!;
        expect(r.extras['adetailer model']).toBe('mediapipe_face_mesh_eyes_only');
        expect(r.extras['adetailer confidence']).toBe('0.3');
    });
});

describe('parseA1111Parameters — invalid input', () => {
    test('returns null for non-A1111 string', () => {
        expect(parseA1111Parameters('hello world')).toBeNull();
        expect(parseA1111Parameters('')).toBeNull();
    });
});

// ── extractByA1111 — Exif.UserComment fallback ──────────────────────────────

describe('extractByA1111 — Exif.UserComment fallback', () => {
    test('falls back to Exif.UserComment when parameters is absent', () => {
        const metadata = {
            Exif: { UserComment: JPEG_RVHYPO_DECODED }
        };
        expect(extractByA1111.model!(metadata)).toBe('RVHYPO');
        expect(extractByA1111.sampler!(metadata)).toBe('DPM++ SDE');
    });

    test('parameters takes priority over Exif.UserComment', () => {
        const metadata = {
            parameters: PNG_CYBERREALISTIC,
            Exif: { UserComment: JPEG_RVHYPO_DECODED }
        };
        expect(extractByA1111.model!(metadata)).toBe('CyberRealistic_FINAL_FP32');
    });
});

// ── getA1111ModelHash / getA1111Extras ──────────────────────────────────────

describe('getA1111ModelHash', () => {
    test('returns hash string', () => {
        expect(getA1111ModelHash({ parameters: PNG_DREAMSHAPERXL })).toBe('fdbe56354b');
    });
    test('returns null when no parameters', () => {
        expect(getA1111ModelHash({ prompt: {} })).toBeNull();
    });
});

describe('getA1111Extras', () => {
    test('returns extras map', () => {
        const extras = getA1111Extras({ parameters: PNG_CYBERREALISTIC });
        expect(extras['version']).toBe('neo');
    });
    test('returns empty object when no parameters', () => {
        expect(getA1111Extras({})).toEqual({});
    });
});
