import './globals.css';
import { createRoot } from 'react-dom/client'
import { useState } from 'react';
import Gallery from './Gallery.tsx'
import { DEFAULT_SETTINGS, STORAGE_KEY, type SettingsState } from './GalleryContext.tsx';
import { ComfyAppApi, OPEN_BUTTON_ID, isComfyMode } from './ComfyAppApi.ts';
import { useLocalStorageState } from 'ahooks';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PortalProvider } from './PortalContext.tsx';

// In production, Bun.build() outputs Tailwind CSS as a separate file.
// Inject it via <link> using import.meta.url (works in ES module scripts).
// In dev (Bun.serve), the [serve.static] bun-plugin-tailwind handles CSS automatically.
if (process.env.NODE_ENV === 'production') {
    try {
        const cssUrl = new URL('./comfy-ui-gallery.css', import.meta.url).href;
        if (!document.querySelector(`link[href="${cssUrl}"]`)) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = cssUrl;
            document.head.appendChild(link);
        }
    } catch { /* ignore if URL API is unavailable */ }
}

// Read settings synchronously for actionBarButtons registration (before init() runs)
let _earlySettings = DEFAULT_SETTINGS;
try {
    const raw = localStorage.getItem('comfy-ui-gallery-settings');
    if (raw) _earlySettings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
} catch { }

ComfyAppApi.registerExtension({
    name: "Gallery",
    // Register a native ComfyUI action bar button (only in ComfyUI mode)
    actionBarButtons: isComfyMode ? [{
        icon: 'icon-[lucide--images]',
        label: _earlySettings.buttonLabel || 'Gallery',
        class: 'comfy-gallery-primary-btn comfy-gallery-action-bar-btn',
        onClick: () => {
            document.getElementById(OPEN_BUTTON_ID)?.click();
        }
    }] : undefined,
    async init() {
        (() => {
            let settings = DEFAULT_SETTINGS;
            try {
                const raw = localStorage.getItem('comfy-ui-gallery-settings');
                if (raw) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
            } catch { }

            // Guard against duplicate roots on HMR / re-init
            const existing = document.getElementById('comfy-gallery-root');
            if (existing) existing.remove();
            const existingYarl = document.getElementById('comfy-gallery-yarl-root');
            if (existingYarl) existingYarl.remove();

            // Mount the gallery root at document.body — not inside the ComfyUI
            // toolbar. The open buttons (action bar native button, floating button)
            // are separate concerns: the native button is registered above via
            // actionBarButtons; the floating button renders position:fixed inside
            // the gallery root and doesn't need a toolbar injection point.
            const box = document.createElement("div");
            box.id = 'comfy-gallery-root';
            document.body.appendChild(box);

            // Dedicated mount point for yarl's Lightbox portal, appended as a
            // SIBLING of box (not a child). React 18 clears its container's children
            // during reconciliation, so any element appended inside box before render
            // would be removed. As a sibling, React never touches it.
            //
            // Why this matters: yarl's Portal module sets inert + aria-hidden on all
            // siblings of its portal node (standard modal a11y pattern). Without this,
            // yarl portals to document.body and marks #comfy-gallery-root as inert,
            // making all portaled toolbar/MetadataPanel elements non-interactive.
            // With this, yarl portals into #comfy-gallery-yarl-root which has no
            // siblings, so nothing is inerted.
            const yarlRoot = document.createElement("div");
            yarlRoot.id = 'comfy-gallery-yarl-root';
            document.body.appendChild(yarlRoot);

            createRoot(box).render(<Main />);

            ComfyAppApi.startMonitoring(settings.relativePath);
        })();
    },
    async nodeCreated(node: any) {
        try {
            if (node.comfyClass === "GalleryNode") {
                node.addWidget("button", "Open Gallery", null, () => {
                    try {
                        let settings = DEFAULT_SETTINGS;
                        try {
                            const raw = localStorage.getItem('comfy-ui-gallery-settings');
                            if (raw) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
                        } catch { }
                        if (settings.galleryShortcut) {
                            document.getElementById(OPEN_BUTTON_ID)?.click();
                        }
                    } catch (error) {

                    }
                });
            }
        } catch (error) {

        }
    },
});

function Main() {
    const [settingsState, setSettings] = useLocalStorageState<SettingsState>(STORAGE_KEY, {
        defaultValue: DEFAULT_SETTINGS,
        listenStorageChange: true,
    });
    // Render #comfy-gallery-portals as a React-owned node so React doesn't
    // remove it during reconciliation. Pass it to all Radix portals via context.
    const [portalsEl, setPortalsEl] = useState<HTMLElement | null>(null);

    return (
        <PortalProvider value={portalsEl}>
            <TooltipProvider delayDuration={300}>
                <Gallery />
            </TooltipProvider>
            <Toaster
                theme={settingsState.darkMode ? 'dark' : 'light'}
                position="bottom-right"
                richColors
            />
            <div id="comfy-gallery-portals" ref={setPortalsEl} />
        </PortalProvider>
    );
}