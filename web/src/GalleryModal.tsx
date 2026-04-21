import { cn } from '@/lib/utils';
import { useGalleryContext } from './GalleryContext';
import GalleryHeader from './GalleryHeader';
import GalleryGrid from './GalleryGrid';
import GalleryLightbox from './GalleryLightbox';
import GallerySettingsModal from './GallerySettingsModal';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useModalDismiss } from './hooks/useModalDismiss';

const GalleryModal = () => {
    const { open, setOpen, showSettings, lightboxOpen, settings } = useGalleryContext();
    const isBottom = settings.galleryLayout === 'bottom';

    const dismiss = useModalDismiss(() => setOpen(false), { disabled: showSettings || lightboxOpen });

    return (
        <>
            <Dialog open={open} onOpenChange={setOpen} modal={false}>
                <DialogContent
                    variant={isBottom ? 'bottom-sheet' : 'default'}
                    showCloseButton={false}
                    aria-describedby={undefined}
                    className={cn(
                        "p-0 gap-0 max-w-none flex flex-col overflow-hidden",
                        isBottom
                            ? "w-full h-[88vh] rounded-t-2xl rounded-b-none"
                            : "w-[95vw] h-[92vh] rounded-lg"
                    )}
                    style={{ zIndex: 'var(--cg-z-content)' }}
                    onInteractOutside={dismiss.onInteractOutside}
                    onEscapeKeyDown={dismiss.onEscapeKeyDown}
                    onOverlayClick={dismiss.onOverlayClick}
                    data-gallery-root
                >
                    <DialogTitle className="sr-only">Gallery</DialogTitle>

                    {isBottom ? (
                        <>
                            {/* Drag handle — visual signal only, no swipe gesture */}
                            <div className="flex justify-center pt-2 pb-1 shrink-0">
                                <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
                            </div>
                            <main className="relative flex-1 min-h-0 min-w-0 overflow-hidden">
                                <GalleryGrid />
                                <GalleryLightbox />
                            </main>
                            <footer className="px-3 py-2 border-t shrink-0">
                                <GalleryHeader />
                            </footer>
                        </>
                    ) : (
                        <>
                            <header className="px-3 py-2 border-b shrink-0">
                                <GalleryHeader />
                            </header>
                            <main className="relative flex-1 min-h-0 min-w-0 overflow-hidden">
                                <GalleryGrid />
                                <GalleryLightbox />
                            </main>
                        </>
                    )}
                </DialogContent>
            </Dialog>
            {showSettings && <GallerySettingsModal />}
        </>
    );
};

export default GalleryModal;
