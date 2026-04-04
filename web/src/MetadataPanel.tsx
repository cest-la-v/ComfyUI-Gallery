import { Typography, Button, Descriptions, Tooltip, message, Tag, Popconfirm, Segmented, Spin } from 'antd';
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { FileDetails, ImageParams } from './types';
import { ComfyAppApi } from './ComfyAppApi';
import { useGalleryContext } from './GalleryContext';
import { CopyOutlined, DownloadOutlined, DeleteOutlined } from '@ant-design/icons';
import { BASE_PATH } from './ComfyAppApi';
import { saveAs } from 'file-saver';
import ReactJsonView from '@microlink/react-json-view';

const PROMPT_ROW_LIMIT = 6;

function paramsToDisplayMap(params: ImageParams | null): Record<string, string> {
    if (!params) return {};
    const out: Record<string, string> = {};

    // --- Fileinfo section ---
    const fi = params.fileinfo;
    if (fi?.filename) out['Filename'] = fi.filename;
    if (fi?.resolution) out['Resolution'] = fi.resolution;
    if (fi?.size) out['File Size'] = fi.size;
    if (fi?.date) out['Date Created'] = fi.date;

    // --- Core generation params ---
    if (params.model) out['Model'] = params.model;
    if (params.model_hash) out['Model Hash'] = params.model_hash;
    if (params.sampler) out['Sampler'] = params.sampler;
    if (params.scheduler) out['Scheduler'] = params.scheduler;
    if (params.steps != null) out['Steps'] = String(params.steps);
    if (params.cfg_scale != null) out['CFG Scale'] = String(params.cfg_scale);
    if (params.seed != null) out['Seed'] = String(params.seed);

    // --- Extended fields ---
    if (params.vae) out['VAE'] = params.vae;
    if (params.clip_skip != null) out['Clip Skip'] = String(params.clip_skip);
    if (params.denoise_strength != null) out['Denoising Strength'] = String(params.denoise_strength);
    if (params.hires_upscaler) out['Hires Upscaler'] = params.hires_upscaler;
    if (params.hires_steps != null) out['Hires Steps'] = String(params.hires_steps);
    if (params.hires_denoise != null) out['Hires Denoise'] = String(params.hires_denoise);

    // --- Prompts ---
    if (params.positive_prompt) out['Positive Prompt'] = params.positive_prompt;
    if (params.negative_prompt) out['Negative Prompt'] = params.negative_prompt;

    // --- LoRAs ---
    if (params.loras && params.loras.length > 0) {
        const loraStr = params.loras
            .map(l => l.model_strength != null ? `${l.name} (${l.model_strength})` : l.name)
            .join(', ');
        out['LoRAs'] = loraStr;
    }

    // --- Extras (dynamic A1111 fields) ---
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
    const rawFetchedForRef = useRef<string | null>(null);

    const { setImageInfoName, imageInfoName, showRawMetadata, setShowRawMetadata, settings, imagesDetailsList, showMetadataPanel } = useGalleryContext();

    const relPath = image.url.startsWith('/static_gallery/')
        ? image.url.slice('/static_gallery/'.length)
        : image.url;

    // Fetch parsed params whenever the image changes
    useEffect(() => {
        setParsedParams(null);
        setRawMetadata(null);
        rawFetchedForRef.current = null;
        if (image.type !== 'image') return;
        let cancelled = false;
        setParsedLoading(true);
        fetch(`${BASE_PATH}/Gallery/metadata/${relPath}`)
            .then(r => r.ok ? r.json() as Promise<{ params?: ImageParams }> : Promise.resolve({}))
            .then(d => {
                if (!cancelled) {
                    const p = (d as { params?: ImageParams }).params ?? null;
                    if (p) {
                        // loras/extras/formats are stored as JSON strings in SQLite
                        if (typeof p.formats === 'string') {
                            try { p.formats = JSON.parse(p.formats); } catch { p.formats = null; }
                        }
                        if (typeof p.loras === 'string') {
                            try { p.loras = JSON.parse(p.loras); } catch { p.loras = null; }
                        }
                        if (typeof p.extras === 'string') {
                            try { p.extras = JSON.parse(p.extras); } catch { p.extras = null; }
                        }
                    }
                    setParsedParams(p);
                }
            })
            .catch(() => { if (!cancelled) setParsedParams(null); })
            .finally(() => { if (!cancelled) setParsedLoading(false); });
        return () => { cancelled = true; };
    }, [relPath]);

    // Lazy-fetch raw JSON only when the Raw JSON tab is opened
    useEffect(() => {
        if (!showRawMetadata || image.type !== 'image') return;
        if (rawFetchedForRef.current === relPath) return;
        rawFetchedForRef.current = relPath;
        let cancelled = false;
        setRawLoading(true);
        fetch(`${BASE_PATH}/Gallery/metadata/${relPath}?format=raw`)
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
        const isExpanded = expandedKeys[key];
        return (
            <Typography.Paragraph
                ellipsis={value.length > 300 ? {
                    rows: PROMPT_ROW_LIMIT,
                    expandable: 'collapsible',
                    expanded: isExpanded,
                    onExpand: () => setExpandedKeys(k => ({ ...k, [key]: !isExpanded })),
                } : false}
                style={{ marginBottom: 0, whiteSpace: 'pre-line', wordBreak: 'break-word' }}
            >
                {value}
            </Typography.Paragraph>
        );
    }, [expandedKeys]);

    const items = useMemo(() => Object.entries(displayMap).map(([key, value]) => {
        const isPrompt = key.toLowerCase().includes('prompt');
        return {
            label: <Typography style={{ fontWeight: 600 }}>{key}</Typography>,
            children: (
                <Tooltip title={copiedKey === key ? 'Copied!' : 'Click to copy'} placement="top" color={copiedKey === key ? 'blue' : undefined}>
                    <Typography
                        style={{ cursor: 'pointer', wordBreak: 'break-word', whiteSpace: 'pre-line', display: 'block', maxWidth: 360 }}
                        onClick={() => {
                            navigator.clipboard.writeText(value);
                            setCopiedKey(key);
                            message.success('Copied!', 1);
                            setTimeout(() => setCopiedKey(null), 1200);
                        }}
                    >
                        {isPrompt ? renderPromptValue(key, value) : value}
                    </Typography>
                </Tooltip>
            ),
            span: 1,
        };
    }), [displayMap, copiedKey, renderPromptValue]);

    const handleDelete = useCallback(async () => {
        const currentIdx = previewableImages.findIndex(img => img.name === imageInfoName);
        const next = previewableImages[currentIdx + 1] ?? previewableImages[currentIdx - 1];
        const success = await ComfyAppApi.deleteImage(image.url);
        if (success) {
            setImageInfoName(next?.name);
            message.success('Image deleted');
        } else {
            message.error('Failed to delete image');
        }
    }, [image.url, imageInfoName, previewableImages, setImageInfoName]);

    const handleDownload = useCallback(async () => {
        try {
            const response = await fetch(`${BASE_PATH}${image.url}`, { mode: 'cors' });
            if (!response.ok) throw new Error('Network response was not ok');
            const blob = await response.blob();
            saveAs(blob, image.name);
        } catch {
            message.error('Failed to download file');
        }
    }, [image.url, image.name]);

    const handleCopyImage = useCallback(async () => {
        try {
            const img = new window.Image();
            img.crossOrigin = 'anonymous';
            img.src = `${BASE_PATH}${image.url}`;
            img.onload = async () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(img, 0, 0);
                    canvas.toBlob(async (blob) => {
                        if (blob) {
                            try {
                                await navigator.clipboard.write([new window.ClipboardItem({ [blob.type]: blob })]);
                                message.success('Image copied to clipboard');
                            } catch { message.error('Clipboard copy failed'); }
                        } else { message.error('Failed to copy image'); }
                    }, 'image/png');
                }
            };
            img.onerror = () => message.error('Failed to load image for copy');
        } catch { message.error('Failed to copy image'); }
    }, [image.url]);

    return (
        <div
            style={{
                position: 'absolute',
                top: 0,
                right: 0,
                width: 480,
                height: '100%',
                background: 'rgba(30, 30, 30, 0.95)',
                borderLeft: '1px solid #444',
                overflowY: 'auto',
                overflowX: 'hidden',
                padding: '48px 16px 16px 16px',
                zIndex: 10,
                display: 'flex',
                flexDirection: 'column',
                // Keep in layout while hidden so Ant Design's JS ellipsis measurement
                // runs before the panel is revealed — prevents row-height flicker on show.
                visibility: showMetadataPanel ? 'visible' : 'hidden',
                opacity: showMetadataPanel ? 1 : 0,
                pointerEvents: showMetadataPanel ? 'auto' : 'none',
                gap: 12,
            }}
            onClick={(e) => e.stopPropagation()}
        >
            {/* Header with close button and action buttons */}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {parsedParams?.formats?.includes('a1111') && <Tag color="blue">Civitai ✓</Tag>}
                {parsedParams?.formats?.includes('comfyui') && <Tag color="green">ComfyUI Prompt ✓</Tag>}
            </div>
            <Segmented
                value={showRawMetadata ? 'raw' : 'metadata'}
                options={[
                    { label: 'Metadata', value: 'metadata' },
                    { label: 'Raw JSON', value: 'raw' },
                ]}
                onChange={(value) => setShowRawMetadata(value === 'raw')}
                size="small"
                block
            />
            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {image.type === 'image' && (
                    <Tooltip title="Copy image to clipboard">
                        <Button icon={<CopyOutlined />} size="small" onClick={handleCopyImage}>Copy</Button>
                    </Tooltip>
                )}
                <Tooltip title="Download file">
                    <Button icon={<DownloadOutlined />} size="small" onClick={handleDownload}>Download</Button>
                </Tooltip>
                <Popconfirm
                    title="Delete the image"
                    description="Are you sure you want to delete this image?"
                    onConfirm={handleDelete}
                    okText="Yes"
                    cancelText="No"
                >
                    <Button icon={<DeleteOutlined />} size="small" danger>Delete</Button>
                </Popconfirm>
            </div>
            {/* Content: metadata table or raw JSON */}
            {image.type === 'image' && (
                showRawMetadata ? (
                    rawLoading ? (
                        <Spin style={{ margin: '32px auto', display: 'block' }} />
                    ) : (
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
                    parsedLoading ? (
                        <Spin style={{ margin: '32px auto', display: 'block' }} />
                    ) : (
                        <Descriptions
                            bordered
                            column={1}
                            items={items}
                            size="small"
                            style={{ color: '#fff', borderRadius: 8, width: '100%' }}
                            styles={{
                                label: { fontWeight: 600, width: 110 },
                                content: { fontWeight: 400 }
                            }}
                        />
                    )
                )
            )}
        </div>
    );
}
