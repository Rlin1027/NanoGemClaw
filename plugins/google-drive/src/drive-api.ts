/**
 * Google Drive API wrapper.
 *
 * All public functions retrieve a fresh OAuth2Client via getOAuth2Client()
 * before making any Drive API call, and throw if the user is not authenticated.
 */

import { google } from 'googleapis';
import { getOAuth2Client } from 'nanogemclaw-plugin-google-auth';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null;
  size: string | null;
  webViewLink: string | null;
}

export interface DriveSearchResult {
  files: DriveFile[];
  totalResults: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FILE_FIELDS = 'files(id,name,mimeType,modifiedTime,size,webViewLink)';

/** Allowed Drive API orderBy values to prevent injection via user-controlled input. */
const ALLOWED_ORDER_BY = new Set([
  'name',
  'name desc',
  'modifiedTime',
  'modifiedTime desc',
  'createdTime',
  'createdTime desc',
  'folder',
  'folder desc',
]);

function getDriveClient() {
  const auth = getOAuth2Client();
  if (!auth) {
    throw new Error(
      'Google Drive: not authenticated. Authorize via Settings → Google Account.',
    );
  }
  return google.drive({ version: 'v3', auth });
}

function mapFile(f: {
  id?: string | null;
  name?: string | null;
  mimeType?: string | null;
  modifiedTime?: string | null;
  size?: string | null;
  webViewLink?: string | null;
}): DriveFile {
  return {
    id: f.id ?? '',
    name: f.name ?? '(untitled)',
    mimeType: f.mimeType ?? '',
    modifiedTime: f.modifiedTime ?? null,
    size: f.size ?? null,
    webViewLink: f.webViewLink ?? null,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Full-text search across Google Drive.
 */
export async function searchFiles(
  query: string,
  options: { maxResults?: number; folderId?: string } = {},
): Promise<DriveSearchResult> {
  const drive = getDriveClient();
  const { maxResults = 10, folderId } = options;

  // Sanitize query: remove single quotes entirely to prevent query injection.
  // Drive API fullText search is a simple contains match — quotes in the
  // search term are not meaningful and only create injection risk.
  const sanitized = query.replace(/'/g, '');
  let q = `fullText contains '${sanitized}'`;
  if (folderId) {
    // Validate folderId format (alphanumeric + hyphens/underscores)
    if (!/^[\w-]+$/.test(folderId)) {
      throw new Error('Invalid folderId format');
    }
    q += ` and '${folderId}' in parents`;
  }
  q += ' and trashed = false';

  const res = await drive.files.list({
    q,
    pageSize: Math.min(maxResults, 1000),
    fields: FILE_FIELDS,
    orderBy: 'modifiedTime desc',
  });

  const files = (res.data.files ?? []).map(mapFile);
  return { files, totalResults: files.length };
}

/**
 * List recently modified files (all types, not in trash).
 */
export async function listRecentFiles(maxResults = 20): Promise<DriveFile[]> {
  const drive = getDriveClient();

  const res = await drive.files.list({
    pageSize: Math.min(maxResults, 1000),
    fields: FILE_FIELDS,
    orderBy: 'modifiedTime desc',
    q: 'trashed = false',
  });

  return (res.data.files ?? []).map(mapFile);
}

/**
 * Get metadata for a single file.
 */
export async function getFileMetadata(fileId: string): Promise<DriveFile> {
  const drive = getDriveClient();

  const res = await drive.files.get({
    fileId,
    fields: 'id,name,mimeType,modifiedTime,size,webViewLink',
  });

  return mapFile(res.data);
}

/**
 * Get the raw content of a file as a string.
 * - Google Workspace types are exported to a text-friendly format.
 * - PDF and plain text types are downloaded directly.
 */
export async function getFileContent(
  fileId: string,
  mimeType: string,
): Promise<string> {
  const drive = getDriveClient();

  // Google Workspace documents — use export
  const exportMime = getExportMimeType(mimeType);
  if (exportMime) {
    const res = await drive.files.export(
      { fileId, mimeType: exportMime },
      { responseType: 'text' },
    );
    return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
  }

  // Binary / text files — download with alt=media
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'text' },
  );
  return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
}

/**
 * List the contents of a folder.
 */
export async function listFolderContents(
  folderId: string,
  options: { maxResults?: number; orderBy?: string } = {},
): Promise<DriveFile[]> {
  const drive = getDriveClient();
  const { maxResults = 50 } = options;
  const orderBy =
    options.orderBy && ALLOWED_ORDER_BY.has(options.orderBy)
      ? options.orderBy
      : 'name';

  // Validate folderId format to prevent query injection
  if (!/^[\w-]+$/.test(folderId)) {
    throw new Error('Invalid folderId format');
  }
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    pageSize: Math.min(maxResults, 1000),
    fields: FILE_FIELDS,
    orderBy,
  });

  return (res.data.files ?? []).map(mapFile);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Returns the export MIME type for Google Workspace documents, or null for
 * files that should be downloaded directly.
 */
function getExportMimeType(mimeType: string): string | null {
  switch (mimeType) {
    case 'application/vnd.google-apps.document':
      return 'text/plain';
    case 'application/vnd.google-apps.spreadsheet':
      return 'text/csv';
    case 'application/vnd.google-apps.presentation':
      return 'text/plain';
    default:
      return null;
  }
}
