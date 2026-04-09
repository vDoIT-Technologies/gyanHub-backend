import { Prisma } from '@prisma/client';
import { OpenAI } from 'openai';
import { ENV } from '../configs/constant.js';
import prisma from '../lib/prisma.js';

const openai = new OpenAI({ apiKey: ENV.OPENAI_API_KEY });

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags;
  if (typeof tags === 'string') return tags.split(',').map((t) => t.trim()).filter(Boolean);
  return [];
}

function buildImageEmbeddingText({ description, tags }) {
  const tagText = Array.isArray(tags) ? tags.join(' ') : '';
  return `${description || ''}\n${tagText}`.trim();
}

async function embedText(text) {
  if (!ENV.OPENAI_API_KEY) return null;
  const resp = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return resp.data?.[0]?.embedding || null;
}

async function writeImageEmbeddingVector(imageId, embedding) {
  const vectorLiteral = `[${embedding.join(',')}]`;
  await prisma.$executeRaw(
    Prisma.sql`UPDATE "image_library" SET "embedding" = ${vectorLiteral}::vector WHERE "id" = ${imageId}`
  );
}

export async function addImageToLibrary({ url, description, tags = [], generateEmbedding = true }) {
  const normalizedTags = normalizeTags(tags);
  const created = await prisma.imageLibrary.create({
    data: {
      url,
      description,
      tags: normalizedTags,
    }
  });

  if (generateEmbedding) {
    try {
      const text = buildImageEmbeddingText({ description, tags: normalizedTags });
      const embedding = await embedText(text);
      if (embedding) {
        await writeImageEmbeddingVector(created.id, embedding);
      }
    } catch (err) {
      console.error('[ImageLibrary] Failed to generate embedding:', err?.message);
    }
  }

  return created;
}

export async function fetchAllImages() {
  return prisma.imageLibrary.findMany({ orderBy: { createdAt: 'desc' } });
}
