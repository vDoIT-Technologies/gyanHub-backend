import { Prisma } from '@prisma/client';
import { OpenAI } from 'openai';
import { ENV } from '../src/configs/constant.js';
import prisma from '../src/lib/prisma.js';

const openai = new OpenAI({ apiKey: ENV.OPENAI_API_KEY });
const BATCH_SIZE = 50;

function buildImageEmbeddingText({ description, tags }) {
  const tagText = Array.isArray(tags) ? tags.join(' ') : '';
  return `${description || ''}\n${tagText}`.trim();
}

async function embedTexts(texts) {
  const resp = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts,
  });
  return resp.data.map((d) => d.embedding);
}

async function writeEmbeddingVector(imageId, embedding) {
  const vectorLiteral = `[${embedding.join(',')}]`;
  await prisma.$executeRaw(
    Prisma.sql`UPDATE "image_library" SET "embedding" = ${vectorLiteral}::vector WHERE "id" = ${imageId}`
  );
}

async function main() {
  if (!ENV.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is missing');
  }

  const countResult = await prisma.$queryRaw(
    Prisma.sql`SELECT COUNT(*)::int as count FROM "image_library" WHERE "embedding" IS NULL`
  );
  const total = countResult[0].count;

  console.log(`[Backfill] Images missing embeddings: ${total}`);
  if (total === 0) return;

  let processed = 0;
  while (true) {
    const images = await prisma.$queryRaw(
      Prisma.sql`
        SELECT id, description, tags 
        FROM "image_library" 
        WHERE "embedding" IS NULL 
        ORDER BY "createdAt" DESC 
        LIMIT ${BATCH_SIZE}`
    );

    if (images.length === 0) break;

    const texts = images.map((img) =>
      buildImageEmbeddingText({ description: img.description, tags: img.tags })
    );
    const embeddings = await embedTexts(texts);

    for (let i = 0; i < images.length; i += 1) {
      await writeEmbeddingVector(images[i].id, embeddings[i]);
    }

    processed += images.length;
    console.log(`[Backfill] Processed ${processed}/${total}`);
  }

  console.log('[Backfill] Done.');
}

main()
  .catch((err) => {
    console.error('[Backfill] Failed:', err?.message || err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
