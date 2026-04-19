import { toast } from 'sonner';
import { useState, useCallback, useEffect, useRef } from 'react';
import type React from 'react';
import type { FileDetails, ImageParams } from './types';
import { useGalleryContext } from './GalleryContext';
import { BASE_PATH } from './ComfyAppApi';
import ReactJsonView from '@microlink/react-json-view';
import { cn } from '@/lib/utils';
import { badgeVariants } from '@/components/ui/badge';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Copy, Loader2 } from 'lucide-react';

const PROMPT_CLAMP = 3;

// ─── Skeleton ────────────────────────────────────────────────────────────────

function MetadataSkeleton() {
    const rows = [
        { lw: 70, cw: 200 }, { lw: 60, cw: 80 }, { lw: 55, cw: 90 },
        { lw: 75, cw: 120 }, { lw: 50, cw: 90 }, { lw: 55, cw: 220 },
        { lw: 65, cw: 60 },  { lw: 45, cw: 50 },
    ];
    return (
        <div className="flex flex-col gap-4 pt-1">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {rows.slice(0, 4).map(({ lw, cw }, i) => (
                    <div key={i} className="flex flex-col gap-1">
                        <div className="animate-pulse rounded bg-foreground/10 h-3" style={{ width: lw }} />
                        <div className="animate-pulse rounded bg-foreground/10 h-3.5" style={{ width: cw }} />
                    </div>
                ))}
            </div>
            <div className="flex gap-2">
                {[60, 100].map((w, i) => (
                    <div key={i} className="animate-pulse rounded-full bg-foreground/10 h-5" style={{ width: w }} />
                ))}
            </div>
            <div className="h-px bg-border" />
            {rows.slice(4).map(({ lw, cw }, i) => (
                <div key={i} className="flex gap-2 items-center">
                    <div className="animate-pulse rounded bg-foreground/10 h-3" style={{ width: lw }} />
                    <div className="animate-pulse rounded-full bg-foreground/10 h-5" style={{ width: cw }} />
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
                    className={cn('animate-pulse rounded h-3.5 my-1.5', dark ? 'bg-white/10' : 'bg-black/10')}
                    style={{ width: w }}
                />
            ))}
        </div>
    );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SubSectionLabel({ children }: { children: React.ReactNode }) {
    return <p className="font-semibold text-sm text-foreground mb-2">{children}</p>;
}

function Divider() {
    return <div className="h-px bg-border my-3" />;
}

/** Clickable pill chip for Resources (model / LoRA / VAE / upscaler). */
function ResourceChip({ label, sub }: { label: string; sub?: string }) {
    return (
        <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
            <span>{label}</span>
            {sub && <span className="text-muted-foreground">({sub})</span>}
        </span>
    );
}

/** `key: value` badge chip for Generation/Extras. */
function ParamChip({ label, value }: { label: string; value: string }) {
    return (
        <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs">
            <span className="text-muted-foreground">{label}:</span>
            <span className="font-medium text-foreground">{value}</span>
        </span>
    );
}

/** Full-width prompt block with label, copy button, and expand/collapse. */
function PromptBlock({
    label,
    text,
    muted = false,
}: {
    label: string;
    text: string;
    muted?: boolean;
}) {
    const [expanded, setExpanded] = useState(false);
    const needsClamp = text.length > 200;

    const clampStyle: React.CSSProperties = needsClamp && !expanded
        ? { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: PROMPT_CLAMP, overflow: 'hidden' }
        : {};

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
                <span className="font-semibold text-sm text-foreground">{label}</span>
                <button
                    className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => {
                        navigator.clipboard.writeText(text);
                        toast.success('Copied!', { duration: 1000 });
                    }}
                    title="Copy"
                >
                    <Copy size={13} />
                </button>
            </div>
            <div className={cn('text-sm break-words whitespace-pre-line', muted && 'text-muted-foreground')}
                style={clampStyle}>
                {text}
            </div>
            {needsClamp && (
                <button
                    className="text-xs text-primary hover:underline self-start"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => setExpanded(v => !v)}
                >
                    {expanded ? 'Show less' : 'Show more'}
                </button>
            )}
        </div>
    );
}

