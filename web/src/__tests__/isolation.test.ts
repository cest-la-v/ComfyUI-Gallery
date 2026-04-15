/**
 * ComfyUI embedding isolation invariant tests.
 *
 * Source invariants run always (no build needed) — they catch changes to
 * config/source before a build is even attempted.
 *
 * Artifact invariants skip when dist hasn't been built yet (clean checkout),
 * but fail loudly after any build that breaks isolation.
 *
 * Run from the web/ directory: bun test
 */

import { describe, test, expect } from 'bun:test';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const webDir = resolve(import.meta.dir, '../..');
const srcDir = resolve(webDir, 'src');
const distCss = resolve(webDir, 'dist/assets/comfy-ui-gallery.css');

describe('ComfyUI embedding isolation — source invariants', () => {
    test('tailwind.config.js scopes utilities to both gallery roots', () => {
        const cfg = readFileSync(resolve(webDir, 'tailwind.config.js'), 'utf-8');
        expect(cfg).toContain(':is(#comfy-gallery-root, #comfy-gallery-yarl-root)');
    });

    test('globals.css does not import preflight', () => {
        const css = readFileSync(resolve(srcDir, 'globals.css'), 'utf-8');
        expect(css).not.toContain('preflight');
    });

    test('globals.css imports comfyui-compat.css', () => {
        const css = readFileSync(resolve(srcDir, 'globals.css'), 'utf-8');
        expect(css).toContain('@import "./comfyui-compat.css"');
    });

    test('comfyui-compat.css exists', () => {
        expect(existsSync(resolve(srcDir, 'comfyui-compat.css'))).toBe(true);
    });

    test('comfyui-compat.css scopes .lb-btn to gallery roots', () => {
        const css = readFileSync(resolve(srcDir, 'comfyui-compat.css'), 'utf-8');
        expect(css).toContain(':is(#comfy-gallery-root, #comfy-gallery-yarl-root) .lb-btn');
    });

    test('comfyui-compat.css defines --cg-z-floating-btn on :root', () => {
        const css = readFileSync(resolve(srcDir, 'comfyui-compat.css'), 'utf-8');
        expect(css).toContain('--cg-z-floating-btn');
        // Must be on :root, not scoped inside #comfy-gallery-root
        const rootIdx = css.indexOf(':root');
        const varIdx = css.indexOf('--cg-z-floating-btn');
        expect(rootIdx).toBeGreaterThan(-1);
        expect(varIdx).toBeGreaterThan(rootIdx);
    });

    test('comfyui-compat.css anchors dark mode to gallery roots, not html.dark', () => {
        const css = readFileSync(resolve(srcDir, 'comfyui-compat.css'), 'utf-8');
        expect(css).toContain('@custom-variant dark');
        expect(css).toContain('#comfy-gallery-root.dark');
        // Must NOT reference html.dark
        expect(css).not.toContain('html.dark');
    });

    test('comfyui-compat.css external buttons use !important', () => {
        const css = readFileSync(resolve(srcDir, 'comfyui-compat.css'), 'utf-8');
        expect(css).toContain('.comfy-gallery-primary-btn');
        const btnBlock = css.slice(css.indexOf('.comfy-gallery-primary-btn'));
        expect(btnBlock).toContain('!important');
    });
});

describe('ComfyUI embedding isolation — artifact invariants', () => {
    const skip = !existsSync(distCss);

    test.skipIf(skip)('Tailwind utilities carry gallery root prefix in compiled CSS', () => {
        const css = readFileSync(distCss, 'utf-8');
        expect(css).toContain(':is(#comfy-gallery-root');
    });

    test.skipIf(skip)('--cg-z-floating-btn var is defined in compiled CSS', () => {
        const css = readFileSync(distCss, 'utf-8');
        expect(css).toContain('--cg-z-floating-btn');
    });

    test.skipIf(skip)('.lb-btn is scoped inside :is(...) in compiled CSS', () => {
        const css = readFileSync(distCss, 'utf-8');
        // Match the scoped selector pattern regardless of minification
        expect(css).toMatch(/:is\(#comfy-gallery-root[^{]*\.lb-btn/);
    });

    test.skipIf(skip)('No preflight CSS in compiled output', () => {
        const css = readFileSync(distCss, 'utf-8');
        expect(css).not.toContain('preflight');
    });
});
