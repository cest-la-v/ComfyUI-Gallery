import React from 'react';
import { Card, Badge, Image, Spin, Empty, Alert, Typography, Flex, Tag } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useGalleryGroups } from './hooks/useGalleryGroups';
import { BASE_PATH } from './ComfyAppApi';
import type { ModelGroup, PromptGroup } from './types';

const { Text, Paragraph } = Typography;

const THUMB_SIZE = 64;

function ThumbnailStrip({ samplePaths }: { samplePaths: string[] }) {
    return (
        <Flex gap={4} style={{ marginTop: 8 }}>
            {samplePaths.slice(0, 4).map((rel, i) => (
                <Image
                    key={i}
                    src={`${BASE_PATH}/static_gallery/${rel}`}
                    width={THUMB_SIZE}
                    height={THUMB_SIZE}
                    style={{ objectFit: 'cover', borderRadius: 4, flexShrink: 0 }}
                    preview={false}
                    fallback="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
                />
            ))}
        </Flex>
    );
}

function ModelGroupCard({ group, onClick }: { group: ModelGroup; onClick: () => void }) {
    return (
        <Card
            hoverable
            onClick={onClick}
            size="small"
            style={{ width: 220, cursor: 'pointer' }}
            styles={{ body: { padding: 12 } }}
        >
            <Flex justify="space-between" align="flex-start">
                <Text strong style={{ fontSize: 13, flex: 1, marginRight: 8, wordBreak: 'break-word' }}>
                    {group.model}
                </Text>
                <Badge count={group.count} color="blue" showZero style={{ flexShrink: 0 }} />
            </Flex>
            <ThumbnailStrip samplePaths={group.sample_paths} />
        </Card>
    );
}

function PromptGroupCard({ group, onClick }: { group: PromptGroup; onClick: () => void }) {
    const preview = group.positive_prompt
        ? group.positive_prompt.slice(0, 100) + (group.positive_prompt.length > 100 ? '…' : '')
        : '(no prompt)';

    return (
        <Card
            hoverable
            onClick={onClick}
            size="small"
            style={{ width: 260, cursor: 'pointer' }}
            styles={{ body: { padding: 12 } }}
        >
            <Flex justify="space-between" align="flex-start" style={{ marginBottom: 4 }}>
                {group.model && <Tag color="blue" style={{ fontSize: 11, marginRight: 0 }}>{group.model}</Tag>}
                <Badge count={group.count} color="green" showZero style={{ marginLeft: 'auto', flexShrink: 0 }} />
            </Flex>
            <Paragraph
                style={{ fontSize: 12, color: '#666', margin: 0, lineHeight: '1.4' }}
                ellipsis={{ rows: 2 }}
            >
                {preview}
            </Paragraph>
            <ThumbnailStrip samplePaths={group.sample_paths} />
        </Card>
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
        <Flex justify="flex-end" style={{ marginBottom: 12 }}>
            <ReloadOutlined
                onClick={refresh}
                style={{ cursor: 'pointer', color: '#666' }}
                title="Refresh groups"
            />
        </Flex>
    );

    if (loading) {
        return (
            <Flex justify="center" align="center" style={{ height: '100%', minHeight: 200 }}>
                <Spin size="large" />
            </Flex>
        );
    }

    if (error) {
        return (
            <div style={{ padding: 16 }}>
                {header}
                <Alert
                    type="warning"
                    message="Could not load groups"
                    description={error}
                    showIcon
                />
            </div>
        );
    }

    return (
        <div style={{ padding: 16, height: '100%', overflowY: 'auto' }}>
            {header}
            {activeTab === 'model' ? (
                modelGroups.length === 0 ? (
                    <Empty description="No model metadata found. Run a scan to populate the database." style={{ marginTop: 40 }} />
                ) : (
                    <Flex wrap gap={12} style={{ paddingTop: 8 }}>
                        {modelGroups.map(group => (
                            <ModelGroupCard
                                key={group.model}
                                group={group}
                                onClick={() => onSelectModel(group.model)}
                            />
                        ))}
                    </Flex>
                )
            ) : (
                promptGroups.length === 0 ? (
                    <Empty description="No prompt metadata found. Run a scan to populate the database." style={{ marginTop: 40 }} />
                ) : (
                    <Flex wrap gap={12} style={{ paddingTop: 8 }}>
                        {promptGroups.map(group => (
                            <PromptGroupCard
                                key={group.fingerprint}
                                group={group}
                                onClick={() => onSelectPrompt(group.fingerprint, group.positive_prompt?.slice(0, 40) ?? group.fingerprint.slice(0, 8))}
                            />
                        ))}
                    </Flex>
                )
            )}
        </div>
    );
};

export default GroupView;
