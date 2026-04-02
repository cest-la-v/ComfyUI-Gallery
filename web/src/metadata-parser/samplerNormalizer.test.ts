import { describe, test, expect } from 'bun:test';
import {
    normalizeSamplerName,
    normalizeSchedulerName,
    normalizeModelName,
    COMFYUI_SAMPLER_DISPLAY,
    COMFYUI_SCHEDULER_DISPLAY,
} from './samplerNormalizer';

// ── normalizeSamplerName ────────────────────────────────────────────────────

describe('normalizeSamplerName', () => {
    test('ComfyUI snake_case → A1111 display name', () => {
        expect(normalizeSamplerName('euler')).toBe('Euler');
        expect(normalizeSamplerName('euler_ancestral')).toBe('Euler a');
        expect(normalizeSamplerName('dpmpp_sde')).toBe('DPM++ SDE');
        expect(normalizeSamplerName('dpmpp_2m')).toBe('DPM++ 2M');
        expect(normalizeSamplerName('dpmpp_2m_sde')).toBe('DPM++ 2M SDE');
        expect(normalizeSamplerName('dpmpp_3m_sde')).toBe('DPM++ 3M SDE');
        expect(normalizeSamplerName('dpmpp_2s_ancestral')).toBe('DPM++ 2S a');
        expect(normalizeSamplerName('ddim')).toBe('DDIM');
        expect(normalizeSamplerName('uni_pc')).toBe('UniPC');
        expect(normalizeSamplerName('lcm')).toBe('LCM');
    });

    test('A1111 display names pass through unchanged (idempotent)', () => {
        // A1111 values are not in the map → returned as-is
        expect(normalizeSamplerName('DPM++ SDE')).toBe('DPM++ SDE');
        expect(normalizeSamplerName('DPM++ 2M SDE')).toBe('DPM++ 2M SDE');
        expect(normalizeSamplerName('Euler a')).toBe('Euler a');
        expect(normalizeSamplerName('Euler')).toBe('Euler');
        expect(normalizeSamplerName('DDIM')).toBe('DDIM');
    });

    test('gpu variants map to same display name as non-gpu', () => {
        expect(normalizeSamplerName('dpmpp_sde_gpu')).toBe('DPM++ SDE');
        expect(normalizeSamplerName('dpmpp_2m_sde_gpu')).toBe('DPM++ 2M SDE');
        expect(normalizeSamplerName('dpmpp_3m_sde_gpu')).toBe('DPM++ 3M SDE');
    });

    test('unknown names pass through unchanged', () => {
        expect(normalizeSamplerName('custom_sampler')).toBe('custom_sampler');
        expect(normalizeSamplerName('some_new_sampler')).toBe('some_new_sampler');
    });

    test('null / undefined / empty return empty string', () => {
        expect(normalizeSamplerName(null)).toBe('');
        expect(normalizeSamplerName(undefined)).toBe('');
        expect(normalizeSamplerName('')).toBe('');
    });

    test('all map entries produce non-empty strings', () => {
        for (const [key, val] of Object.entries(COMFYUI_SAMPLER_DISPLAY)) {
            expect(normalizeSamplerName(key)).toBe(val);
            expect(val.length).toBeGreaterThan(0);
        }
    });
});

// ── normalizeSchedulerName ──────────────────────────────────────────────────

describe('normalizeSchedulerName', () => {
    test('ComfyUI snake_case → A1111 display name', () => {
        expect(normalizeSchedulerName('karras')).toBe('Karras');
        expect(normalizeSchedulerName('normal')).toBe('Normal');
        expect(normalizeSchedulerName('exponential')).toBe('Exponential');
        expect(normalizeSchedulerName('sgm_uniform')).toBe('SGM Uniform');
        expect(normalizeSchedulerName('ddim_uniform')).toBe('DDIM Uniform');
        expect(normalizeSchedulerName('beta')).toBe('Beta');
        expect(normalizeSchedulerName('linear_quadratic')).toBe('Linear Quadratic');
        expect(normalizeSchedulerName('simple')).toBe('Simple');
        expect(normalizeSchedulerName('ays')).toBe('Align Your Steps');
    });

    test('A1111 display names pass through unchanged', () => {
        expect(normalizeSchedulerName('Karras')).toBe('Karras');
        expect(normalizeSchedulerName('Normal')).toBe('Normal');
        expect(normalizeSchedulerName('SGM Uniform')).toBe('SGM Uniform');
    });

    test('null / undefined / empty return empty string', () => {
        expect(normalizeSchedulerName(null)).toBe('');
        expect(normalizeSchedulerName(undefined)).toBe('');
        expect(normalizeSchedulerName('')).toBe('');
    });

    test('all map entries produce non-empty strings', () => {
        for (const [key, val] of Object.entries(COMFYUI_SCHEDULER_DISPLAY)) {
            expect(normalizeSchedulerName(key)).toBe(val);
            expect(val.length).toBeGreaterThan(0);
        }
    });
});

// ── normalizeModelName ──────────────────────────────────────────────────────

describe('normalizeModelName', () => {
    test('strips .safetensors extension', () => {
        expect(normalizeModelName('dreamshaper_8.safetensors')).toBe('dreamshaper_8');
        expect(normalizeModelName('v1-5-pruned-emaonly.safetensors')).toBe('v1-5-pruned-emaonly');
    });

    test('strips .ckpt extension', () => {
        expect(normalizeModelName('v1-5-pruned.ckpt')).toBe('v1-5-pruned');
    });

    test('strips leading path prefix', () => {
        expect(normalizeModelName('checkpoints/dreamshaper_8.safetensors')).toBe('dreamshaper_8');
        expect(normalizeModelName('models/checkpoints/sdxl.safetensors')).toBe('sdxl');
    });

    test('A1111 names without extension pass through unchanged', () => {
        // From example images
        expect(normalizeModelName('DreamShaperXL_Turbo-Lightning')).toBe('DreamShaperXL_Turbo-Lightning');
        expect(normalizeModelName('CyberRealistic_FINAL_FP32')).toBe('CyberRealistic_FINAL_FP32');
        expect(normalizeModelName('RVHYPO')).toBe('RVHYPO');
    });

    test('normalizing same model from ComfyUI and A1111 produces equal stem', () => {
        // Simulated: ComfyUI emits full path+ext, A1111 emits just the stem
        const comfyui = normalizeModelName('checkpoints/dreamshaper_8.safetensors');
        const a1111   = normalizeModelName('dreamshaper_8');
        expect(comfyui).toBe(a1111);
    });

    test('null / undefined / empty return empty string', () => {
        expect(normalizeModelName(null)).toBe('');
        expect(normalizeModelName(undefined)).toBe('');
        expect(normalizeModelName('')).toBe('');
    });

    test('extension matching is case-insensitive', () => {
        expect(normalizeModelName('model.SAFETENSORS')).toBe('model');
        expect(normalizeModelName('model.Ckpt')).toBe('model');
    });
});
