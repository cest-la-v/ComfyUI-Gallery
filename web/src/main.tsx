import './globals.css';
import { createRoot, type Root } from 'react-dom/client'
import { useState } from 'react';
import Gallery from './Gallery.tsx'
import { DEFAULT_SETTINGS, DEFAULT_SOURCE_PATHS, STORAGE_KEY, type SettingsState } from './GalleryContext.tsx';
import { galleryBridge } from './galleryBridge.ts';
import { ComfyAppApi, OPEN_BUTTON_ID, isComfyMode } from './ComfyAppApi.ts';
import { useLocalStorageState } from 'ahooks';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PortalProvider } from './PortalContext.tsx';

// Expose the gallery bridge so node extensions can open pick mode.
// galleryBridge.openPickMode is a stub until GalleryProvider mounts and updates it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).__comfyGallery = galleryBridge;

/*
 * DOM TOPOLOGY
 * ─────────────────────────────────────────────────────────────────────────────
 * document.body
 *   ├─ #comfy-gallery-root        React root (createRoot target)
 *   │   └─ React tree
 *   │       └─ #comfy-gallery-portals  Radix portal target (via PortalContext)
 *   │           ├─ Dialogs, AlertDialogs
 *   │           ├─ Selects, Tooltips
 *   │           └─ Lightbox toolbar + MetadataPanel (createPortal)
 *   └─ #comfy-gallery-yarl-root   yet-another-react-lightbox portal target
 *       └─ yarl Lightbox
 *
 * INVARIANTS — must not be violated:
 *
 * 1. Never append non-React DOM inside #comfy-gallery-root.
 *    React 18 clears its container's children during reconciliation.
 *    All companion elements are siblings of the React container.
 *
 * 2. Each third-party modal library gets its own portal root here.
 *    yarl's Portal.handleEnter() marks all siblings as inert (a11y).
 *    If yarl targets document.body, it inerts #comfy-gallery-root → everything
 *    inside becomes non-interactive. Its own root (#comfy-gallery-yarl-root)
 *    has no siblings, so nothing gets inerted.
 *
 * 3. All Radix portals (dialogs, selects, tooltips) target #comfy-gallery-portals.
 *    This keeps them inside the React subtree → CSS scoping & dark mode work.
 *
 * 4. Z-index values come from --cg-z-* CSS custom properties (globals.css :root).
 *    Never hardcode z-index numbers in components.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Module-level root reference so HMR cleanup can call unmount() before removing DOM.
let _galleryRoot: Root | null = null;

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

            // Guard against duplicate roots on HMR / re-init.
            // Unmount React first so GalleryContext cleans up its listeners and
            // polling interval before the DOM nodes are removed.
            if (_galleryRoot) {
                _galleryRoot.unmount();
                _galleryRoot = null;
            }
            const existing = document.getElementById('comfy-gallery-root');
            if (existing) existing.remove();
            const existingYarl = document.getElementById('comfy-gallery-yarl-root');
            if (existingYarl) existingYarl.remove();

            // Mount the gallery root at document.body (see DOM TOPOLOGY comment above).
            const box = document.createElement("div");
            box.id = 'comfy-gallery-root';
            document.body.appendChild(box);

            // yarl portal root — sibling of box, never a child (React would remove it).
            const yarlRoot = document.createElement("div");
            yarlRoot.id = 'comfy-gallery-yarl-root';
            document.body.appendChild(yarlRoot);

            _galleryRoot = createRoot(box);
            _galleryRoot.render(<Main />);

            ComfyAppApi.startMonitoring(settings.sourcePaths ?? DEFAULT_SOURCE_PATHS);
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
            if (node.comfyClass === "GalleryMetadataExtractor" || node.comfyClass === "GalleryPromptReader") {
                node.addWidget("button", "📂 Pick from Gallery", null, () => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (window as any).__comfyGallery?.openPickMode((filename: string) => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const w = node.widgets?.find((w: any) => w.name === 'image');
                        if (w) {
                            // Mirror what ComfyUI's upload widget does: add to options list
                            // so the COMBO knows about the file, then fire callback to trigger
                            // nodeOutputStore.setNodeOutputs() → loads the image preview
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            if (w.options?.values && !(w.options.values as any[]).includes(filename)) {
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                (w.options.values as any[]).push(filename);
                            }
                            w.value = filename;
                            w.callback?.(filename);
                            node.setDirtyCanvas?.(true, true);
                        }
                    });
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