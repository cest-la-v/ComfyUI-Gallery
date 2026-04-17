import { toast } from 'sonner';
import type { FileDetails } from './types';
import { Info, Trash2, Music } from 'lucide-react';
import React, { useRef, useState } from 'react';
import { useDrag } from 'ahooks';
import { useGalleryContext } from './GalleryContext';
import { BASE_PATH, ComfyAppApi } from './ComfyAppApi';
import { Button } from '@/components/ui/button';
import {
    AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
    AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const ImageCardWidth = 350;
export const ImageCardHeight = 450;

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
    const { settings, selectedImages, setSelectedImages, setShowMetadataPanel } = useGalleryContext();
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
                    border: dragging ? '2px solid #1890ff' : '1px solid rgba(255,255,255,0.1)',
                    opacity: dragging ? 0.5 : 1,
                    display: 'flex',
                    alignContent: 'center',
                    justifyContent: 'center',
                    alignItems: 'center',
                    position: 'relative',
                    cursor: 'grab',
                    boxShadow: selectedImages.includes(image.url) ? '0 0 0 3px #1890ff' : undefined,
                }}
                onClick={handleCardClick}
            >
                {/* Delete button (hover) */}
                <div className={cn(
                    "absolute top-2 right-2 z-[3] transition-opacity",
                    deleteConfirmOpen ? "opacity-100" : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"
                )}>
                    <Button
                        size="icon"
                        variant="destructive"
                        className="h-7 w-7 bg-black/60 hover:bg-destructive border-none shadow"
                        onClick={e => { e.stopPropagation(); setDeleteConfirmOpen(true); }}
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                </div>

                {/* Model badge overlay (prompt mode only) */}
                {showModelBadge && image.model && (
                    <div className="absolute top-2 left-2 z-[3] max-w-[160px] truncate rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white/80 leading-[18px]">
                        {image.model}
                    </div>
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
                        <Music style={{ marginBottom: 24, color: '#1890ff' }} className="h-16 w-16" />
                        <span className="mb-4 px-4 text-center max-w-full text-[#e6e6e6] truncate text-sm">
                            {image.name}
                        </span>
                        <audio controls style={{ width: '90%', height: 40 }} src={`${BASE_PATH}${image.url}`} onClick={e => e.stopPropagation()} />
                        <button
                            className="mt-2 text-xs text-cyan-400 hover:underline"
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

                {/* Bottom bar: filename + info button */}
                <div
                    style={{
                        position: 'absolute',
                        backgroundColor: '#00000042',
                        width: '-webkit-fill-available',
                        padding: '10px',
                        bottom: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                    }}
                >
                    <span
                        className="font-semibold text-white text-sm truncate mr-2"
                        style={{ margin: 0 }}
                    >
                        {image.name}
                    </span>
                    <Button
                        size="icon"
                        className="h-8 w-8 shrink-0 bg-cyan-600/80 hover:bg-cyan-500 text-white border-none"
                        onClick={e => {
                            e.stopPropagation();
                            onInfoClick(image.name);
                            setShowMetadataPanel(true);
                            onOpenLightbox();
                        }}
                    >
                        <Info className="h-4 w-4" />
                    </Button>
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
