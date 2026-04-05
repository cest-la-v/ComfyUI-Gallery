import { toast } from 'sonner';
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type React from 'react';
import type { ReactNode } from 'react';
import type { FileDetails, ImageParams } from './types';
import { ComfyAppApi } from './ComfyAppApi';
import { useGalleryContext } from './GalleryContext';
import { Copy, Download, Trash2 } from 'lucide-react';
import { BASE_PATH } from './ComfyAppApi';
import { saveAs } from 'file-saver';
import ReactJsonView from '@microlink/react-json-view';
import { cn } from '@/lib/utils';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
    AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

const PROMPT_ROW_LIMIT = 6;
const BORDER = '1px solid #303030';

interface DescRow { label: ReactNode; content: ReactNode; contentAlign?: 'center'; }

function MetadataSkeleton() {
    const rows = [
        { lw: 70,  cw: 200 }, { lw: 60,  cw: 80  }, { lw: 55,  cw: 90  },
        { lw: 75,  cw: 120 }, { lw: 50,  cw: 90  }, { lw: 55,  cw: 220 },
        { lw: 65,  cw: 60  }, { lw: 45,  cw: 50  },
    ];
    return (
        <div style={{ borderRadius: 8, border: BORDER, overflow: 'hidden', width: '100%' }}>
            {rows.map(({ lw, cw }, i) => (
                <div key={i} style={{ display: 'flex', borderBottom: i < rows.length - 1 ? BORDER : 'none', minHeight: 32, alignItems: 'center' }}>
                    <div style={{ width: 110, minWidth: 110, padding: '6px 12px', borderRight: BORDER, display: 'flex', alignItems: 'center' }}>
                        <div className="animate-pulse rounded bg-white/10" style={{ width: lw, height: 14 }} />
                    </div>
                    <div style={{ flex: 1, padding: '6px 12px', display: 'flex', alignItems: 'center' }}>
                        <div className="animate-pulse rounded bg-white/10" style={{ width: cw, height: 14 }} />
                    </div>
                </div>
            ))}
        </div>
    );
}

function RawJsonSkeleton({ dark }: { dark: boolean }) {
    const widths = [160, 80, 200, 60, 120, 90, 180, 70, 140, 50, 160, 80];
    return (
        <div className="rounded-lg p-3 px-4" style={{ background: dark ? '#2b2b2b' : '#f5f5f5' }}>
            {widths.map((w, i) => (
                <div
                    key={i}
                    className={cn("animate-pulse rounded h-3.5 my-1.5", dark ? "bg-white/10" : "bg-black/10")}
                    style={{ width: w }}
                />
            ))}
        </div>
    );
}

function paramsToDisplayMap(params: ImageParams | null): Record<string, string> {
    if (!params) return {};
    const out: Record<string, string> = {};
    const fi = params.fileinfo;
    if (fi?.filename) out['Filename'] = fi.filename;
    if (fi?.resolution) out['Resolution'] = fi.resolution;
    if (fi?.size) out['File Size'] = fi.size;
    if (fi?.date) out['Date Created'] = fi.date;
    if (params.model) out['Model'] = params.model;
    if (params.model_hash) out['Model Hash'] = params.model_hash;
    if (params.sampler) out['Sampler'] = params.sampler;
    if (params.scheduler) out['Scheduler'] = params.scheduler;
    if (params.steps != null) out['Steps'] = String(params.steps);
    if (params.cfg_scale != null) out['CFG Scale'] = String(params.cfg_scale);
    if (params.seed != null) out['Seed'] = String(params.seed);
    if (params.vae) out['VAE'] = params.vae;
    if (params.clip_skip != null) out['Clip Skip'] = String(params.clip_skip);
    if (params.denoise_strength != null) out['Denoising Strength'] = String(params.denoise_strength);
    if (params.hires_upscaler) out['Hires Upscaler'] = params.hires_upscaler;
    if (params.hires_steps != null) out['Hires Steps'] = String(params.hires_steps);
    if (params.hires_denoise != null) out['Hires Denoise'] = String(params.hires_denoise);
    if (params.positive_prompt) out['Positive Prompt'] = params.positive_prompt;
    if (params.negative_prompt) out['Negative Prompt'] = params.negative_prompt;
    if (params.loras && params.loras.length > 0) {
        out['LoRAs'] = params.loras.map(l => l.model_strength != null ? `${l.name} (${l.model_strength})` : l.name).join(', ');
    }
    if (params.extras && typeof params.extras === 'object') {
        for (const [k, v] of Object.entries(params.extras)) {
            if (v != null && v !== '') out[k] = String(v);
        }
    }
    return out;
}

