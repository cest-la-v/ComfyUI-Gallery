import { toast } from 'sonner';
import { useState, useCallback, useEffect, useRef } from 'react';
import type React from 'react';
import type { FileDetails, ImageParams } from './types';
import { useGalleryContext } from './GalleryContext';
import { BASE_PATH } from './ComfyAppApi';
import ReactJsonView from '@microlink/react-json-view';
import { cn } from '@/lib/utils';
import { badgeVariants, Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Item, ItemContent, ItemTitle, ItemDescription, ItemActions, ItemGroup } from '@/components/ui/item';
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
                        <Skeleton className="h-3" style={{ width: lw }} />
                        <Skeleton className="h-3.5" style={{ width: cw }} />
                    </div>
                ))}
            </div>
            <div className="flex gap-2">
                {[60, 100].map((w, i) => (
                    <Skeleton key={i} className="h-5 rounded-full" style={{ width: w }} />
                ))}
            </div>
            <Separator />
            {rows.slice(4).map(({ lw, cw }, i) => (
                <div key={i} className="flex gap-2 items-center">
                    <Skeleton className="h-3" style={{ width: lw }} />
                    <Skeleton className="h-5 rounded-full" style={{ width: cw }} />
                </div>
            ))}
        </div>
    );
}

function RawJsonSkeleton() {
    const widths = [160, 80, 200, 60, 120, 90, 180, 70, 140, 50, 160, 80];
    return (
        <div className="rounded-lg bg-muted p-3 px-4">
            {widths.map((w, i) => (
                <Skeleton key={i} className="h-3.5 my-1.5 bg-foreground/10" style={{ width: w }} />
            ))}
        </div>
    );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SubSectionLabel({ children }: { children: React.ReactNode }) {
    return <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">{children}</p>;
}

/** Copy icon button — used inside PromptBlock. */
function CopyButton({ text }: { text: string }) {
    return (
        <button
            className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
            onClick={() => {
                navigator.clipboard.writeText(text);
                toast.success('Copied!', { duration: 1000 });
            }}
            title="Copy"
        >
            <Copy size={13} />
        </button>
    );
}

/** Typed row for Resources (model / LoRA / VAE / upscaler). */
const RESOURCE_TYPE_STYLES: Record<string, string> = {
    Checkpoint: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
    LoRA:       'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    VAE:        'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    Upscaler:   'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
};

function ResourceRow({ type, label, sub }: { type: string; label: string; sub?: string }) {
    return (
        <Item size="sm" className="gap-2 px-0 py-0.5 min-w-0 items-start">
            <ItemContent className="min-w-0 gap-0">
                <ItemTitle className="w-full font-normal whitespace-normal break-words">{label}</ItemTitle>
                {sub && <ItemDescription className="text-xs line-clamp-1">{sub}</ItemDescription>}
            </ItemContent>
            <ItemActions className="shrink-0 pt-0.5">
                <Badge className={cn(
                    'rounded-sm px-1.5 py-0.5 text-xs font-medium',
                    RESOURCE_TYPE_STYLES[type] ?? 'bg-muted text-muted-foreground'
                )}>
                    {type}
                </Badge>
            </ItemActions>
        </Item>
    );
}

/** `key: value` chip for Generation / Extras params. */
function ParamChip({ label, value }: { label: string; value: string }) {
    return (
        <Badge variant="outline" className="gap-1 font-normal">
            <span className="text-muted-foreground uppercase tracking-wider">{label}:</span>
            <span className="font-medium text-foreground">{value}</span>
        </Badge>
    );
}

/** Full-width prompt block with label, copy button, and expand/collapse. */
function PromptBlock({ label, text }: { label: string; text: string }) {
    const [expanded, setExpanded] = useState(false);
    const needsClamp = text.length > 200;

    const clampStyle: React.CSSProperties = needsClamp && !expanded
        ? { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: PROMPT_CLAMP, overflow: 'hidden' }
        : {};

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
                <SubSectionLabel>{label}</SubSectionLabel>
                <CopyButton text={text} />
            </div>
            <div className="text-sm break-words whitespace-pre-line"
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
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            {visible.map(([label, value]) => (
                <div key={label} className="flex flex-col gap-0.5">
                    <span className="text-xs text-muted-foreground">{label}</span>
                    <span className="text-xs font-medium break-all">{value}</span>
                </div>
            ))}
        </div>
    );
}

function ResourcesSubSection({ params }: { params: ImageParams }) {
    const rows: React.ReactNode[] = [];

    if (params.model) {
        rows.push(<ResourceRow key="model" type="Checkpoint" label={params.model} sub={params.model_hash ?? undefined} />);
    }
    for (const lora of params.loras ?? []) {
        const strength = lora.model_strength != null ? String(lora.model_strength) : undefined;
        rows.push(<ResourceRow key={`lora-${lora.name}`} type="LoRA" label={lora.name} sub={strength} />);
    }
    if (params.vae) rows.push(<ResourceRow key="vae" type="VAE" label={params.vae} />);
    if (params.hires_upscaler) rows.push(<ResourceRow key="upscaler" type="Upscaler" label={params.hires_upscaler} />);

    if (rows.length === 0) return null;
    return (
        <div className="flex flex-col">
            <SubSectionLabel>Resources</SubSectionLabel>
            <ItemGroup>{rows}</ItemGroup>
        </div>
    );
}

