import React, { useMemo, useCallback } from 'react';
import Lightbox from 'yet-another-react-lightbox';
import type { Slide } from 'yet-another-react-lightbox';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import { useGalleryContext } from './GalleryContext';
import type { FileDetails } from './types';
import { BASE_PATH } from './ComfyAppApi';
import { Music } from 'lucide-react';
import { GalleryOverlayPlugin } from './GalleryLightboxPlugin';

// 'custom' type prevents yarl's isImageSlide() from returning true for video/audio,
// which would incorrectly activate the Zoom plugin on non-image slides.
type GallerySlide = Slide & { fileDetails: FileDetails; type?: string };

const GalleryLightbox = () => {
    const {
        imagesDetailsList,
        lightboxOpen,
        lightboxIndex, setLightboxIndex,
        imageRotation, setImageRotation,
        imageFlipH, setImageFlipH,
        imageFlipV, setImageFlipV,
        setImageInfoName,
        setPreviewingVideo,
        closeLightbox,
    } = useGalleryContext();

    const previewableImages = useMemo(() =>
        imagesDetailsList.filter(img => img.type === 'image' || img.type === 'media' || img.type === 'audio'),
        [imagesDetailsList]
    );

    const slides = useMemo(() =>
        previewableImages.map(img => ({
            src: `${BASE_PATH}${img.url}`,
            fileDetails: img,
            // Mark non-image slides so yarl's isImageSlide() returns false,
            // preventing the Zoom plugin from wrapping video/audio slides.
            ...(img.type !== 'image' ? { type: 'custom' } : {}),
        })) as GallerySlide[],
        [previewableImages]
    );

    const handleLightboxView = useCallback(({ index }: { index: number }) => {
        const img = previewableImages[index];
        setLightboxIndex(index);
        setImageRotation(0);
        setImageFlipH(false);
        setImageFlipV(false);
        if (img) {
            setImageInfoName(img.name);
            if (img.type === 'media' || img.type === 'audio') setPreviewingVideo(img.name);
            else setPreviewingVideo(undefined);
        }
    }, [previewableImages, setLightboxIndex, setImageRotation, setImageFlipH, setImageFlipV, setImageInfoName, setPreviewingVideo]);

    const handleLightboxClose = useCallback(() => {
        closeLightbox();
    }, [closeLightbox]);

    const renderSlide = useCallback(({ slide }: { slide: Slide }) => {
        const s = slide as GallerySlide;
        const img = s.fileDetails;
        if (!img) return undefined;
        if (img.type === 'media') {
            return (
                <video
                    key={img.name}
                    style={{ maxWidth: '80%', maxHeight: '85vh' }}
                    src={`${BASE_PATH}${img.url}`}
                    autoPlay
                    controls
                    preload="none"
                />
            );
        }
        if (img.type === 'audio') {
            return (
                <div key={img.name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '80vh', gap: 24 }}>
                    <Music style={{ color: '#1890ff' }} className="h-20 w-20" />
                    <span style={{ color: '#e6e6e6', fontSize: 16, maxWidth: 400, textAlign: 'center' }}>{img.name}</span>
                    <audio src={`${BASE_PATH}${img.url}`} autoPlay controls style={{ width: 360 }} />
                </div>
            );
        }
        return undefined; // use yarl default image renderer
    }, []);

    // Apply rotation/flip via slideContainer so it wraps the Zoom plugin's content
    const renderSlideContainer = useCallback(({ slide, children }: { slide: Slide; children?: React.ReactNode }) => {
        const gs = slide as GallerySlide;
        if (gs.fileDetails?.type !== 'image') return <>{children}</>;

        const transforms: string[] = [];
        if (imageRotation) transforms.push(`rotate(${imageRotation}deg)`);
        if (imageFlipH) transforms.push('scaleX(-1)');
        if (imageFlipV) transforms.push('scaleY(-1)');

        if (!transforms.length) return <>{children}</>;

        return (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                transform: transforms.join(' '), transition: 'transform 0.2s ease' }}>
                {children}
            </div>
        );
    }, [imageRotation, imageFlipH, imageFlipV]);

    const yarlRoot = useMemo(() => document.getElementById('comfy-gallery-yarl-root'), []);

    if (!lightboxOpen) return null;

    return (
        <Lightbox
            open={lightboxOpen}
            index={lightboxIndex}
            slides={slides}
            close={handleLightboxClose}
            on={{ view: handleLightboxView }}
            render={{ slide: renderSlide, slideContainer: renderSlideContainer }}
            plugins={[Zoom, GalleryOverlayPlugin]}
            portal={{ root: yarlRoot }}
            styles={{ root: { '--yarl__color_backdrop': 'rgba(0,0,0,0.88)' } as Parameters<typeof Lightbox>[0]['styles'] extends { root?: infer R } ? R : never }}
        />
    );
};

export default GalleryLightbox;
