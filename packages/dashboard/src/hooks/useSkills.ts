import { useApiQuery, useApiMutation } from './useApi';

export interface SkillInfo {
    id: string;
    name: string;
    description: string;
    path: string;
    type: 'file' | 'directory';
}

export function useAvailableSkills() {
    return useApiQuery<SkillInfo[]>('/api/skills');
}

export function useGroupSkills(groupFolder?: string) {
    return useApiQuery<string[]>(
        groupFolder ? `/api/groups/${groupFolder}/skills` : '/api/skills/__noop'
    );
}

export function useToggleSkill(groupFolder?: string) {
    return useApiMutation<{ success: boolean }, { skillId: string; enabled: boolean }>(
        groupFolder ? `/api/groups/${groupFolder}/skills` : '',
        'POST'
    );
}
