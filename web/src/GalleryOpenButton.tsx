import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useGalleryContext } from './GalleryContext';
import { useLocalStorageState, useDebounceFn } from 'ahooks';
import { useRef, useEffect } from 'react';

const GalleryOpenButton = () => {
    const { open, setOpen, loading, settings } = useGalleryContext();
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

    if (settings.hideOpenButton) {
        return (<>
            <Button
                id="comfy-ui-gallery-open-button"
                onClick={() => {
                    if (!loading) setOpen(true);
                }}
                style={{
                    display: "none"
                }}
            ></Button>
        </>);
    };

    if (settings.floatingButton) {
        // Floating, movable button
        return (
            <div
                ref={btnRef}
                style={{
                    position: 'fixed',
                    left: position?.x ?? 32,
                    top: position?.y ?? 32,
                    zIndex: 1000,
                    cursor: 'grab',
                    userSelect: 'none',
                }}
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
                        // Clamp to viewport using window.innerWidth/innerHeight
                        const btnRect = btnRef.current?.getBoundingClientRect();
                        const btnWidth = btnRect?.width || 160;
                        const btnHeight = btnRect?.height || 48;
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
                />
                <Button
                    id="comfy-ui-gallery-open-button"
                    className="min-w-[120px]"
                    onClick={() => {
                        if (!loading) setOpen(true);
                    }}
                    disabled={loading}
                >
                    {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                    {settings.buttonLabel || 'Open Gallery'}
                </Button>
            </div>
        );
    }
    // Not floating
    return (<>
        <Button
            id="comfy-ui-gallery-open-button"
            onClick={() => {
                if (!loading) setOpen(true);
            }}
            disabled={loading}
        >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {settings.buttonLabel || 'Open Gallery'}
        </Button>
    </>);
};

export default GalleryOpenButton;
