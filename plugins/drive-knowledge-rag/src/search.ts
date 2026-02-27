/**
 * Two-layer RAG search:
 *   Layer 1 — cosine-similarity over the local embedding index
 *   Layer 2 — live Drive full-text search (fallback when Layer 1 scores too low)
 */

import { GoogleGenAI } from '@google/genai';
import { searchFiles, extractContent } from 'nanogemclaw-plugin-google-drive';
import type { DriveFile } from 'nanogemclaw-plugin-google-drive';
import type { KnowledgeIndex } from './indexer.js';

export interface SearchResult {
    fileId: string;
    fileName: string;
    snippet: string;
    score: number;
    source: 'index' | 'live';
}

export interface SearchOptions {
    maxResults?: number;
    similarityThreshold?: number;
}

// ---------------------------------------------------------------------------
// Vector math
// ---------------------------------------------------------------------------

export function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// Embedding helper
// ---------------------------------------------------------------------------

async function embedText(text: string): Promise<number[]> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY is not set — cannot generate embeddings');
    }
    const genai = new GoogleGenAI({ apiKey });
    const response = await genai.models.embedContent({
        model: 'text-embedding-004',
        contents: [{ parts: [{ text }] }],
    });
    const values = response.embeddings?.[0]?.values;
    if (!values || values.length === 0) {
        throw new Error('Embedding response contained no values');
    }
    return values;
}

// ---------------------------------------------------------------------------
// Layer 1 — local index search
// ---------------------------------------------------------------------------

function searchIndex(
    queryEmbedding: number[],
    index: KnowledgeIndex,
    maxResults: number,
): SearchResult[] {
    const scored: Array<{ fileId: string; fileName: string; snippet: string; score: number }> = [];

    for (const doc of Object.values(index.documents)) {
        let bestScore = -1;
        let bestSnippet = '';

        for (const chunk of doc.chunks) {
            const sim = cosineSimilarity(queryEmbedding, chunk.embedding);
            if (sim > bestScore) {
                bestScore = sim;
                bestSnippet = chunk.text.slice(0, 400);
            }
        }

        if (bestScore >= 0) {
            scored.push({
                fileId: doc.fileId,
                fileName: doc.name,
                snippet: bestSnippet,
                score: bestScore,
            });
        }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxResults).map((r) => ({ ...r, source: 'index' as const }));
}

// ---------------------------------------------------------------------------
// Layer 2 — live Drive search
// ---------------------------------------------------------------------------

async function searchLive(query: string, maxResults: number): Promise<SearchResult[]> {
    let files: DriveFile[];
    try {
        files = await searchFiles(query, { maxResults: maxResults * 2 });
    } catch (err) {
        // Drive search unavailable — return empty rather than crashing
        void err;
        return [];
    }

    if (!files || files.length === 0) return [];

    const results: SearchResult[] = [];

    for (const file of files.slice(0, maxResults)) {
        try {
            const extracted = await extractContent(file.id, file.mimeType);
            const snippet = extracted.content.slice(0, 400);
            results.push({
                fileId: file.id,
                fileName: file.name,
                snippet,
                score: 1.0, // live results have no similarity score
                source: 'live',
            });
        } catch {
            // Skip files whose content cannot be extracted
            results.push({
                fileId: file.id,
                fileName: file.name,
                snippet: '(content not extractable)',
                score: 0.5,
                source: 'live',
            });
        }
    }

    return results;
}

// ---------------------------------------------------------------------------
// Deduplicate by fileId, keeping the higher-scored entry
// ---------------------------------------------------------------------------

function deduplicate(results: SearchResult[]): SearchResult[] {
    const seen = new Map<string, SearchResult>();
    for (const r of results) {
        const existing = seen.get(r.fileId);
        if (!existing || r.score > existing.score) {
            seen.set(r.fileId, r);
        }
    }
    return Array.from(seen.values());
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function searchKnowledge(
    query: string,
    index: KnowledgeIndex,
    options: SearchOptions = {},
): Promise<SearchResult[]> {
    const maxResults = options.maxResults ?? 5;
    const threshold = options.similarityThreshold ?? 0.7;

    // Generate query embedding
    let queryEmbedding: number[];
    try {
        queryEmbedding = await embedText(query);
    } catch {
        // If embedding fails, fall straight through to live search
        const liveResults = await searchLive(query, maxResults);
        return liveResults.slice(0, maxResults);
    }

    // Layer 1
    const indexResults = searchIndex(queryEmbedding, index, maxResults);
    const topScore = indexResults[0]?.score ?? 0;

    let combined = [...indexResults];

    // Layer 2 — only when Layer 1 confidence is low
    if (topScore < threshold) {
        const liveResults = await searchLive(query, maxResults);
        combined = deduplicate([...indexResults, ...liveResults]);
    }

    combined.sort((a, b) => b.score - a.score);
    return combined.slice(0, maxResults);
}
