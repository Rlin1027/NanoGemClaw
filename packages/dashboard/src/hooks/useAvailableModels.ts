import { useApiQuery } from './useApi';

export interface DiscoveredModel {
    id: string;
    displayName: string;
    family: string;
    inputTokenLimit?: number;
    outputTokenLimit?: number;
}

interface ModelsResponse {
    models: DiscoveredModel[];
    defaultModel: string;
}

export function useAvailableModels() {
    return useApiQuery<ModelsResponse>('/api/config/models');
}