/** Format badge that acts as a copy button. */
function FormatBadge({
    label,
    variant,
    loading,
    onClick,
}: {
    label: string;
    variant: 'blue' | 'green';
    loading: boolean;
    onClick: () => void;
}) {
    return (
        <button
            className={cn(
                badgeVariants({ variant }),
                'cursor-pointer hover:opacity-80 transition-opacity gap-1',
                loading && 'opacity-60 cursor-wait pointer-events-none',
            )}
            onMouseDown={e => e.preventDefault()}
            onClick={onClick}
            disabled={loading}
        >
            {loading && <Loader2 size={10} className="animate-spin" />}
            {label}
        </button>
    );
}

// ─── Section components ───────────────────────────────────────────────────────

function FileInfoSection({ params }: { params: ImageParams }) {
    const fi = params.fileinfo;
    const rows: [string, string | null | undefined][] = [
        ['Filename', fi?.filename],
        ['Resolution', fi?.resolution],
        ['Size', fi?.size],
        ['Date', fi?.date],
    ];
    const visible = rows.filter(([, v]) => v);
    if (visible.length === 0) return null;

    return (
        <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                {visible.map(([label, value]) => (
                    <div key={label} className="flex flex-col gap-0.5">
                        <span className="text-xs text-muted-foreground">{label}</span>
                        <span className="text-xs font-medium break-all">{value}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function ResourcesSubSection({ params }: { params: ImageParams }) {
    const chips: React.ReactNode[] = [];

    if (params.model) {
        chips.push(
            <Tooltip key="model">
                <TooltipTrigger asChild>
                    <span><ResourceChip label={params.model} /></span>
                </TooltipTrigger>
                {params.model_hash && <TooltipContent>Hash: {params.model_hash}</TooltipContent>}
            </Tooltip>
        );
    }

    for (const lora of params.loras ?? []) {
        const strength = lora.model_strength != null ? String(lora.model_strength) : undefined;
        chips.push(<ResourceChip key={`lora-${lora.name}`} label={lora.name} sub={strength} />);
    }

    if (params.vae) chips.push(<ResourceChip key="vae" label={params.vae} />);
    if (params.hires_upscaler) chips.push(<ResourceChip key="upscaler" label={params.hires_upscaler} />);

    if (chips.length === 0) return null;
    return (
        <div className="flex flex-col gap-2 mb-3">
            <SubSectionLabel>Resources</SubSectionLabel>
            <div className="flex flex-wrap gap-1.5">{chips}</div>
        </div>
    );
}

function PromptSubSection({ params }: { params: ImageParams }) {
    if (!params.positive_prompt && !params.negative_prompt) return null;
    return (
        <div className="flex flex-col gap-3 mb-1">
            {params.positive_prompt && (
                <PromptBlock label="Prompt" text={params.positive_prompt} />
            )}
            {params.negative_prompt && (
                <PromptBlock label="Negative prompt" text={params.negative_prompt} muted />
            )}
        </div>
    );
}

function GenerationSubSection({ params }: { params: ImageParams }) {
    const chips: React.ReactNode[] = [];

    if (params.cfg_scale != null) chips.push(<ParamChip key="cfg" label="cfgScale" value={String(params.cfg_scale)} />);
    if (params.steps != null) chips.push(<ParamChip key="steps" label="steps" value={String(params.steps)} />);
    if (params.sampler) {
        const sampler = params.scheduler && params.scheduler.toLowerCase() !== 'normal'
            ? `${params.sampler} ${params.scheduler}`
            : params.sampler;
        chips.push(<ParamChip key="sampler" label="sampler" value={sampler} />);
    }
    if (params.seed != null) chips.push(<ParamChip key="seed" label="seed" value={String(params.seed)} />);
    if (params.denoise_strength != null) chips.push(<ParamChip key="denoise" label="denoise" value={String(params.denoise_strength)} />);
    if (params.clip_skip != null) chips.push(<ParamChip key="clip" label="clipSkip" value={String(params.clip_skip)} />);

    const upscaleFactor = params.extras?.['Upscale Factor'] ?? params.extras?.['Hires upscale'];
    const hasHires = params.hires_steps != null || params.hires_denoise != null || upscaleFactor != null;

    if (chips.length === 0 && !hasHires) return null;
    return (
        <div className="flex flex-col gap-2 mt-3">
            {chips.length > 0 && <div className="flex flex-wrap gap-1.5">{chips}</div>}
            {hasHires && (
                <div className="flex flex-wrap items-center gap-1.5">
                    {upscaleFactor && <ParamChip label="Upscale factor" value={upscaleFactor} />}
                    {params.hires_steps != null && <ParamChip label="Hires steps" value={String(params.hires_steps)} />}
                    {params.hires_denoise != null && <ParamChip label="Hires denoising" value={String(params.hires_denoise)} />}
                </div>
            )}
        </div>
    );
}

/** Keys shown in the Hires row — excluded from Extras to avoid duplication. */
const HIRES_EXTRAS_KEYS = new Set(['Upscale Factor', 'Hires upscale']);

function ExtrasSubSection({ extras }: { extras: Record<string, string> | null | undefined }) {
    const visible = Object.entries(extras ?? {}).filter(([k]) => !HIRES_EXTRAS_KEYS.has(k));
    if (visible.length === 0) return null;
    return (
        <div className="flex flex-col gap-2 mt-3">
            <SubSectionLabel>Extras</SubSectionLabel>
            <div className="flex flex-wrap gap-1.5">
                {visible.map(([k, v]) => <ParamChip key={k} label={k} value={v} />)}
            </div>
        </div>
    );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function MetadataPanel({ image }: { image: FileDetails }) {
    const [parsedParams, setParsedParams] = useState<ImageParams | null>(null);
    const [parsedLoading, setParsedLoading] = useState(false);
    const [rawMetadata, setRawMetadata] = useState<Record<string, unknown> | null>(null);
    const [rawLoading, setRawLoading] = useState(false);
    const rawFetchedForRef = useRef<string | null>(null);
    const [copying, setCopying] = useState<'a1111' | 'comfyui' | null>(null);

    const { showRawMetadata, setShowRawMetadata, settings } = useGalleryContext();

    const relPath = image.url.startsWith('/static_gallery/')
        ? image.url.slice('/static_gallery/'.length)
        : image.url;

    // Fetch parsed params on image change
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
    }, [relPath, image.type]);

    // Fetch raw metadata lazily when Raw JSON tab is active
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
    }, [showRawMetadata, relPath, image.type]);

    const handleCopyA1111 = useCallback(async () => {
        if (copying) return;
        setCopying('a1111');
        try {
            const resp = await fetch(`${BASE_PATH}/Gallery/metadata/${relPath}?format=civitai`);
            if (!resp.ok) throw new Error('Fetch failed');
            const text = await resp.text();
            await navigator.clipboard.writeText(text);
            toast.success('Copied A1111 metadata!', { duration: 1500 });
        } catch {
            toast.error('Copy failed');
        } finally {
            setCopying(null);
        }
    }, [relPath, copying]);

    const handleCopyComfyUI = useCallback(async () => {
        if (copying) return;
        setCopying('comfyui');
        try {
            let workflow = (rawMetadata as { workflow?: unknown } | null)?.workflow;
            if (!workflow) {
                const resp = await fetch(`${BASE_PATH}/Gallery/metadata/${relPath}?format=raw`);
                if (!resp.ok) throw new Error('Fetch failed');
                const data = await resp.json() as { metadata?: { workflow?: unknown } };
                workflow = data.metadata?.workflow;
                // Cache it for the Raw JSON tab
                if (data.metadata) {
                    setRawMetadata(data.metadata as Record<string, unknown>);
                    rawFetchedForRef.current = relPath;
                }
            }
            if (!workflow) throw new Error('No workflow in metadata');
            await navigator.clipboard.writeText(JSON.stringify(workflow, null, 2));
            toast.success('Copied ComfyUI workflow!', { duration: 1500 });
        } catch {
            toast.error('Copy failed');
        } finally {
            setCopying(null);
        }
    }, [relPath, copying, rawMetadata]);

    const formats = parsedParams?.formats ?? [];
    const hasA1111 = formats.includes('a1111');
    const hasComfyUI = formats.includes('comfyui');
    const nodeCount = parsedParams?.workflow_node_count;

    const hasGenerationData = Boolean(
        parsedParams?.model || (parsedParams?.loras?.length ?? 0) > 0 ||
        parsedParams?.vae || parsedParams?.hires_upscaler ||
        parsedParams?.positive_prompt || parsedParams?.negative_prompt ||
        parsedParams?.steps != null || parsedParams?.cfg_scale != null ||
        parsedParams?.sampler || parsedParams?.seed != null ||
        parsedParams?.scheduler || parsedParams?.denoise_strength != null ||
        parsedParams?.clip_skip != null ||
        Object.keys(parsedParams?.extras ?? {}).length > 0
    );

    return (
        <div
            className="bg-card text-foreground"
            style={{ height: '100%', padding: '16px', display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}
        >
            {/* Metadata / Raw JSON toggle */}
            <div className="flex rounded-md overflow-hidden text-xs shrink-0 border border-border">
                {(['metadata', 'raw'] as const).map(v => {
                    const active = (showRawMetadata ? 'raw' : 'metadata') === v;
                    return (
                        <button
                            key={v}
                            className={cn(
                                'flex-1 py-1 px-2 transition-colors',
                                active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                            )}
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => setShowRawMetadata(v === 'raw')}
                        >
                            {v === 'metadata' ? 'Metadata' : 'Raw JSON'}
                        </button>
                    );
                })}
            </div>

            {/* Scrollable content */}
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
                {image.type !== 'image' ? null : showRawMetadata ? (
                    rawLoading
                        ? <RawJsonSkeleton dark={settings.darkMode} />
                        : (
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
                ) : parsedLoading ? (
                    <MetadataSkeleton />
                ) : (
                    <div className="flex flex-col gap-3">
                        {/* ── FILE INFO card ── */}
                        {parsedParams && (
                            <div className="rounded-lg border border-border p-3">
                                <FileInfoSection params={parsedParams} />
                            </div>
                        )}

                        {/* ── GENERATION DATA card ── */}
                        {parsedParams && hasGenerationData && (
                            <div className="rounded-lg border border-border p-3 flex flex-col gap-0">
                                {/* Section header with format badges inline */}
                                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
                                    <span className="font-semibold text-sm">Generation data</span>
                                    <div className="flex gap-1.5 flex-wrap">
                                        {hasA1111 && (
                                            <FormatBadge
                                                label="A1111"
                                                variant="blue"
                                                loading={copying === 'a1111'}
                                                onClick={handleCopyA1111}
                                            />
                                        )}
                                        {hasComfyUI && (
                                            <FormatBadge
                                                label={nodeCount != null ? `ComfyUI (${nodeCount} nodes)` : 'ComfyUI'}
                                                variant="green"
                                                loading={copying === 'comfyui'}
                                                onClick={handleCopyComfyUI}
                                            />
                                        )}
                                    </div>
                                </div>

                                <ResourcesSubSection params={parsedParams} />
                                <PromptSubSection params={parsedParams} />

                                <GenerationSubSection params={parsedParams} />
                                <ExtrasSubSection extras={parsedParams.extras} />
                            </div>
                        )}

                        {!parsedParams && !parsedLoading && (
                            <p className="text-sm text-muted-foreground">No metadata available.</p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

