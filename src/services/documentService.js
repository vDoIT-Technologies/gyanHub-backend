import { Prisma } from '@prisma/client';
import { OpenAI } from 'openai';
import pdf from 'pdf-parse';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ENV } from '../configs/constant.js';
import prisma from '../lib/prisma.js';

const openai = new OpenAI({ apiKey: ENV.OPENAI_API_KEY });

const STOPWORDS = new Set([
  'the','a','an','and','or','of','to','in','on','for','with','by','from','at','as','is','are',
  'was','were','be','been','being','this','that','these','those','it','its','into','over','under',
  'about','between','within','without','via','per','than','then','but','not','no','yes','you','your',
  'we','our','they','their','he','she','his','her','them','us','i','me','my'
]);

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

function sanitizeFilename(name) {
  return String(name || 'document')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120) || 'document';
}

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  return normalizeText(text)
    .split(' ')
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function buildShortDescription(pageText, index, pageNum = null) {
  const cleaned = String(pageText || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return pageNum ? `Extracted document image from page ${pageNum}` : `Extracted document image ${index}`;
  }

  const words = cleaned.split(' ').slice(0, 22).join(' ');
  return pageNum ? `Page ${pageNum} visual: ${words}` : `Document visual: ${words}`;
}

async function runCmd(cmd, args) {
  try {
    const proc = Bun.spawn([cmd, ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      return { ok: false, stdout, stderr, exitCode };
    }

    return { ok: true, stdout, stderr, exitCode };
  } catch (err) {
    return { ok: false, stdout: '', stderr: err?.message || 'Command execution failed', exitCode: -1 };
  }
}

async function storeUploadedFile(documentId, originalName, buffer) {
  const dir = path.join(process.cwd(), 'documents');
  await fs.mkdir(dir, { recursive: true });

  const base = sanitizeFilename(originalName);
  const storedName = `${Date.now()}-${documentId}-${base}`;
  const fullPath = path.join(dir, storedName);

  await fs.writeFile(fullPath, buffer);
  return fullPath;
}

function parsePdfImagesListOutput(stdout) {
  const lines = String(stdout || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const rows = [];

  for (const line of lines) {
    if (!/^\d+\s+\d+\s+/.test(line)) continue;
    const parts = line.split(/\s+/);
    const page = Number(parts[0]);
    if (Number.isFinite(page)) {
      rows.push({ page });
    }
  }

  return rows;
}

async function getPdfPageText(pdfPath, pageNum) {
  const result = await runCmd('pdftotext', ['-f', String(pageNum), '-l', String(pageNum), '-layout', pdfPath, '-']);
  if (!result.ok) return '';
  return String(result.stdout || '').trim();
}

async function extractPdfImages({ pdfPath, documentId, maxImages = 12 }) {
  const uploadsDir = path.join(process.cwd(), 'public', 'uploads', 'document-images', documentId);
  await fs.mkdir(uploadsDir, { recursive: true });

  const listResult = await runCmd('pdfimages', ['-list', pdfPath]);
  const pageRows = parsePdfImagesListOutput(listResult.stdout);

  const extractPrefix = path.join(uploadsDir, 'img');
  const extractResult = await runCmd('pdfimages', ['-all', pdfPath, extractPrefix]);
  if (!extractResult.ok) {
    console.error('[Document Ingest] pdfimages extraction failed:', extractResult.stderr || 'Unknown error');
    return [];
  }

  const allFiles = await fs.readdir(uploadsDir);
  const imageFiles = allFiles
    .filter((name) => /^img-\d+\.(png|jpg|jpeg|webp)$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (imageFiles.length === 0) return [];

  const pageTextCache = new Map();
  const documentImages = [];

  for (let i = 0; i < imageFiles.length && documentImages.length < maxImages; i++) {
    const filename = imageFiles[i];
    const row = pageRows[i] || null;
    const pageNum = row?.page || null;

    let pageText = '';
    if (pageNum) {
      if (pageTextCache.has(pageNum)) {
        pageText = pageTextCache.get(pageNum);
      } else {
        pageText = await getPdfPageText(pdfPath, pageNum);
        pageTextCache.set(pageNum, pageText);
      }
    }

    const description = buildShortDescription(pageText, i + 1, pageNum);
    const tags = tokenize(pageText).slice(0, 12);

    documentImages.push({
      source: 'DOCUMENT',
      url: `/api/v1/uploads/document-images/${documentId}/${filename}`,
      description,
      tags,
      page: pageNum,
      file: filename,
    });
  }

  return documentImages;
}

async function extractTextFromFileBuffer(buf, sourceType, file) {
  const filename = file?.name || 'document';
  const mimeType = file?.type || '';

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
    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);
    const storedPath = await storeUploadedFile(created.id, originalName, fileBuffer);

    await prisma.document.update({
      where: { id: created.id },
      data: { storageUrl: storedPath },
    });

    const extracted = await extractTextFromFileBuffer(fileBuffer, sourceType, file);
    if (!extracted.ok) throw new Error(extracted.error || 'Failed to extract text');

    let documentImages = [];
    if (sourceType === 'PDF') {
      documentImages = await extractPdfImages({ pdfPath: storedPath, documentId: created.id, maxImages: 12 });
      if (documentImages.length > 0) {
        extracted.meta = {
          ...(extracted.meta || {}),
          documentImages,
        };
      }
    }

    const chunks = chunkText(extracted.text);
    if (chunks.length === 0) throw new Error('No text content found after extraction');

    const chunkRows = await prisma.documentChunk.createMany({
      data: chunks.map((content, chunkIndex) => ({
        documentId: created.id,
        chunkIndex,
        content,
        metadata:
          chunkIndex === 0 && extracted.meta
            ? { extract: extracted.meta }
            : undefined,
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
      imagesExtracted: documentImages.length,
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
