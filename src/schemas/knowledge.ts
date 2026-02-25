import { z } from 'zod';
import {
  folderParam,
  numericStringParam,
  paginationQuery,
  knowledgeFilename,
} from './shared.js';

/** Params for routes with :folder only */
export const folderOnlyParams = z.object({
  folder: folderParam,
});

/** Params for routes with :folder and :docId */
export const folderDocIdParams = z.object({
  folder: folderParam,
  docId: numericStringParam,
});

/** GET /api/groups/:folder/knowledge query */
export const knowledgePaginationQuery = paginationQuery;

/** GET /api/groups/:folder/knowledge/search query */
export const knowledgeSearchQuery = z.object({
  q: z.string().min(1, 'Missing or invalid query parameter: q'),
});

/** POST /api/groups/:folder/knowledge body */
export const knowledgeCreateBody = z.object({
  filename: knowledgeFilename,
  title: z.string().min(1, 'Title is required'),
  content: z.string(),
});

/** PUT /api/groups/:folder/knowledge/:docId body */
export const knowledgeUpdateBody = z.object({
  title: z.string().min(1, 'Title is required'),
  content: z.string(),
});
