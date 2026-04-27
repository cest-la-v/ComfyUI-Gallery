/**
 * Canonical display-name normalizers for sampler, scheduler, and model fields.
 *
 * Tables are loaded from metadata_parser/normalizer_tables.json — the single
 * source of truth shared with Python's normalizer.py. Both sides read the
 * same file so the tables cannot drift from each other.
 */

import _tables from '../../../metadata_parser/normalizer_tables.json';

/** Maps ComfyUI internal sampler_name → canonical A1111-style display name */
export const COMFYUI_SAMPLER_DISPLAY: Record<string, string> = _tables.sampler_display;

/** Maps ComfyUI internal scheduler → canonical A1111-style display name */
export const COMFYUI_SCHEDULER_DISPLAY: Record<string, string> = _tables.scheduler_display;

/**
 * Normalize a sampler identifier to its canonical display name.
 * ComfyUI snake_case → A1111 display name; A1111 names pass through unchanged.
 */
export function normalizeSamplerName(raw: string | null | undefined): string {
    if (!raw) return '';
    return COMFYUI_SAMPLER_DISPLAY[raw] ?? raw;
}

/**
 * Normalize a scheduler identifier to its canonical display name.
 * ComfyUI snake_case → A1111 display name; A1111 names pass through unchanged.
 */
export function normalizeSchedulerName(raw: string | null | undefined): string {
    if (!raw) return '';
    return COMFYUI_SCHEDULER_DISPLAY[raw] ?? raw;
}

/**
 * Normalize a model name to a clean display stem.
 * Strips leading path components and known file extensions so that
 * "checkpoints/dreamshaper_8.safetensors" and "dreamshaper_8" compare equal.
 */
export function normalizeModelName(raw: string | null | undefined): string {
    if (!raw) return '';
    const basename = raw.split('/').pop() ?? raw;
    return basename.replace(/\.(safetensors|ckpt|pt|bin|pth)$/i, '');
}
