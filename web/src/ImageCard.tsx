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
// Image from antd is kept temporarily as the PreviewGroup trigger mechanism
import { Image } from 'antd';

export const ImageCardWidth = 350;
export const ImageCardHeight = 450;

function ImageCard({
    image,
    onInfoClick
}: {
    image: FileDetails & { dragFolder?: string };
    onInfoClick: (imageName: string | undefined) => void;
}) {
    const { settings, selectedImages, setSelectedImages, setShowMetadataPanel } = useGalleryContext();
    const dragRef = useRef<HTMLDivElement>(null);
    const [dragging, setDragging] = useState(false);
    const [hovered, setHovered] = useState(false);
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

    return (
        <>
            <div
                className="image-card"
                ref={dragRef}
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
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
                {(hovered || deleteConfirmOpen) && (
                    <div className="absolute top-2 right-2 z-[3]">
                        <Button
                            size="icon"
                            variant="destructive"
                            className="h-7 w-7 bg-black/60 hover:bg-destructive border-none shadow"
                            onClick={e => { e.stopPropagation(); setDeleteConfirmOpen(true); }}
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                )}

                {/* Image content */}
                {image.type === 'image' ? (
                    <Image
                        id={image.url}
                        style={{ objectFit: 'cover', maxWidth: ImageCardWidth, width: '100%', height: 'auto', userSelect: 'none', cursor: 'grab' }}
                        src={`${BASE_PATH}${image.url}`}
                        loading="lazy"
                        onClick={() => { onInfoClick(image.name); document.getElementById(image.url)?.click(); }}
                        alt={image.name}
                        draggable
                        onDragStart={handleNativeDragStart}
                    />
                ) : image.type === 'audio' ? (
                    <div className="flex flex-col items-center justify-center w-full h-full">
                        <Music style={{ fontSize: 64, color: '#1890ff', marginBottom: 24 }} className="h-16 w-16" />
                        <span className="mb-4 px-4 text-center max-w-full text-[#e6e6e6] truncate text-sm">
                            {image.name}
                        </span>
                        <audio controls style={{ width: '90%', height: 40 }} src={`${BASE_PATH}${image.url}`} onClick={e => e.stopPropagation()} />
                        <Image
                            id={image.url}
                            style={{ display: 'none' }}
                            src={`${BASE_PATH}${image.url}`}
                            loading="lazy"
                            alt={image.name}
                        />
                    </div>
                ) : (
                    <>
                        <video
                            style={{ maxHeight: ImageCardHeight, cursor: 'pointer' }}
                            src={`${BASE_PATH}${image.url}`}
                            autoPlay={settings.autoPlayVideos}
                            loop={settings.autoPlayVideos}
                            muted
                            preload={!settings.autoPlayVideos ? undefined : 'none'}
                            onClick={() => { onInfoClick(image.name); document.getElementById(image.url)?.click(); }}
                            draggable
                            onDragStart={handleNativeDragStart}
                        />
                        <Image
                            id={image.url}
                            style={{ display: 'none' }}
                            src={`${BASE_PATH}${image.url}`}
                            loading="lazy"
                            alt={image.name}
                        />
                    </>
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
                            document.getElementById(image.url)?.click();
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
