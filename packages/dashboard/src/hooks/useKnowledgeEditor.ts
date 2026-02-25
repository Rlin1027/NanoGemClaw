import { useState } from 'react';
import { useKnowledgeDocs, useCreateKnowledgeDoc, useUpdateKnowledgeDoc, useDeleteKnowledgeDoc, type KnowledgeDoc } from './useKnowledge';
import { showToast } from './useToast';

export function useKnowledgeEditor(groupFolder: string) {
    const [selectedDoc, setSelectedDoc] = useState<KnowledgeDoc | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [editContent, setEditContent] = useState('');
    const [editTitle, setEditTitle] = useState('');
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    const { data: docs, isLoading, refetch } = useKnowledgeDocs(groupFolder);
    const createMutation = useCreateKnowledgeDoc(groupFolder);
    const updateMutation = useUpdateKnowledgeDoc(groupFolder, selectedDoc?.id || 0);
    const deleteMutation = useDeleteKnowledgeDoc(groupFolder, selectedDoc?.id || 0);

    const handleSelectDoc = (doc: KnowledgeDoc | null) => {
        setSelectedDoc(doc);
        setEditTitle(doc?.title ?? '');
        setEditContent(doc?.content ?? '');
        setIsEditing(false);
    };

    const handleSave = async () => {
        if (!selectedDoc) return;
        try {
            const result = await updateMutation.mutate({ title: editTitle, content: editContent });
            if (result) {
                await refetch();
                setSelectedDoc(result);
                setIsEditing(false);
                showToast('Document updated successfully', 'success');
            }
        } catch (err) {
            showToast(err instanceof Error ? err.message : 'Failed to update document');
        }
    };

    const handleDelete = async () => {
        if (!selectedDoc) return;
        try {
            const result = await deleteMutation.mutate(undefined);
            if (result) {
                await refetch();
                setSelectedDoc(null);
                setShowDeleteConfirm(false);
                showToast('Document deleted successfully', 'success');
            }
        } catch (err) {
            showToast(err instanceof Error ? err.message : 'Failed to delete document');
        }
    };

    const handleCreate = async (filename: string, title: string, content: string) => {
        try {
            const result = await createMutation.mutate({ filename, title, content });
            if (result) {
                await refetch();
                setShowCreateModal(false);
                handleSelectDoc(result);
                showToast('Document created successfully', 'success');
            }
        } catch (err) {
            showToast(err instanceof Error ? err.message : 'Failed to create document');
        }
    };

    const handleCancelEdit = () => {
        if (selectedDoc) {
            setIsEditing(false);
            setEditTitle(selectedDoc.title);
            setEditContent(selectedDoc.content);
        }
    };

    return {
        // Document data
        docs,
        isLoading,
        selectedDoc,

        // Edit state
        isEditing,
        editContent,
        editTitle,
        setIsEditing,
        setEditContent,
        setEditTitle,

        // Modal state
        showCreateModal,
        showDeleteConfirm,
        setShowCreateModal,
        setShowDeleteConfirm,

        // Mutations
        createMutation,
        updateMutation,
        deleteMutation,

        // Actions
        handleSelectDoc,
        handleSave,
        handleDelete,
        handleCreate,
        handleCancelEdit,
    };
}
