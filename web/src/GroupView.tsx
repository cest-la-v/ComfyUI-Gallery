import React from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useGalleryGroups } from './hooks/useGalleryGroups';
import { BASE_PATH } from './ComfyAppApi';
import type { ModelGroup, PromptGroup } from './types';

const THUMB_SIZE = 64;

const FALLBACK_SRC = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function ThumbnailStrip({ samplePaths }: { samplePaths: string[] }) {
    return (
        <div className="flex gap-1 mt-2">
            {samplePaths.slice(0, 4).map((rel, i) => (
                <img
                    key={i}
                    src={`${BASE_PATH}/static_gallery/${rel}`}
                    width={THUMB_SIZE}
                    height={THUMB_SIZE}
                    className="object-cover rounded shrink-0"
                    style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
                    onError={e => { (e.target as HTMLImageElement).src = FALLBACK_SRC; }}
                />
            ))}
        </div>
    );
}

function ModelGroupCard({ group, onClick }: { group: ModelGroup; onClick: () => void }) {
    return (
        <div
            className="w-[220px] cursor-pointer rounded-lg border bg-card text-card-foreground shadow-sm p-3 transition-colors hover:bg-accent/50"
            onClick={onClick}
        >
            <div className="flex justify-between items-start gap-2">
                <span className="font-semibold text-[13px] flex-1 break-words">{group.model}</span>
                <Badge variant="blue" className="shrink-0">{group.count}</Badge>
            </div>
            <ThumbnailStrip samplePaths={group.sample_paths} />
        </div>
    );
}

function PromptGroupCard({ group, onClick }: { group: PromptGroup; onClick: () => void }) {
    const preview = group.positive_prompt
        ? group.positive_prompt.slice(0, 100) + (group.positive_prompt.length > 100 ? '…' : '')
        : '(no prompt)';

    return (
        <div
            className="w-[280px] cursor-pointer rounded-lg border bg-card text-card-foreground shadow-sm p-3 transition-colors hover:bg-accent/50"
            onClick={onClick}
        >
            <div className="flex justify-between items-start gap-2 mb-1.5">
                <div className="flex flex-wrap gap-1 flex-1">
                    {group.models.length > 0
                        ? group.models.map(m => (
                            <Badge key={m} variant="blue" className="text-[11px]">{m}</Badge>
                        ))
                        : <Badge variant="outline" className="text-[11px] opacity-40">Unknown model</Badge>
                    }
                </div>
                <Badge variant="green" className="shrink-0">{group.count}</Badge>
            </div>
            <p className="line-clamp-2 text-xs text-muted-foreground m-0 leading-[1.4]">{preview}</p>
            <ThumbnailStrip samplePaths={group.sample_paths} />
        </div>
    );
}

interface GroupViewProps {
    /** Called when user clicks a model group card — fetches filtered rel_paths and drills down. */
    onSelectModel: (model: string) => Promise<void>;
    /** Called when user clicks a prompt group card. */
    onSelectPrompt: (fingerprint: string, label: string) => Promise<void>;
    /** Which tab to show by default: 'model' or 'prompt'. */
    activeTab?: 'model' | 'prompt';
}

const GroupView: React.FC<GroupViewProps> = ({ onSelectModel, onSelectPrompt, activeTab = 'model' }) => {
    const { modelGroups, promptGroups, loading, error, refresh } = useGalleryGroups(true);

    const header = (
        <div className="flex justify-end mb-3">
            <button
                className="text-muted-foreground hover:text-foreground transition-colors"
                onClick={refresh}
                title="Refresh groups"
            >
                <RefreshCw className="h-4 w-4" />
            </button>
        </div>
    );

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full min-h-[200px]">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-4">
                {header}
                <div className="rounded-md border border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/30 p-4 flex gap-3">
                    <span className="text-yellow-600 dark:text-yellow-400 text-sm font-medium">Could not load groups</span>
                    <span className="text-sm text-muted-foreground">{error}</span>
                </div>
            </div>
        );
    }

    return (
        <div className="p-4 h-full overflow-y-auto">
            {header}
            {activeTab === 'model' ? (
                modelGroups.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-center text-sm text-muted-foreground">
                        No model metadata found. Run a scan to populate the database.
                    </div>
                ) : (
                    <div className="flex flex-wrap gap-3 pt-2">
                        {modelGroups.map(group => (
                            <ModelGroupCard
                                key={group.model}
                                group={group}
                                onClick={() => onSelectModel(group.model)}
                            />
                        ))}
                    </div>
                )
            ) : (
                promptGroups.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-center text-sm text-muted-foreground">
                        No prompt metadata found. Run a scan to populate the database.
                    </div>
                ) : (
                    <div className="flex flex-wrap gap-3 pt-2">
                        {promptGroups.map(group => (
                            <PromptGroupCard
                                key={group.fingerprint}
                                group={group}
                                onClick={() => onSelectPrompt(group.fingerprint, group.positive_prompt?.slice(0, 40) ?? group.fingerprint.slice(0, 8))}
                            />
                        ))}
                    </div>
                )
            )}
        </div>
    );
};

export default GroupView;
