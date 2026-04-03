import { useState, useEffect } from 'react';
import { BASE_PATH } from '../ComfyAppApi';
import type { ModelGroup, PromptGroup } from '../types';

export interface GalleryGroupsData {
    modelGroups: ModelGroup[];
    promptGroups: PromptGroup[];
    loading: boolean;
    error: string | null;
    refresh: () => void;
}

export function useGalleryGroups(enabled: boolean): GalleryGroupsData {
    const [modelGroups, setModelGroups] = useState<ModelGroup[]>([]);
    const [promptGroups, setPromptGroups] = useState<PromptGroup[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [tick, setTick] = useState(0);

    useEffect(() => {
        if (!enabled) return;

        let cancelled = false;
        setLoading(true);
        setError(null);

        Promise.all([
            fetch(`${BASE_PATH}/Gallery/groups?by=model`).then(r => {
                if (!r.ok) throw new Error(`groups?by=model: ${r.status}`);
                return r.json();
            }),
            fetch(`${BASE_PATH}/Gallery/groups?by=prompt`).then(r => {
                if (!r.ok) throw new Error(`groups?by=prompt: ${r.status}`);
                return r.json();
            }),
        ])
            .then(([modelData, promptData]) => {
                if (cancelled) return;
                setModelGroups(modelData.groups ?? []);
                setPromptGroups(promptData.groups ?? []);
            })
            .catch(e => {
                if (!cancelled) setError(String(e));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => { cancelled = true; };
    }, [enabled, tick]);

    return {
        modelGroups,
        promptGroups,
        loading,
        error,
        refresh: () => setTick(t => t + 1),
    };
}
