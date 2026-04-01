import { Typography, Button, Descriptions, Tooltip, message, Tag, Popconfirm, Segmented } from 'antd';
import { parseComfyMetadata, detectMetadataSources } from './metadata-parser/metadataParser';
import { useState, useMemo, useCallback } from 'react';import type { FileDetails } from './types';
import { ComfyAppApi } from './ComfyAppApi';
import { useGalleryContext } from './GalleryContext';
import CopyOutlined from '@ant-design/icons/lib/icons/CopyOutlined';
import DownloadOutlined from '@ant-design/icons/lib/icons/DownloadOutlined';
import DeleteOutlined from '@ant-design/icons/lib/icons/DeleteOutlined';
import { BASE_PATH } from './ComfyAppApi';
import { saveAs } from 'file-saver';
import ReactJsonView from '@microlink/react-json-view';

const PROMPT_ROW_LIMIT = 6;

export function MetadataPanel({ image }: { image: FileDetails }) {
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});
    const meta = useMemo(() => parseComfyMetadata(image.metadata, 'auto'), [image.metadata]);
    const sources = useMemo(() => detectMetadataSources(image.metadata), [image.metadata]);
    const { setImageInfoName, imageInfoName, showRawMetadata, setShowRawMetadata, settings, imagesDetailsList, showMetadataPanel } = useGalleryContext();
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

    const items = useMemo(() => Object.entries(meta).map(([key, value]) => {
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
    }), [meta, copiedKey, renderPromptValue]);

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
                display: showMetadataPanel ? 'flex' : 'none',
                pointerEvents: showMetadataPanel ? 'auto' : 'none',
                flexDirection: 'column',
                gap: 12,
            }}
            onClick={(e) => e.stopPropagation()}
        >
            {/* Header with close button and action buttons */}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {sources.hasA1111 && <Tag color="blue">Civitai ✓</Tag>}
                {sources.hasPrompt && <Tag color="green">ComfyUI Prompt ✓</Tag>}
                {sources.hasWorkflow && <Tag color="orange">ComfyUI Workflow ✓</Tag>}
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
                    <ReactJsonView
                        theme={settings.darkMode ? 'apathy' : 'apathy:inverted'}
                        src={image.metadata || {}}
                        name={false}
                        collapsed={2}
                        enableClipboard
                        displayDataTypes={false}
                        style={{ borderRadius: 8, padding: 8, textAlign: 'left', width: '100%' }}
                    />
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
            )}
        </div>
    );
}
