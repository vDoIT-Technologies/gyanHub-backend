import { Prisma } from '@prisma/client';
import { OpenAI } from 'openai';
import pdf from 'pdf-parse';
import { ENV } from '../configs/constant.js';
import prisma from '../lib/prisma.js';

const openai = new OpenAI({ apiKey: ENV.OPENAI_API_KEY });

function normalizeBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v !== 'string') return false;
  return ['1', 'true', 'yes', 'y', 'on'].includes(v.toLowerCase());
}

function inferSourceType({ mimeType, filename }) {
  const mt = String(mimeType || '').toLowerCase();
  const name = String(filename || '').toLowerCase();

  if (mt === 'text/plain' || name.endsWith('.txt')) return 'TEXT';
  if (mt === 'application/pdf' || name.endsWith('.pdf')) return 'PDF';
  if (
    mt === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    name.endsWith('.docx')
  )
    return 'DOCX';
  if (mt.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp'].some((x) => name.endsWith(x)))
    return 'IMAGE';

  // Fallback: treat as TEXT (caller may reject based on allowed types)
  return 'TEXT';
}

function chunkText(text, { chunkSize = 2000, chunkOverlap = 200 } = {}) {
  const s = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!s) return [];

  const chunks = [];
  let start = 0;
  while (start < s.length) {
    const end = Math.min(start + chunkSize, s.length);
    const chunk = s.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    start += Math.max(1, chunkSize - chunkOverlap);
  }
  return chunks;
}

async function extractTextFromFile(file, sourceType) {
  const filename = file?.name || 'document';
  const mimeType = file?.type || '';

  const arrayBuffer = await file.arrayBuffer();
  const buf = Buffer.from(arrayBuffer);

  if (sourceType === 'PDF') {
    const res = await pdf(buf);
    return {
      ok: true,
      text: String(res.text || ''),
      meta: { numpages: res.numpages, info: res.info ?? null },
    };
  }

  if (sourceType === 'DOCX') {
    try {
      const mammoth = await import('mammoth');
      const { value } = await mammoth.extractRawText({ buffer: buf });
      return { ok: true, text: String(value || ''), meta: {} };
    } catch (err) {
      return {
        ok: false,
        error:
          'DOCX parsing requires the optional dependency "mammoth". Install it or upload PDF/TXT instead.',
      };
    }
  }

  if (sourceType === 'TEXT') {
    return { ok: true, text: buf.toString('utf-8'), meta: {} };
  }

  return {
    ok: false,
    error: `Unsupported document type for text extraction (filename=${filename}, mimeType=${mimeType}).`,
  };
}

async function embedTexts(texts) {
  if (!ENV.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is missing');

  const resp = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts,
  });

  // Each item: { embedding: number[] }
  return resp.data.map((d) => d.embedding);
}

async function writeEmbeddingVector(chunkId, embedding) {
  const vectorLiteral = `[${embedding.join(',')}]`;
  await prisma.$executeRaw(
    Prisma.sql`UPDATE "document_chunks" SET "embedding" = ${vectorLiteral}::vector WHERE "id" = ${chunkId}`
  );
}

export async function ingestDocumentFromFile({
  file,
  ownerId = null,
  title = '',
  generateEmbeddings = false,
} = {}) {
  if (!file) throw new Error('file is required');

  const originalName = file.name || 'document';
  const mimeType = file.type || null;
  const sourceType = inferSourceType({ mimeType, filename: originalName });

  // Only handle text-extractable formats for now
  if (!['TEXT', 'PDF', 'DOCX'].includes(sourceType)) {
    throw new Error('Only TXT, PDF, and DOCX are supported for ingestion right now.');
  }

  const docTitle = String(title || '').trim() || originalName;

  const created = await prisma.document.create({
    data: {
      ownerId,
      title: docTitle,
      sourceType,
      mimeType,
      originalName,
      status: 'PENDING',
    },
    select: { id: true },
  });

  try {
    const extracted = await extractTextFromFile(file, sourceType);
    if (!extracted.ok) throw new Error(extracted.error || 'Failed to extract text');

    const chunks = chunkText(extracted.text);
    if (chunks.length === 0) throw new Error('No text content found after extraction');

    const chunkRows = await prisma.documentChunk.createMany({
      data: chunks.map((content, chunkIndex) => ({
        documentId: created.id,
        chunkIndex,
        content,
        metadata: extracted.meta ? { extract: extracted.meta } : undefined,
      })),
    });

    if (generateEmbeddings) {
      // Insert embeddings via raw SQL into the pgvector column
      const embeddings = await embedTexts(chunks);
      const createdChunks = await prisma.documentChunk.findMany({
        where: { documentId: created.id },
        orderBy: { chunkIndex: 'asc' },
        select: { id: true, chunkIndex: true },
      });

      for (let i = 0; i < createdChunks.length; i++) {
        const emb = embeddings[i];
        if (Array.isArray(emb) && emb.length) {
          await writeEmbeddingVector(createdChunks[i].id, emb);
        }
      }
    }

    await prisma.document.update({
      where: { id: created.id },
      data: { status: 'READY' },
    });

    return {
      id: created.id,
      sourceType,
      chunksCreated: chunkRows.count,
      embeddingsGenerated: Boolean(generateEmbeddings),
    };
  } catch (err) {
    await prisma.document.update({
      where: { id: created.id },
      data: { status: 'FAILED' },
    });
    throw err;
  }
}

export async function ingestDocumentFromText({
  text,
  ownerId = null,
  title = 'Untitled document',
  generateEmbeddings = false,
} = {}) {
  const s = String(text || '').trim();
  if (!s) throw new Error('text is required');

  const created = await prisma.document.create({
    data: {
      ownerId,
      title: String(title || '').trim() || 'Untitled document',
      sourceType: 'TEXT',
      mimeType: 'text/plain',
      status: 'PENDING',
    },
    select: { id: true },
  });

  try {
    const chunks = chunkText(s);
    const chunkRows = await prisma.documentChunk.createMany({
      data: chunks.map((content, chunkIndex) => ({
        documentId: created.id,
        chunkIndex,
        content,
      })),
    });

    if (generateEmbeddings) {
      const embeddings = await embedTexts(chunks);
      const createdChunks = await prisma.documentChunk.findMany({
        where: { documentId: created.id },
        orderBy: { chunkIndex: 'asc' },
        select: { id: true },
      });
      for (let i = 0; i < createdChunks.length; i++) {
        const emb = embeddings[i];
        if (Array.isArray(emb) && emb.length) {
          await writeEmbeddingVector(createdChunks[i].id, emb);
        }
      }
    }

    await prisma.document.update({ where: { id: created.id }, data: { status: 'READY' } });

    return {
      id: created.id,
      sourceType: 'TEXT',
      chunksCreated: chunkRows.count,
      embeddingsGenerated: Boolean(generateEmbeddings),
    };
  } catch (err) {
    await prisma.document.update({ where: { id: created.id }, data: { status: 'FAILED' } });
    throw err;
  }
}

export async function fetchDocument(documentId) {
  return prisma.document.findUnique({
    where: { id: documentId },
    include: {
      chunks: {
        orderBy: { chunkIndex: 'asc' },
        select: { id: true, chunkIndex: true, content: true, metadata: true },
      },
    },
  });
}
