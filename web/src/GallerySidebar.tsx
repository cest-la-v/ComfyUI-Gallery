import React, { useMemo, useCallback, memo, useRef } from 'react';
import { Folder, Loader2 } from 'lucide-react';
import { useGalleryContext } from './GalleryContext';
import { useDrop } from 'ahooks';
import { ComfyAppApi } from './ComfyAppApi';
import { cn } from '@/lib/utils';

// Flat folder row — handles drag-drop target and ctrl+click image selection
const FolderRow = memo(({ folderKey, selected, onSelect }: {
    folderKey: string;
    selected: boolean;
    onSelect: (key: string) => void;
}) => {
    const rowRef = useRef<HTMLDivElement>(null);
    const { data, selectedImages, setSelectedImages } = useGalleryContext();

    const folderImages = useMemo(() => {
        if (!data?.folders?.[folderKey]) return [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return Object.values(data.folders[folderKey]).filter((img: any) => img?.url).map((img: any) => img.url);
    }, [data, folderKey]);

    const allSelected = folderImages.length > 0 && folderImages.every(url => selectedImages.includes(url));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useDrop(rowRef, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onDom: (content: any) => {
            try {
                const d = typeof content === 'string' ? JSON.parse(content) : content;
                if (d?.name && d?.folder && d.folder !== folderKey) {
                    ComfyAppApi.moveImage(`${d.folder}/${d.name}`, `${folderKey}/${d.name}`);
                }
            } catch (err) { console.error('Error parsing drag data:', err); }
        },
    });

    const handleClick = (e: React.MouseEvent) => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            setSelectedImages(prev =>
                allSelected ? prev.filter(u => !folderImages.includes(u)) : Array.from(new Set([...prev, ...folderImages]))
            );
        } else {
            onSelect(folderKey);
        }
    };

    return (
        <div
            ref={rowRef}
            title={folderKey}
            className={cn(
                "flex items-center gap-1 py-0.5 px-2 cursor-pointer rounded-sm text-sm select-none",
                selected ? "bg-primary/20" : "hover:bg-accent/40",
            )}
            onClick={handleClick}
        >
            <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className={cn("px-1 py-0.5 rounded transition-colors truncate", allSelected && "bg-blue-500/15 ring-1 ring-blue-500")}>
                {folderKey}
            </span>
        </div>
    );
});
FolderRow.displayName = 'FolderRow';

const GallerySidebar = () => {
    const { data, loading, currentFolder, setCurrentFolder, siderCollapsed } = useGalleryContext();

    const folderPaths = useMemo(() => {
        if (!data?.folders) return [];
        return Object.keys(data.folders).sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data && JSON.stringify(Object.keys(data.folders ?? {}))]);

    const handleSelect = useCallback((key: string) => {
        // Clicking the already-selected folder deselects back to "All"
        setCurrentFolder(prev => prev === key ? '' : key);
    }, [setCurrentFolder]);

    if (siderCollapsed) return null;

    return (
        <div className="gallery-sidebar relative h-full">
            {loading && (
                <div className="absolute inset-0 bg-zinc-900/50 z-[100] flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            )}
            <div className="relative h-full overflow-y-auto p-1 flex flex-col gap-0.5">
                {/* "All" row — shows all images from every folder */}
                <div
                    className={cn(
                        "flex items-center gap-1 py-0.5 px-2 cursor-pointer rounded-sm text-sm select-none",
                        currentFolder === '' ? "bg-primary/20" : "hover:bg-accent/40"
                    )}
                    onClick={() => setCurrentFolder('')}
                >
                    <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="px-1 py-0.5">All</span>
                </div>
                {folderPaths.map(path => (
                    <FolderRow
                        key={path}
                        folderKey={path}
                        selected={currentFolder === path}
                        onSelect={handleSelect}
                    />
                ))}
            </div>
        </div>
    );
};

export default GallerySidebar;
