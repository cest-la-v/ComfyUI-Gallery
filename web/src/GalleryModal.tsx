import { useGalleryContext } from './GalleryContext';
import GalleryHeader from './GalleryHeader';
import GalleryGrid from './GalleryGrid';
import GalleryLightbox from './GalleryLightbox';
import GallerySettingsModal from './GallerySettingsModal';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useModalDismiss } from './hooks/useModalDismiss';

const GalleryModal = () => {
    const { open, setOpen, showSettings, lightboxOpen } = useGalleryContext();

    const dismiss = useModalDismiss(() => setOpen(false), { disabled: showSettings || lightboxOpen });

    return (
        <>
            <Dialog open={open} onOpenChange={setOpen} modal={false}>
                <DialogContent
                    showCloseButton={false}
                    aria-describedby={undefined}
                    className="p-0 gap-0 w-[95vw] max-w-none h-[92vh] flex flex-col overflow-hidden rounded-lg"
                    style={{ zIndex: 'var(--cg-z-content)' }}
                    onInteractOutside={dismiss.onInteractOutside}
                    onEscapeKeyDown={dismiss.onEscapeKeyDown}
                    onOverlayClick={dismiss.onOverlayClick}
                    data-gallery-root
                >
                    <DialogTitle className="sr-only">Gallery</DialogTitle>
                    {/* Header bar */}
                    <div className="px-3 py-2 border-b shrink-0">
                        <GalleryHeader />
                    </div>

                    {/* Body */}
                    <div className="relative flex-1 min-h-0 min-w-0 overflow-hidden">
                        <GalleryGrid />
                        <GalleryLightbox />
                    </div>
                </DialogContent>
            </Dialog>
            {showSettings && <GallerySettingsModal />}
        </>
    );
};

export default GalleryModal;
