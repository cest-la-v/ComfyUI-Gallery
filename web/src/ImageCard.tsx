import { toast } from 'sonner';
import type { FileDetails } from './types';
import { Trash2, Music } from 'lucide-react';
import React, { useRef, useState } from 'react';
import { useDrag } from 'ahooks';
import { useGalleryContext } from './GalleryContext';
import { BASE_PATH, ComfyAppApi } from './ComfyAppApi';
import { Button } from '@/components/ui/button';
import {
    AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
    AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const ImageCardWidth = 350;
export const ImageCardHeight = 450;

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatShortDate(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function fileExt(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

function ImageCard({
    image,
    onInfoClick,
    onOpenLightbox,
    showModelBadge = false,
}: {
    image: FileDetails & { dragFolder?: string };
    onInfoClick: (imageName: string | undefined) => void;
    onOpenLightbox: () => void;
    showModelBadge?: boolean;
}) {
    const { settings, selectedImages, setSelectedImages } = useGalleryContext();
    const dragRef = useRef<HTMLDivElement>(null);
    const [dragging, setDragging] = useState(false);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

    useDrag(
        { name: image.name, folder: image.dragFolder || '', type: image.type, url: image.url },
        dragRef,
        { onDragStart: () => setDragging(true), onDragEnd: () => setDragging(false) }
    );

    const handleCardClick = (event: React.MouseEvent) => {
        if (event.ctrlKey || event.metaKey) {
            event.stopPropagation();
            event.preventDefault();
            setSelectedImages(prev =>
                prev.includes(image.url) ? prev.filter(u => u !== image.url) : [...prev, image.url]
            );
        } else {
            setSelectedImages([]);
        }
    };

    const handleNativeDragStart = (event: React.DragEvent<HTMLImageElement | HTMLVideoElement | HTMLAudioElement>) => {
        const ext = (image.name || image.url).split('.').pop()?.toLowerCase() || '';
        const mimeMap: Record<string, string> = {
            jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
            webp: 'image/webp', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
            mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
            mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', flac: 'audio/flac', ogg: 'audio/ogg',
        };
        const mime = mimeMap[ext] || (image.type === 'image' ? 'image/png' : image.type === 'audio' ? 'audio/wav' : 'video/mp4');
        event.dataTransfer.setData('text/uri-list', `${BASE_PATH}${image.url}`);
        event.dataTransfer.setData('DownloadURL', `${mime}:${image.name}:${window.location.origin + BASE_PATH + image.url}`);
    };

    const openLightbox = () => { onInfoClick(image.name); onOpenLightbox(); };

    return (
        <>
            <div
                className="image-card group"
                ref={dragRef}
                style={{
                    width: ImageCardWidth,
                    height: ImageCardHeight,
                    borderRadius: 8,
                    overflow: 'hidden',
                    margin: '15px',
                    border: dragging ? '2px solid var(--primary)' : '1px solid var(--border)',
                    opacity: dragging ? 0.5 : 1,
                    display: 'flex',
                    alignContent: 'center',
                    justifyContent: 'center',
                    alignItems: 'center',
                    position: 'relative',
                    cursor: 'grab',
                    boxShadow: selectedImages.includes(image.url) ? '0 0 0 3px var(--primary)' : undefined,
                }}
                onClick={handleCardClick}
            >
                {/* Delete button (hover) */}
                <div className={cn(
                    "absolute top-2 right-2 z-[var(--cg-z-card-overlay)] transition-opacity",
                    deleteConfirmOpen ? "opacity-100" : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"
                )}>
                    <Button
                        size="icon"
                        variant="destructive"
                        className="h-7 w-7 bg-background/60 hover:bg-destructive border-none shadow"
                        onClick={e => { e.stopPropagation(); setDeleteConfirmOpen(true); }}
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                </div>

                {/* Model badge overlay (prompt mode only) */}
                {showModelBadge && image.model && (
                    <Badge className="absolute top-2 left-2 z-[var(--cg-z-card-overlay)] max-w-[160px] bg-background/60 text-foreground/80 border-0 font-normal text-[11px] leading-[18px] flex">
                        <span className="truncate">{image.model}</span>
                    </Badge>
                )}

                {/* Image content */}
                {image.type === 'image' ? (
                    <img
                        style={{ objectFit: 'cover', maxWidth: ImageCardWidth, width: '100%', height: 'auto', userSelect: 'none', cursor: 'pointer' }}
                        src={`${BASE_PATH}${image.url}`}
                        loading="lazy"
                        onClick={openLightbox}
                        alt={image.name}
                        draggable
                        onDragStart={handleNativeDragStart}
                    />
                ) : image.type === 'audio' ? (
                    <div className="flex flex-col items-center justify-center w-full h-full">
                        <Music style={{ marginBottom: 24, color: 'var(--primary)' }} className="h-16 w-16" />
                        <span className="mb-4 px-4 text-center max-w-full text-muted-foreground truncate text-sm">
                            {image.name}
                        </span>
                        <audio controls style={{ width: '90%', height: 40 }} src={`${BASE_PATH}${image.url}`} onClick={e => e.stopPropagation()} />
                        <button
                            className="mt-2 text-xs text-primary hover:underline"
                            onClick={openLightbox}
                        >Open in viewer</button>
                    </div>
                ) : (
                    <video
                        style={{ maxHeight: ImageCardHeight, cursor: 'pointer' }}
                        src={`${BASE_PATH}${image.url}`}
                        autoPlay={settings.autoPlayVideos}
                        loop={settings.autoPlayVideos}
                        muted
                        preload={!settings.autoPlayVideos ? undefined : 'none'}
                        onClick={openLightbox}
                        draggable
                        onDragStart={handleNativeDragStart}
                    />
                )}

                {/* Bottom bar: filename + file info */}
                <div
                    style={{
                        position: 'absolute',
                        backgroundColor: 'color-mix(in oklch, var(--background) 60%, transparent)',
                        width: '-webkit-fill-available',
                        padding: '10px',
                        bottom: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                    }}
                >
                    <span
                        className="font-semibold text-foreground text-sm truncate"
                        style={{ margin: 0 }}
                    >
                        {image.name}
                    </span>
                    <span className="text-xs text-muted-foreground truncate">
                        {[
                            image.width && image.height ? `${image.width}×${image.height}` : null,
                            image.file_size != null ? formatFileSize(image.file_size) : null,
                            fileExt(image.name) || null,
                            image.timestamp ? formatShortDate(image.timestamp) : null,
                        ].filter(Boolean).join(' · ')}
                    </span>
                </div>
            </div>

            {/* Delete confirm dialog */}
            <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete the image</AlertDialogTitle>
                        <AlertDialogDescription>Are you sure you want to delete this image?</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={e => e.stopPropagation()}>No</AlertDialogCancel>
                        <AlertDialogAction
                            className={buttonVariants({ variant: 'destructive' })}
                            onClick={async e => {
                                e.stopPropagation();
                                setDeleteConfirmOpen(false);
                                const success = await ComfyAppApi.deleteImage(image.url);
                                if (success) toast.success('Image deleted');
                                else toast.error('Failed to delete image');
                            }}
                        >Yes</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

export default ImageCard;
