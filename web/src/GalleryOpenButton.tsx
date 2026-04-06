import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useGalleryContext } from './GalleryContext';
import { useLocalStorageState, useDebounceFn } from 'ahooks';
import { useRef, useEffect } from 'react';
import { isComfyMode, OPEN_BUTTON_ID } from './ComfyAppApi';

const GalleryOpenButton = () => {
    const { setOpen, loading, settings } = useGalleryContext();
    const [position, setPosition] = useLocalStorageState<{ x: number; y: number }>('gallery-floating-btn-pos', {
        defaultValue: { x: 32, y: 32 },
    });
    const { run: savePosition } = useDebounceFn((pos) => setPosition(pos), { wait: 400 });
    const btnRef = useRef<HTMLDivElement>(null);

    // Ensure button stays in viewport on window resize
    useEffect(() => {
        if (!position) return;
        let { x, y } = position;
        const btnRect = btnRef.current?.getBoundingClientRect();
        const btnWidth = btnRect?.width || 160;
        const btnHeight = btnRect?.height || 48;
        let changed = false;
        if (x + btnWidth > window.innerWidth) {
            x = Math.max(0, window.innerWidth - btnWidth - 8);
            changed = true;
        }
        if (y + btnHeight > window.innerHeight) {
            y = Math.max(0, window.innerHeight - btnHeight - 8);
            changed = true;
        }
        if (x < 0) { x = 8; changed = true; }
        if (y < 0) { y = 8; changed = true; }
        // Only update if the new position is different
        if (changed && (x !== position.x || y !== position.y)) {
            setPosition({ x, y });
            savePosition({ x, y });
        }
    }, [position?.x, position?.y, setPosition, savePosition]);

    // Remove useSize and only use window.innerWidth/innerHeight for clamping and resize
    // Move button into view on window resize (even if page is empty)
    useEffect(() => {
        function handleResize() {
            if (!btnRef.current || !position) return;
            const btnRect = btnRef.current.getBoundingClientRect();
            const btnWidth = btnRect.width || 160;
            const btnHeight = btnRect.height || 48;
            const winWidth = window.innerWidth;
            const winHeight = window.innerHeight;
            let { x, y } = position;
            let changed = false;
            if (x + btnWidth > winWidth) {
                x = Math.max(8, winWidth - btnWidth - 8);
                changed = true;
            }
            if (y + btnHeight > winHeight) {
                y = Math.max(8, winHeight - btnHeight - 8);
                changed = true;
            }
            if (x < 0) { x = 8; changed = true; }
            if (y < 0) { y = 8; changed = true; }
            if (changed && (x !== position.x || y !== position.y)) {
                setPosition({ x, y });
                savePosition({ x, y });
            }
        }
        window.addEventListener('resize', handleResize);
        // Initial check in case the page is empty
        handleResize();
        return () => window.removeEventListener('resize', handleResize);
    }, [position, setPosition, savePosition]);

    // In ComfyUI mode, hide/show the native action bar button based on floatingButton setting.
    // The action bar button is registered at startup and cannot be un-registered,
    // so we toggle its visibility via DOM when "Floating" mode is active.
    // A MutationObserver is used because ComfyUI inserts the button asynchronously
    // after extension registration — a plain querySelector on mount returns null.
    useEffect(() => {
        if (!isComfyMode) return;

        const applyVisibility = (): boolean => {
            const btn = document.querySelector<HTMLElement>('.comfy-gallery-action-bar-btn');
            if (!btn) return false;
            btn.style.display = settings.floatingButton ? 'none' : '';
            return true;
        };

        if (applyVisibility()) return;

        const observer = new MutationObserver(() => {
            if (applyVisibility()) observer.disconnect();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        return () => observer.disconnect();
    }, [settings.floatingButton]);

    // In ComfyUI mode, the native actionBarButton is the visible entry point.
    // Only render the hidden trigger button (used by actionBarButton onClick and node widget).
    if (isComfyMode && !settings.floatingButton) {
        return (
            <button
                id={OPEN_BUTTON_ID}
                style={{ display: 'none' }}
                onClick={() => { if (!loading) setOpen(true); }}
            />
        );
    }

    if (settings.floatingButton) {
        // Floating, draggable button — drag via the handle bar above the button
        return (
            <div
                ref={btnRef}
                style={{
                    position: 'fixed',
                    left: position?.x ?? 32,
                    top: position?.y ?? 32,
                    zIndex: 1000,
                    userSelect: 'none',
                }}
            >
                <div
                    style={{
                        width: 32,
                        height: 8,
                        background: '#888',
                        borderRadius: 4,
                        margin: '0 auto 4px auto',
                        cursor: 'grab',
                    }}
                    title="Drag to move"
                    onMouseDown={e => {
                        const startX = e.clientX;
                        const startY = e.clientY;
                        const origX = position?.x ?? 32;
                        const origY = position?.y ?? 32;
                        const onMove = (moveEvent: MouseEvent) => {
                            const dx = moveEvent.clientX - startX;
                            const dy = moveEvent.clientY - startY;
                            let newX = origX + dx;
                            let newY = origY + dy;
                            const btnRect = btnRef.current?.getBoundingClientRect();
                            const btnWidth = btnRect?.width || 120;
                            const btnHeight = btnRect?.height || 40;
                            const maxX = window.innerWidth - btnWidth - 8;
                            const maxY = window.innerHeight - btnHeight - 8;
                            newX = Math.max(8, Math.min(newX, maxX));
                            newY = Math.max(8, Math.min(newY, maxY));
                            const newPos = { x: newX, y: newY };
                            setPosition(newPos);
                            savePosition(newPos);
                        };
                        const onUp = () => {
                            window.removeEventListener('mousemove', onMove);
                            window.removeEventListener('mouseup', onUp);
                        };
                        window.addEventListener('mousemove', onMove);
                        window.addEventListener('mouseup', onUp);
                    }}
                />
                <Button
                    id={OPEN_BUTTON_ID}
                    className="comfy-gallery-primary-btn gap-1.5"
                    disabled={loading}
                    onClick={() => { if (!loading) setOpen(true); }}
                >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {settings.buttonLabel || 'Open Gallery'}
                </Button>
            </div>
        );
    }
    return (<>
        <Button
            id={OPEN_BUTTON_ID}
            className="gap-2"
            disabled={loading}
            onClick={() => { if (!loading) setOpen(true); }}
        >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {settings.buttonLabel || 'Open Gallery'}
        </Button>
    </>);
};

export default GalleryOpenButton;
