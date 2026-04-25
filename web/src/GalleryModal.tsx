import { cn } from '@/lib/utils';
import { useGalleryContext } from './GalleryContext';
import GalleryHeader from './GalleryHeader';
import GalleryGrid from './GalleryGrid';
import GalleryOverview from './GalleryOverview';
import GalleryLightbox from './GalleryLightbox';
import GallerySettingsModal from './GallerySettingsModal';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useModalDismiss } from './hooks/useModalDismiss';
import { SidebarProvider } from '@/components/ui/sidebar';
import GallerySidebar, { GallerySidebarTabStrip } from './GallerySidebar';
import ModelsView from './ModelsView';
import PromptsView from './PromptsView';

const GalleryModal = () => {
    const { open, setOpen, showSettings, lightboxOpen, settings, gridView, gallerySection } = useGalleryContext();
    const isBottom = settings.galleryLayout === 'bottom';

    const dismiss = useModalDismiss(() => setOpen(false), { disabled: showSettings || lightboxOpen });

    /** Renders the active section content (Assets grid/overview or Models/Prompts). */
    const sectionContent = (
        <main className="relative flex-1 min-h-0 min-w-0 overflow-hidden">
            {gallerySection === 'assets' ? (
                <>
                    {gridView === 'overview' ? <GalleryOverview /> : <GalleryGrid />}
                    <GalleryLightbox />
                </>
            ) : gallerySection === 'models' ? (
                <ModelsView />
            ) : (
                <PromptsView />
            )}
        </main>
    );

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
                            <div className="flex justify-center pt-2 pb-1 shrink-0">
                                <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
                            </div>
                            <GallerySidebarTabStrip />
                            {sectionContent}
                            <footer className="px-3 py-2 border-t shrink-0">
                                <GalleryHeader />
                            </footer>
                        </>
                    ) : (
                        <>
                            <header className="px-3 py-2 border-b shrink-0">
                                <GalleryHeader />
                            </header>
                            <SidebarProvider className="flex-1 min-h-0" defaultOpen={false}>
                                <GallerySidebar />
                                {sectionContent}
                            </SidebarProvider>
                        </>
                    )}
                </DialogContent>
            </Dialog>
            {showSettings && <GallerySettingsModal />}
        </>
    );
};

export default GalleryModal;