function PromptSubSection({ params }: { params: ImageParams }) {
    if (!params.positive_prompt && !params.negative_prompt) return null;
    return (
        <div className="flex flex-col gap-1.5">
            {params.positive_prompt && (
                <PromptBlock label="Positive" text={params.positive_prompt} />
            )}
            {params.negative_prompt && (
                <PromptBlock label="Negative" text={params.negative_prompt} />
            )}
        </div>
    );
}

function SamplingSubSection({ params }: { params: ImageParams }) {
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

    if (chips.length === 0) return null;
    return (
        <div className="flex flex-col">
            <SubSectionLabel>Sampling</SubSectionLabel>
            <div className="flex flex-wrap gap-1.5">{chips}</div>
        </div>
    );
}

function UpscaleSubSection({ params }: { params: ImageParams }) {
    const upscaleFactor = params.extras?.['Upscale Factor'] ?? params.extras?.['Hires upscale'];
    const hasHires = params.hires_steps != null || params.hires_denoise != null
        || params.hires_upscaler != null || upscaleFactor != null;
    if (!hasHires) return null;
    return (
        <div className="flex flex-col">
            <SubSectionLabel>Hires</SubSectionLabel>
            <div className="flex flex-wrap gap-1.5">
                {upscaleFactor && <ParamChip label="upscale factor" value={upscaleFactor} />}
                {params.hires_upscaler && <ParamChip label="upscaler" value={params.hires_upscaler} />}
                {params.hires_steps != null && <ParamChip label="steps" value={String(params.hires_steps)} />}
                {params.hires_denoise != null && <ParamChip label="denoising" value={String(params.hires_denoise)} />}
            </div>
        </div>
    );
}

/** Exclude all hires-related keys from Extras to avoid duplication with UpscaleSubSection. */
function isHiresExtrasKey(k: string) {
    const lower = k.toLowerCase();
    return lower.startsWith('hires') || lower === 'upscale factor';
}

function ADetailerSubSection({ extras }: { extras: Record<string, string> | null | undefined }) {
    const rows = Object.entries(extras ?? {}).filter(([k]) => k.toLowerCase().startsWith('adetailer'));
    if (rows.length === 0) return null;
    return (
        <div className="flex flex-col">
            <SubSectionLabel>ADetailer</SubSectionLabel>
            <div className="flex flex-wrap gap-1.5">
                {rows.map(([k, v]) => (
                    <ParamChip key={k} label={k.slice('adetailer'.length).trimStart()} value={v} />
                ))}
            </div>
        </div>
    );
}

function ExtrasSubSection({ extras }: { extras: Record<string, string> | null | undefined }) {
    const visible = Object.entries(extras ?? {}).filter(([k]) => {
        const lower = k.toLowerCase();
        return !isHiresExtrasKey(k) && !lower.startsWith('adetailer');
    });
    if (visible.length === 0) return null;
    return (
        <div className="flex flex-col">
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
            className="bg-card text-foreground h-full p-4 flex flex-col gap-3 overflow-hidden"
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
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                {image.type !== 'image' ? null : showRawMetadata ? (
                    <ScrollArea className="flex-1 min-h-0">
                        {rawLoading
                            ? <RawJsonSkeleton />
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
                        }
                    </ScrollArea>
                ) : parsedLoading ? (
                    <ScrollArea className="flex-1 min-h-0">
                        <MetadataSkeleton />
                    </ScrollArea>
                ) : (
                    <div className="flex flex-col gap-3 flex-1 min-h-0">
                        {/* ── FILE INFO card ── */}
                        {parsedParams && (
                            <Card className="shrink-0">
                                <CardContent className="p-3">
                                    <FileInfoSection params={parsedParams} />
                                </CardContent>
                            </Card>
                        )}

                        {/* ── GENERATION DATA card ── */}
                        {parsedParams && hasGenerationData && (
                            <Card className="flex flex-col overflow-hidden flex-1 min-h-0">
                                {/* Pinned header */}
                                <CardHeader className="flex-row items-center gap-2 space-y-0 px-3 pt-3 pb-2 shrink-0">
                                    <span className="text-sm font-semibold">Generation Data</span>
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
                                </CardHeader>

                                <Separator className="shrink-0" />

                                {/* Scrollable body */}
                                <ScrollArea className="flex-1 min-h-0">
                                    <div className="flex flex-col gap-1.5 px-3 pt-1.5 pb-3">
                                        <ResourcesSubSection params={parsedParams} />
                                        <PromptSubSection params={parsedParams} />
                                        <SamplingSubSection params={parsedParams} />
                                        <UpscaleSubSection params={parsedParams} />
                                        <ADetailerSubSection extras={parsedParams.extras} />
                                        <ExtrasSubSection extras={parsedParams.extras} />
                                    </div>
                                </ScrollArea>
                            </Card>
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

