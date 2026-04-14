import { Hono } from 'hono';
import { fetchDocument, ingestDocumentFromFile, ingestDocumentFromText } from '../services/documentService.js';

const app = new Hono();

function normalizeBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v !== 'string') return false;
  return ['1', 'true', 'yes', 'y', 'on'].includes(v.toLowerCase());
}

// POST /documents — upload a document (multipart) or ingest plain text (json or multipart)
app.post('/', async (c) => {
  const contentType = (c.req.header('content-type') || '').toLowerCase();

  // JSON text ingestion
  if (contentType.includes('application/json')) {
    const body = await c.req.json();
    const ownerId = body?.ownerId ?? body?.owner_id ?? null;
    const title = body?.title ?? 'Untitled document';
    const text = body?.text ?? '';
    const generateEmbeddings = body?.generate_embeddings ?? body?.generateEmbeddings ?? false;

    const res = await ingestDocumentFromText({
      text,
      ownerId,
      title,
      generateEmbeddings: normalizeBool(generateEmbeddings),
    });
    return c.json(res, 201);
  }

  // Multipart file or text ingestion
  const form = await c.req.formData();
  const file = form.get('file') ?? form.get('files');
  const text = form.get('text');

  const ownerId = form.get('ownerId') ?? form.get('owner_id');
  const title = form.get('title');
  const generateEmbeddings = form.get('generate_embeddings') ?? form.get('generateEmbeddings');

  const normalizedOwnerId = typeof ownerId === 'string' && ownerId.trim() ? ownerId.trim() : null;
  const normalizedTitle = typeof title === 'string' ? title : '';
  const normalizedGenerateEmbeddings = normalizeBool(generateEmbeddings);

  if (file instanceof File) {
    const res = await ingestDocumentFromFile({
      file,
      ownerId: normalizedOwnerId,
      title: normalizedTitle,
      generateEmbeddings: normalizedGenerateEmbeddings,
    });
    return c.json(res, 201);
  }

  if (typeof text === 'string' && text.trim()) {
    const res = await ingestDocumentFromText({
      text,
      ownerId: normalizedOwnerId,
      title: normalizedTitle || 'Untitled document',
      generateEmbeddings: normalizedGenerateEmbeddings,
    });
    return c.json(res, 201);
  }

  return c.json(
    {
      error:
        'Either file (multipart/form-data field "file" or "files") or text (field "text") is required.',
    },
    400
  );
});

// GET /documents/:id — fetch document + chunks
app.get('/:id', async (c) => {
  const id = c.req.param('id');
  const doc = await fetchDocument(id);
  if (!doc) return c.json({ error: 'Document not found' }, 404);
  return c.json(doc);
});

export default app;
