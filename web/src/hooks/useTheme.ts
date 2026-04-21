import { useEffect } from 'react';
import { buildBaseThemeCss, buildAccentThemeCss } from '@/themes';

function upsertStyleTag(id: string, css: string | null): void {
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!css) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = css;
}

/**
 * Injects or removes themed CSS variable overrides into document.head.
 * - base !== 'default': replaces all gallery CSS vars with the chosen palette
 * - accent !== 'default': overlays primary/ring color on top of base
 */
export function useTheme(base: string, accent: string): void {
  useEffect(() => {
    upsertStyleTag('cg-base-theme', buildBaseThemeCss(base));
  }, [base]);

  useEffect(() => {
    upsertStyleTag('cg-accent-theme', buildAccentThemeCss(accent));
  }, [accent]);
}
