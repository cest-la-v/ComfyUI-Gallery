import { useGalleryContext } from './GalleryContext';
import GalleryHeader from './GalleryHeader';
import GallerySidebar from './GallerySidebar';
import GalleryImageGrid from './GalleryImageGrid';
import GallerySettingsModal from './GallerySettingsModal';
import GroupView from './GroupView';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { BASE_Z_INDEX } from './ComfyAppApi';
import { cn } from '@/lib/utils';

const GalleryModal = () => {
    const {
        open, setOpen, showSettings, siderCollapsed,
        viewMode, setViewMode, setActiveFilter, setFilteredRelPaths,
    } = useGalleryContext();

    const handleSelectModel = async (model: string) => {
        try {
            const res = await fetch(`/Gallery/groups/files?by=model&value=${encodeURIComponent(model)}`, { cache: 'no-store' });
            const json = await res.json();
            setFilteredRelPaths(json.rel_paths ?? []);
            setActiveFilter({ by: 'model', value: model, label: model });
            setViewMode('all');
        } catch (e) {
            console.error('Failed to fetch group files:', e);
            setViewMode('all');
        }
    };

    const handleSelectPrompt = async (fingerprint: string, label: string) => {
        try {
            const res = await fetch(`/Gallery/groups/files?by=prompt&value=${encodeURIComponent(fingerprint)}`, { cache: 'no-store' });
            const json = await res.json();
            setFilteredRelPaths(json.rel_paths ?? []);
            setActiveFilter({ by: 'prompt', value: fingerprint, label });
            setViewMode('all');
        } catch (e) {
            console.error('Failed to fetch group files:', e);
            setViewMode('all');
        }
    };

    return (
        <>
            <Dialog open={open} onOpenChange={setOpen} modal={false}>
                <DialogContent
                    showCloseButton={false}
                    aria-describedby={undefined}
                    className="p-0 gap-0 w-[95vw] max-w-none h-[92vh] flex flex-col overflow-hidden rounded-lg"
                    style={{ zIndex: BASE_Z_INDEX + 1 }}
                    data-gallery-root
                >
                    <DialogTitle className="sr-only">Gallery</DialogTitle>
                    {/* Header bar */}
                    <div className="px-3 py-2 border-b shrink-0">
                        <GalleryHeader />
                    </div>

                    {/* Body */}
                    <div className="flex flex-1 min-h-0 overflow-hidden">
                        {viewMode === 'model' || viewMode === 'prompt' ? (
                            <GroupView
                                onSelectModel={handleSelectModel}
                                onSelectPrompt={handleSelectPrompt}
                                activeTab={viewMode === 'prompt' ? 'prompt' : 'model'}
                            />
                        ) : (
                            <>
                                {/* Sidebar */}
                                <div
                                    className={cn(
                                        "overflow-auto shrink-0 transition-all duration-200",
                                        siderCollapsed ? "w-0" : "w-[20%]"
                                    )}
                                    style={{ scrollbarWidth: 'thin', scrollbarGutter: 'stable' }}
                                >
                                    <GallerySidebar />
                                </div>
                                {/* Main image grid */}
                                <div className="flex-1 min-w-0 overflow-hidden">
                                    <GalleryImageGrid />
                                </div>
                            </>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
            {showSettings && <GallerySettingsModal />}
        </>
    );
};

export default GalleryModal;