export function MetadataPanel({ image }: { image: FileDetails }) {
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});
    const [parsedParams, setParsedParams] = useState<ImageParams | null>(null);
    const [parsedLoading, setParsedLoading] = useState(false);
    const [rawMetadata, setRawMetadata] = useState<Record<string, unknown> | null>(null);
    const [rawLoading, setRawLoading] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const rawFetchedForRef = useRef<string | null>(null);

    const { setImageInfoName, imageInfoName, showRawMetadata, setShowRawMetadata, settings, imagesDetailsList, showMetadataPanel } = useGalleryContext();

    const relPath = image.url.startsWith('/static_gallery/')
        ? image.url.slice('/static_gallery/'.length)
        : image.url;

    useEffect(() => {
        setParsedParams(null);
        setRawMetadata(null);
        rawFetchedForRef.current = null;
        if (image.type !== 'image') return;
        let cancelled = false;
        setParsedLoading(true);
        fetch(`${BASE_PATH}/Gallery/metadata/${relPath}`, { cache: 'no-store' })
            .then(r => r.ok ? r.json() as Promise<{ params?: ImageParams }> : Promise.resolve({}))
            .then(d => {
                if (!cancelled) {
                    const p = (d as { params?: ImageParams }).params ?? null;
                    if (p) {
                        if (typeof p.formats === 'string') { try { p.formats = JSON.parse(p.formats); } catch { p.formats = null; } }
                        if (typeof p.loras === 'string') { try { p.loras = JSON.parse(p.loras); } catch { p.loras = null; } }
                        if (typeof p.extras === 'string') { try { p.extras = JSON.parse(p.extras); } catch { p.extras = null; } }
                    }
                    setParsedParams(p);
                }
            })
            .catch(() => { if (!cancelled) setParsedParams(null); })
            .finally(() => { if (!cancelled) setParsedLoading(false); });
        return () => { cancelled = true; };
    }, [relPath]);

    useEffect(() => {
        if (!showRawMetadata || image.type !== 'image') return;
        if (rawFetchedForRef.current === relPath) return;
        rawFetchedForRef.current = relPath;
        let cancelled = false;
        setRawLoading(true);
        fetch(`${BASE_PATH}/Gallery/metadata/${relPath}?format=raw`, { cache: 'no-store' })
            .then(r => r.ok ? r.json() as Promise<{ metadata?: Record<string, unknown> }> : Promise.resolve({}))
            .then(d => { if (!cancelled) setRawMetadata((d as { metadata?: Record<string, unknown> }).metadata ?? {}); })
            .catch(() => { if (!cancelled) setRawMetadata({}); })
            .finally(() => { if (!cancelled) setRawLoading(false); });
        return () => { cancelled = true; };
    }, [showRawMetadata, relPath]);

    const displayMap = useMemo(() => paramsToDisplayMap(parsedParams), [parsedParams]);

    const previewableImages = useMemo(
        () => imagesDetailsList.filter(img => img.type === 'image' || img.type === 'media' || img.type === 'audio'),
        [imagesDetailsList]
    );

    const renderPromptValue = useCallback((key: string, value: string) => {
        if (value.length <= 300) {
            return <span style={{ whiteSpace: 'pre-line', wordBreak: 'break-word' }}>{value}</span>;
        }
        const isExpanded = expandedKeys[key];
        const clampStyle = isExpanded ? {} : {
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: PROMPT_ROW_LIMIT,
            overflow: 'hidden',
        } as React.CSSProperties;
        return (
            <div>
                <div style={{ ...clampStyle, whiteSpace: 'pre-line', wordBreak: 'break-word' }}>{value}</div>
                <button
                    className="text-xs text-primary hover:underline mt-0.5 inline-block"
                    onClick={e => { e.stopPropagation(); setExpandedKeys(k => ({ ...k, [key]: !isExpanded })); }}
                >
                    {isExpanded ? 'Collapse' : 'Expand'}
                </button>
            </div>
        );
    }, [expandedKeys]);

    const items = useMemo(() => {
        const rows: DescRow[] = [];
        const FILEINFO_KEYS = new Set(['Filename', 'Resolution', 'File Size', 'Date Created']);

        const makeRow = (key: string, value: string): DescRow => {
            const isPrompt = key.toLowerCase().includes('prompt');
            return {
                label: <span className="font-semibold text-sm">{key}</span>,
                content: (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div
                                className="cursor-pointer break-words whitespace-pre-line block"
                                style={{ maxWidth: 360 }}
                                onClick={() => {
                                    navigator.clipboard.writeText(value);
                                    setCopiedKey(key);
                                    toast.success('Copied!', { duration: 1000 });
                                    setTimeout(() => setCopiedKey(null), 1200);
                                }}
                            >
                                {isPrompt ? renderPromptValue(key, value) : value}
                            </div>
                        </TooltipTrigger>
                        <TooltipContent>{copiedKey === key ? 'Copied!' : 'Click to copy'}</TooltipContent>
                    </Tooltip>
                ),
            };
        };

        const entries = Object.entries(displayMap);
        rows.push(...entries.filter(([k]) => FILEINFO_KEYS.has(k)).map(([k, v]) => makeRow(k, v)));

        const formats = parsedParams?.formats;
        if (Array.isArray(formats) && formats.length > 0) {
            rows.push({
                label: <span className="font-semibold text-sm">Format</span>,
                content: (
                    <div className="flex gap-1 flex-wrap">
                        {formats.includes('a1111') && <Badge variant="blue">Civitai ✓</Badge>}
                        {formats.includes('comfyui') && <Badge variant="green">ComfyUI Prompt ✓</Badge>}
                    </div>
                ),
                contentAlign: 'center',
            });
        }

        rows.push(...entries.filter(([k]) => !FILEINFO_KEYS.has(k)).map(([k, v]) => makeRow(k, v)));
        return rows;
    }, [displayMap, copiedKey, renderPromptValue, parsedParams?.formats]);

    const handleDelete = useCallback(async () => {
        const currentIdx = previewableImages.findIndex(img => img.name === imageInfoName);
        const next = previewableImages[currentIdx + 1] ?? previewableImages[currentIdx - 1];
        const success = await ComfyAppApi.deleteImage(image.url);
        if (success) { setImageInfoName(next?.name); toast.success('Image deleted'); }
        else toast.error('Failed to delete image');
    }, [image.url, imageInfoName, previewableImages, setImageInfoName]);

    const handleDownload = useCallback(async () => {
        try {
            const response = await fetch(`${BASE_PATH}${image.url}`, { mode: 'cors' });
            if (!response.ok) throw new Error('Network response was not ok');
            saveAs(await response.blob(), image.name);
        } catch { toast.error('Failed to download file'); }
    }, [image.url, image.name]);

    const handleCopyImage = useCallback(async () => {
        try {
            const img = new window.Image();
            img.crossOrigin = 'anonymous';
            img.src = `${BASE_PATH}${image.url}`;
            img.onload = async () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width; canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(img, 0, 0);
                    canvas.toBlob(async (blob) => {
                        if (blob) {
                            try {
                                await navigator.clipboard.write([new window.ClipboardItem({ [blob.type]: blob })]);
                                toast.success('Image copied to clipboard');
                            } catch { toast.error('Clipboard copy failed'); }
                        } else toast.error('Failed to copy image');
                    }, 'image/png');
                }
            };
            img.onerror = () => toast.error('Failed to load image for copy');
        } catch { toast.error('Failed to copy image'); }
    }, [image.url]);

    return (
        <div
            style={{
                position: 'fixed', top: 0, right: 0, width: 480, height: '100%',
                background: 'rgba(30, 30, 30, 0.95)', borderLeft: '1px solid #444',
                padding: '48px 16px 16px 16px', zIndex: 3200,
                display: 'flex', flexDirection: 'column', gap: 12,
                visibility: showMetadataPanel ? 'visible' : 'hidden',
                opacity: showMetadataPanel ? 1 : 0,
                pointerEvents: showMetadataPanel ? 'auto' : 'none',
            }}
            onClick={(e) => e.stopPropagation()}
        >
            {/* Metadata / Raw JSON toggle */}
            <div className="flex rounded-md overflow-hidden text-xs shrink-0" style={{ border: '1px solid #444' }}>
                {(['metadata', 'raw'] as const).map(v => {
                    const active = (showRawMetadata ? 'raw' : 'metadata') === v;
                    return (
                        <button
                            key={v}
                            className={cn(
                                "flex-1 py-1 px-2 transition-colors",
                                active ? "bg-primary text-primary-foreground" : "text-[#aaa] hover:bg-white/10"
                            )}
                            onClick={() => { setShowRawMetadata(v === 'raw'); (document.activeElement as HTMLElement)?.blur(); }}
                        >
                            {v === 'metadata' ? 'Metadata' : 'Raw JSON'}
                        </button>
                    );
                })}
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 flex-wrap shrink-0">
                {image.type === 'image' && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button size="sm" variant="outline" onClick={handleCopyImage}>
                                <Copy className="h-3.5 w-3.5" />Copy
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Copy image to clipboard</TooltipContent>
                    </Tooltip>
                )}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button size="sm" variant="outline" onClick={handleDownload}>
                            <Download className="h-3.5 w-3.5" />Download
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Download file</TooltipContent>
                </Tooltip>
                <Button size="sm" variant="destructive" onClick={() => setShowDeleteConfirm(true)}>
                    <Trash2 className="h-3.5 w-3.5" />Delete
                </Button>
                <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Delete the image</AlertDialogTitle>
                            <AlertDialogDescription>Are you sure you want to delete this image?</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>No</AlertDialogCancel>
                            <AlertDialogAction
                                className={buttonVariants({ variant: 'destructive' })}
                                onClick={() => { setShowDeleteConfirm(false); handleDelete(); }}
                            >Yes</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>

            {/* Scrollable content */}
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', borderRadius: 8 }}>
                {image.type === 'image' && (
                    showRawMetadata ? (
                        rawLoading ? <RawJsonSkeleton dark={settings.darkMode} /> : (
                            <ReactJsonView
                                theme={settings.darkMode ? 'apathy' : 'apathy:inverted'}
                                src={rawMetadata || {}}
                                name={false}
                                collapsed={2}
                                enableClipboard
                                displayDataTypes={false}
                                style={{ borderRadius: 8, padding: 8, textAlign: 'left', width: '100%' }}
                            />
                        )
                    ) : (
                        parsedLoading ? <MetadataSkeleton /> : (
                            <div style={{ borderRadius: 8, border: BORDER, overflow: 'hidden', width: '100%' }}>
                                {items.map((row, i) => (
                                    <div
                                        key={i}
                                        className="flex"
                                        style={{ borderBottom: i < items.length - 1 ? BORDER : 'none', minHeight: 32 }}
                                    >
                                        <div
                                            className="flex items-center shrink-0"
                                            style={{ width: 110, minWidth: 110, padding: '6px 12px', borderRight: BORDER, background: 'rgba(255,255,255,0.04)' }}
                                        >
                                            {row.label}
                                        </div>
                                        <div
                                            className={cn("flex items-center flex-1", row.contentAlign === 'center' && "justify-center")}
                                            style={{ padding: '6px 12px' }}
                                        >
                                            {row.content}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )
                    )
                )}
            </div>
        </div>
    );
}
