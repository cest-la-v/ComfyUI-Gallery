/**
 * Canonical display-name normalizers for sampler, scheduler, and model fields.
 *
 * ComfyUI uses Python-side snake_case identifiers; A1111/Civitai uses human
 * display names. This module bridges the two so that group-by operations on
 * Model, Sampler, and Scheduler work consistently across both metadata sources.
 */

/** Maps ComfyUI internal sampler_name → canonical A1111-style display name */
export const COMFYUI_SAMPLER_DISPLAY: Record<string, string> = {
    euler:                 'Euler',
    euler_ancestral:       'Euler a',
    heun:                  'Heun',
    heunpp2:               'Heun++2',
    dpm_2:                 'DPM2',
    dpm_2_ancestral:       'DPM2 a',
    lms:                   'LMS',
    dpm_fast:              'DPM fast',
    dpm_adaptive:          'DPM adaptive',
    dpmpp_2s_ancestral:    'DPM++ 2S a',
    dpmpp_sde:             'DPM++ SDE',
    dpmpp_sde_gpu:         'DPM++ SDE',
    dpmpp_2m:              'DPM++ 2M',
    dpmpp_2m_sde:          'DPM++ 2M SDE',
    dpmpp_2m_sde_gpu:      'DPM++ 2M SDE',
    dpmpp_3m_sde:          'DPM++ 3M SDE',
    dpmpp_3m_sde_gpu:      'DPM++ 3M SDE',
    ddpm:                  'DDPM',
    lcm:                   'LCM',
    ddim:                  'DDIM',
    uni_pc:                'UniPC',
    uni_pc_bh2:            'UniPC BH2',
    ipndm:                 'IPNDM',
    ipndm_v:               'IPNDM V',
    deis:                  'DEIS',
    res_multistep:         'ReS Multistep',
    res_multistep_ancestral: 'ReS Multistep a',
};

/** Maps ComfyUI internal scheduler → canonical A1111-style display name */
export const COMFYUI_SCHEDULER_DISPLAY: Record<string, string> = {
    normal:           'Normal',
    karras:           'Karras',
    exponential:      'Exponential',
    sgm_uniform:      'SGM Uniform',
    simple:           'Simple',
    ddim_uniform:     'DDIM Uniform',
    beta:             'Beta',
    linear_quadratic: 'Linear Quadratic',
    kl_optimal:       'KL Optimal',
    laplace:          'Laplace',
    ays:              'Align Your Steps',
    gits:             'GITS',
    polyexponential:  'Polyexponential',
    vp:               'VP',
    turbo:            'Turbo',
};

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
