import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import {
    AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
    AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { useGalleryContext } from './GalleryContext';
import { BASE_PATH, ComfyAppApi } from './ComfyAppApi';
import JSZip from 'jszip';
import FileSaver from 'file-saver';

const GallerySelectionBar = () => {
    const { selectedImages, setSelectedImages, mutate, markDeleted } = useGalleryContext();

    const [downloading, setDownloading] = useState(false);
    const [showDownloadConfirm, setShowDownloadConfirm] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    const handleBulkDownload = useCallback(async () => {
        setDownloading(true);
        try {
            const zip = new JSZip();
            await Promise.all(selectedImages.map(async (url) => {
                try {
                    const fetchUrl = url.startsWith('http') ? url : `${BASE_PATH}${url}`;
                    const blob = await (await fetch(fetchUrl)).blob();
                    zip.file(url.split('/').pop() || 'image', blob);
                } catch (e) { console.error('Failed to fetch image:', url, e); }
            }));
            FileSaver.saveAs(await zip.generateAsync({ type: 'blob' }), 'comfy-ui-gallery-images.zip');
        } catch { toast.error('Failed to download images.'); }
        finally { setDownloading(false); }
    }, [selectedImages]);

    const handleBulkDelete = useCallback(async () => {
        let deleted = 0;
        const failed: string[] = [];
        for (const url of selectedImages) {
            try {
                if (await ComfyAppApi.deleteImage(url)) {
                    deleted++;
                    markDeleted(url);
                    mutate((oldData) => {
                        if (!oldData?.folders) return oldData;
                        const folders = { ...oldData.folders };
                        for (const folder of Object.keys(folders)) {
                            const files = { ...folders[folder] };
                            for (const filename of Object.keys(files)) {
                                if (files[filename].url === url) delete files[filename];
                            }
                            if (Object.keys(files).length === 0) delete folders[folder];
                            else folders[folder] = files;
                        }
                        return { ...oldData, folders };
                    });
                } else { failed.push(url); }
                await new Promise(res => setTimeout(res, 50));
            } catch (e) { console.error('Failed to delete image:', url, e); failed.push(url); }
        }
        setSelectedImages([]);
        if (failed.length > 0) toast.warning(`Deleted ${deleted} image(s), ${failed.length} failed.`);
        else toast.success(`Deleted ${deleted} image(s).`);
    }, [selectedImages, mutate, markDeleted, setSelectedImages]);

    if (selectedImages.length === 0) return null;

    return (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/50 shrink-0 sticky top-0 z-[var(--cg-z-popup)]">
            <span className="text-sm text-muted-foreground shrink-0">
                {selectedImages.length} selected
            </span>
            <div className="flex items-center gap-2 ml-auto">
                <Button
                    size="sm"
                    variant="outline"
                    disabled={downloading}
                    onClick={() => !downloading && setShowDownloadConfirm(true)}
                >
                    {downloading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Download
                </Button>
                <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setShowDeleteConfirm(true)}
                >
                    Delete
                </Button>
                <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelectedImages([])}
                >
                    Clear
                </Button>
            </div>

            <AlertDialog open={showDownloadConfirm} onOpenChange={setShowDownloadConfirm}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Download Selected Images</AlertDialogTitle>
                        <AlertDialogDescription>
                            Download {selectedImages.length} selected image(s) as a ZIP file?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => toast.info('Download cancelled')}>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={async () => { setShowDownloadConfirm(false); await handleBulkDownload(); }}>
                            Download ({selectedImages.length})
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Selected Images</AlertDialogTitle>
                        <AlertDialogDescription>
                            Delete {selectedImages.length} selected image(s)? This cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => toast.info('Delete cancelled')}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            autoFocus
                            className={buttonVariants({ variant: 'destructive' })}
                            onClick={async () => { setShowDeleteConfirm(false); await handleBulkDelete(); }}
                        >
                            Delete ({selectedImages.length})
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default GallerySelectionBar;
