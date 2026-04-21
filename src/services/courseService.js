import { Prisma } from '@prisma/client';
import { OpenAI } from 'openai';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ENV } from '../configs/constant.js';
import { ErrorResponse } from '../lib/error.res.js';
import prisma from '../lib/prisma.js';
import { fetchAllImages } from './imageLibraryService.js';
import { normalizePublicUploadUrl, normalizeUploadsInText } from '../utils/publicUrl.js';

const client = new OpenAI({ apiKey: ENV.OPENAI_API_KEY });
const elevenlabs = new ElevenLabsClient({ apiKey: ENV.ELEVENLABS_API_KEY });

const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
const IMAGE_MARKDOWN_RE = /!\[.*?\]\(.*?\)/g;
const IMAGE_MARKDOWN_TEST_RE = /!\[.*?\]\(.*?\)/;
const IMAGE_MARKDOWN_URL_RE = /!\[[^\]]*]\(([^)]+)\)/g;
const LINK_MARKDOWN_RE = /(?<!!)\[([^\]]*)\]\(([^)]+)\)/g;
const IMAGE_DISTANCE_THRESHOLD = 0.45;
const SLIDE_IMAGE_VECTOR_LIMIT = 5;
const MIN_SLIDE_IMAGE_KEYWORD_SCORE = 2;
const STRICT_IMAGE_DISTANCE_THRESHOLD = 0.3;
const STRICT_KEYWORD_SCORE = 3;
const STOPWORDS = new Set([
  'the','a','an','and','or','of','to','in','on','for','with','by','from','at','as','is','are',
  'was','were','be','been','being','this','that','these','those','it','its','into','over','under',
  'about','between','within','without','via','per','than','then','but','not','no','yes','you','your',
  'we','our','they','their','he','she','his','her','them','us','i','me','my'
]);

function normalizeText(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  if (!text) return [];
  const tokens = normalizeText(text).split(' ').filter(Boolean);
  return tokens.filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function cleanTextForEmbedding(text) {
  return String(text || '')
    .replace(IMAGE_MARKDOWN_RE, ' ')
    .replace(/`{1,3}[^`]*`{1,3}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildImageIndex(images) {
  return (images || []).map((img) => {
    const tags = Array.isArray(img.tags)
      ? img.tags.join(' ')
      : (typeof img.tags === 'string' ? img.tags : '');
    const filename = img.url ? img.url.split('/').pop() : '';
    const text = [img.description || '', tags, filename || ''].join(' ');
    const tokenSet = new Set(tokenize(text));
    const imageId = img.id || img.url || `image-${normalizeText(text).slice(0, 40) || 'unknown'}`;
    return { ...img, id: imageId, _tokenSet: tokenSet };
  });
}

async function isUsableDocumentImage(img) {
  const url = String(img?.url || '').trim();
  if (!url) return false;

  const description = String(img?.description || '').trim().toLowerCase();
  const tags = Array.isArray(img?.tags) ? img.tags.filter(Boolean) : [];
  if (!tags.length && /^extracted document image(?: from page \d+)?$/i.test(description)) {
    return false;
  }

  const uploadsMatch = url.match(/^\/api\/v1\/uploads\/(.+)$/i);
  if (!uploadsMatch) return true;

  try {
    const filePath = path.join(process.cwd(), 'public', uploadsMatch[1]);
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) return false;

    // Tiny extracted assets are usually masks, separators, or blank placeholders.
    if (stats.size < 4096) return false;
  } catch {
    return false;
  }

  return true;
}

function scoreImageForSlide(image, slideTokens) {
  if (!image?._tokenSet || slideTokens.length === 0) return 0;
  let score = 0;
  for (const token of slideTokens) {
    if (image._tokenSet.has(token)) score += 1;
  }
  return score;
}

function appendImageToSlideContent(content, image) {
  const imageMarkdown = buildImageMarkdown(image.description, image.url);
  return `${content}\n\n${imageMarkdown}`;
}

function insertImageAtPosition(content, image, positionIndex = null) {
  const imageMarkdown = buildImageMarkdown(image.description, image.url);

  const blocks = String(content || '').split(/\n{2,}/).filter(Boolean);
  if (blocks.length === 0) {
    return imageMarkdown;
  }

  const idx = positionIndex === null
    ? Math.max(1, Math.floor(blocks.length / 2))
    : Math.min(Math.max(positionIndex, 0), blocks.length);

  const withImage = [...blocks.slice(0, idx), imageMarkdown, ...blocks.slice(idx)];
  return withImage.join('\n\n');
}

function extractImageUrls(content) {
  const urls = [];
  let match;
  while ((match = IMAGE_MARKDOWN_URL_RE.exec(content)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

function sanitizeSlideImages(content, allowedUrls) {
  if (!IMAGE_MARKDOWN_TEST_RE.test(content)) return { content, hasAllowedImage: false };

  const urls = extractImageUrls(content);
  const allowedFound = urls.filter((u) => allowedUrls.has(u));

  const hasAllowedImage = allowedFound.length > 0;
  if (hasAllowedImage && allowedFound.length <= 2) {
    return { content, hasAllowedImage: true, allowedUrls: allowedFound };
  }

  // Remove all images if none are from the library or too many images are present
  const cleaned = content.replace(IMAGE_MARKDOWN_RE, '').replace(/\n{3,}/g, '\n\n').trim();
  return { content: cleaned, hasAllowedImage: false, allowedUrls: [] };
}

function removeAllSlideImages(content) {
  return String(content || '').replace(IMAGE_MARKDOWN_RE, '').replace(/\n{3,}/g, '\n\n').trim();
}

function escapeAltText(alt) {
  return String(alt || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\]/g, '\\]')
    .trim();
}

function buildImageMarkdown(alt, url) {
  const safeAlt = escapeAltText(alt) || 'Related image';
  return `![${safeAlt}](${String(url || '').trim()})`;
}

function dedupeImagesByUrl(images) {
  return (images || []).filter(
    (img, index, arr) => arr.findIndex((candidate) => candidate.url === img.url) === index
  );
}

function normalizeAllowedLinksToImages(content, allowedUrls) {
  return String(content || '').replace(LINK_MARKDOWN_RE, (full, label, url) => {
    const normalizedUrl = String(url || '').trim();
    if (!allowedUrls.has(normalizedUrl)) return full;
    return buildImageMarkdown(label || 'Related image', normalizedUrl);
  });
}

async function embedSlideText(text) {
  if (!ENV.OPENAI_API_KEY) return null;
  const resp = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return resp.data?.[0]?.embedding || null;
}

async function findBestImageCandidatesByVector(slideText, limit = 5) {
  const embedding = await embedSlideText(slideText);
  if (!embedding) return [];
  const vectorLiteral = `[${embedding.join(',')}]`;

  const rows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT id, url, description, tags,
             ("embedding" <=> ${vectorLiteral}::vector) AS distance
      FROM "image_library"
      WHERE "embedding" IS NOT NULL
      ORDER BY "embedding" <=> ${vectorLiteral}::vector
      LIMIT ${limit}
    `
  );

  return Array.isArray(rows) ? rows : [];
}

async function getSlideVectorCandidates(slideText, limit = SLIDE_IMAGE_VECTOR_LIMIT) {
  const vectorCandidates = await findBestImageCandidatesByVector(slideText, limit);
  return buildImageIndex(
    vectorCandidates
      .filter((img) => Number(img?.distance) <= IMAGE_DISTANCE_THRESHOLD)
      .map((img) => ({
        id: img.id,
        url: normalizePublicUploadUrl(img.url),
        description: img.description || 'Uploaded image',
        tags: Array.isArray(img.tags) ? img.tags : [],
        source: 'UPLOAD',
        distance: Number(img.distance),
      }))
  );
}

async function getStrictSlideVectorCandidates(slideText, allowedUrls = null, limit = SLIDE_IMAGE_VECTOR_LIMIT) {
  const candidates = await getSlideVectorCandidates(slideText, limit);
  return candidates.filter((img) => {
    const distance = Number(img?.distance);
    if (!Number.isFinite(distance) || distance > STRICT_IMAGE_DISTANCE_THRESHOLD) return false;
    if (allowedUrls && !allowedUrls.has(img.url)) return false;
    return true;
  });
}

function isScienceTeacher(teacher) {
  const category = String(teacher?.category || '').toLowerCase();
  const name = String(teacher?.name || '').toLowerCase();
  const description = String(teacher?.description || '').toLowerCase();
  const systemPrompt = String(teacher?.systemPrompt || '').toLowerCase();
  return [category, name, description, systemPrompt].some((value) => value.includes('science'));
}

async function generateScienceSlideImage({ topic, slideTitle, slideContent, teacherName }) {
  if (!ENV.OPENAI_API_KEY) return null;

  const prompt = [
    `Create a clean educational science illustration for a classroom slide.`,
    `Topic: ${topic}.`,
    `Slide title: ${slideTitle}.`,
    `Teacher: ${teacherName || 'Science teacher'}.`,
    `Use the following slide content as context: ${cleanTextForEmbedding(slideContent).slice(0, 1800)}`,
    `Requirements: keep it scientifically relevant, diagram-like when possible, no decorative unrelated anatomy, no text labels unless essential, no watermark, portrait-free.`
  ].join(' ');

  try {
    const response = await client.images.generate({
      model: 'gpt-image-1',
      prompt,
      size: '1024x1024',
    });

    const imageData = response?.data?.[0];
    const b64 = imageData?.b64_json;
    if (!b64) return null;

    const buffer = Buffer.from(b64, 'base64');
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads', 'generated-images');
    await fs.mkdir(uploadsDir, { recursive: true });

    const filename = `${Date.now()}-${randomUUID()}.png`;
    const filePath = path.join(uploadsDir, filename);
    await fs.writeFile(filePath, buffer);

    return {
      id: `generated-${filename}`,
      source: 'OPENAI',
      url: `/api/v1/uploads/generated-images/${filename}`,
      description: `${slideTitle} illustration`,
      tags: tokenize(`${topic} ${slideTitle}`),
      _tokenSet: new Set(tokenize(`${topic} ${slideTitle}`)),
    };
  } catch (err) {
    console.error('[Image Generation] Failed to generate science fallback image:', err?.message || err);
    return null;
  }
}

async function isSlideImageRelevant(image, slideText, topicTokens, { strict = false } = {}) {
  if (!image?.url) return false;

  const scoreThreshold = strict ? STRICT_KEYWORD_SCORE : MIN_SLIDE_IMAGE_KEYWORD_SCORE;
  const keywordScore = scoreImageForSlide(image, tokenize(slideText));
  const topicScore = scoreImageForSlide(image, topicTokens);
  if (Math.max(keywordScore, topicScore) >= scoreThreshold) return true;

  const vectorCandidates = await getStrictSlideVectorCandidates(slideText, new Set([image.url]), 1);
  return vectorCandidates.some((candidate) => candidate.url === image.url);
}

async function generateSlideAudio(title, content, voiceId = DEFAULT_VOICE_ID) {
  try {
    // Clean markdown formatting before sending to TTS
    const cleanText = `${title}. ${content}`
      .replace(/#{1,6}\s*/g, '')       // headings
      .replace(/\*\*(.*?)\*\*/g, '$1') // bold
      .replace(/\*(.*?)\*/g, '$1')     // italic
      .replace(IMAGE_MARKDOWN_RE, '') // remove images from TTS
      .replace(/`{1,3}[^`]*`{1,3}/g, '') // code
      .replace(/^\s*[-*+]\s+/gm, '')   // bullet points
      .replace(/^\s*\d+\.\s+/gm, '')   // numbered lists
      .replace(/>\s*/g, '')            // blockquotes
      .replace(/\n{2,}/g, '. ')        // paragraph breaks → pauses
      .replace(/\n/g, ' ')
      .trim();

    // Limit to ~2500 chars to stay within ElevenLabs per-request limits
    const truncated = cleanText.length > 2500 ? cleanText.slice(0, 2500) + '...' : cleanText;

    const audioStream = await elevenlabs.textToSpeech.convert(voiceId, {
      text: truncated,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true,
      },
    });

    // Collect stream chunks into a single Buffer
    const chunks = [];
    for await (const chunk of audioStream) {
      chunks.push(chunk);
    }
    const audioBuffer = Buffer.concat(chunks);
    return audioBuffer.toString('base64');
  } catch (err) {
    console.error(`[ElevenLabs] Failed to generate audio for slide "${title}":`, err?.message);
    return null; // non-fatal — slide still works without audio
  }
}

// ─── Core Helpers ─────────────────────────────────────────────────────────────

/**
 * Searches for relevant content in the documents table via title match and vector similarity.
 */
async function getContextFromDocuments(topic, teacherId) {
  try {
    // 1. Try exact or partial title match first
    const titleMatchedDocs = await prisma.document.findMany({
      where: {
        title: { contains: topic, mode: 'insensitive' },
        status: 'READY',
        teacherId,
      },
      include: { chunks: { orderBy: { chunkIndex: 'asc' }, take: 10 } },
      take: 2,
    });

    if (titleMatchedDocs.length > 0) {
      return titleMatchedDocs.flatMap(d => d.chunks.map(c => c.content)).join('\n\n');
    }

    // 2. Fallback: keyword search inside document chunks for this teacher.
    const keywordPattern = `%${String(topic || '').trim()}%`;
    const keywordChunks = await prisma.$queryRaw(
      Prisma.sql`
        SELECT dc."content"
        FROM "document_chunks" dc
        INNER JOIN "documents" d ON d."id" = dc."document_id"
        WHERE d."teacher_id" = ${teacherId}
          AND d."status" = 'READY'
          AND dc."content" ILIKE ${keywordPattern}
        ORDER BY d."created_at" DESC, dc."chunk_index" ASC
        LIMIT 8
      `
    );

    if (Array.isArray(keywordChunks) && keywordChunks.length > 0) {
      return keywordChunks.map((c) => c.content).join('\n\n');
    }

    // 3. Fallback: Semantic search using pgvector
    const embeddingResponse = await client.embeddings.create({
      model: 'text-embedding-3-small',
      input: topic,
    });
    const vector = embeddingResponse.data[0].embedding;
    const vectorString = `[${vector.join(',')}]`;

    // Find the top 5 most relevant chunks across all documents
    const similarChunks = await prisma.$queryRaw`
      SELECT content FROM "document_chunks"
      INNER JOIN "documents" d ON d."id" = "document_chunks"."document_id"
      WHERE d."teacher_id" = ${teacherId} AND d."status" = 'READY'
      ORDER BY "document_chunks"."embedding" <=> ${vectorString}::vector
      LIMIT 8
    `;

    return similarChunks.map(c => c.content).join('\n\n');
  } catch (err) {
    console.error(`[Retrieval] Failed to fetch document context: ${err.status || 'Error'} - ${err.message}`);
    return '';
  }
}

async function getContextFromDocumentId(documentId, teacherId) {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      chunks: {
        orderBy: { chunkIndex: 'asc' },
        select: { content: true, metadata: true },
      },
    },
  });

  if (!doc) {
    throw new Error('Document not found for the provided document_id.');
  }

  if (!teacherId) {
    throw ErrorResponse.badRequest('teacherId is required to generate course content from teacher documents.');
  }

  if (doc.teacherId !== teacherId) {
    throw ErrorResponse.unprocessableEntity('The selected document does not belong to the selected teacher.');
  }

  if (doc.status !== 'READY') {
    throw new Error(`Document is not ready yet (current status: ${doc.status}).`);
  }

  if (!Array.isArray(doc.chunks) || doc.chunks.length === 0) {
    throw new Error('No extracted chunks found for the provided document.');
  }

  const metadataLines = [
    `Document Title: ${doc.title || ''}`,
    `Source Type: ${doc.sourceType || ''}`,
    `MIME Type: ${doc.mimeType || ''}`,
    `Original Filename: ${doc.originalName || ''}`,
  ];

  const extractionMeta = doc.chunks
    .map((chunk) => chunk.metadata?.extract)
    .filter(Boolean);

  if (extractionMeta.length > 0) {
    metadataLines.push(`Extraction Metadata: ${JSON.stringify(extractionMeta[0])}`);
  }

  const chunkText = doc.chunks.map((c) => c.content).join('\n\n');
  return `${metadataLines.join('\n')}\n\nDocument Content:\n${chunkText}`;
}

async function getDocumentImagesFromDocumentId(documentId, teacherId) {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      chunks: {
        orderBy: { chunkIndex: 'asc' },
        take: 1,
        select: { metadata: true },
      },
    },
  });

  if (!doc || doc.teacherId !== teacherId || doc.status !== 'READY') return [];
  const extracted = doc.chunks?.[0]?.metadata?.extract;
  const images = extracted?.documentImages;
  if (!Array.isArray(images)) return [];

  const mappedImages = images
    .filter((img) => typeof img?.url === 'string' && img.url.trim())
    .map((img, index) => ({
      id: `docimg-${documentId}-${index}`,
      source: 'DOCUMENT',
      url: img.url,
      description: img.description || 'Document image',
      tags: Array.isArray(img.tags) ? img.tags : [],
    }));

  const usability = await Promise.all(mappedImages.map((img) => isUsableDocumentImage(img)));
  return mappedImages.filter((_, index) => usability[index]);
}

function resolveTeacherCoursePolicy(teacher, documentId) {
  return {
    useTeacherKnowledge: false,
    useDatabaseDocs: true,
    requireDocumentContext: true,
    allowGeneralKnowledge: false,
    imageMode: 'document',
    allowAIGeneratedImageFallback: isScienceTeacher(teacher),
    restrictUploadedLibraryImages: isScienceTeacher(teacher),
  };
}

function scoreTeacherDocumentForTopic(doc, topic) {
  const safeTopic = String(topic || '').trim().toLowerCase();
  if (!safeTopic || !doc) return 0;

  const topicTokens = tokenize(safeTopic);
  const title = String(doc.title || '').toLowerCase();
  const chunkText = Array.isArray(doc.chunks)
    ? doc.chunks.map((chunk) => String(chunk.content || '')).join(' \n ')
    : '';
  const normalizedChunkText = chunkText.toLowerCase();

  let score = 0;

  if (title.includes(safeTopic)) score += 100;
  if (normalizedChunkText.includes(safeTopic)) score += 80;

  for (const token of topicTokens) {
    if (title.includes(token)) score += 12;
    if (normalizedChunkText.includes(token)) score += 8;
  }

  return score;
}

async function getRelevantDocumentBundle(topic, teacherId, { maxDocs = 3, maxChunksPerDoc = 10, maxImages = 10 } = {}) {
  const safeTopic = String(topic || '').trim();
  if (!safeTopic || !teacherId) return { context: '', images: [] };

  const docs = await prisma.document.findMany({
    where: {
      status: 'READY',
      teacherId,
    },
    include: {
      chunks: {
        orderBy: { chunkIndex: 'asc' },
        select: { content: true, metadata: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  const rankedDocs = docs
    .map((doc) => ({
      ...doc,
      relevanceScore: scoreTeacherDocumentForTopic(doc, safeTopic),
    }))
    .filter((doc) => doc.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, maxDocs)
    .map((doc) => ({
      ...doc,
      chunks: Array.isArray(doc.chunks) ? doc.chunks.slice(0, maxChunksPerDoc) : [],
    }));

  if (rankedDocs.length === 0) return { context: '', images: [] };

  const context = rankedDocs
    .map((doc) => {
      const metadataLines = [
        `Document Title: ${doc.title || ''}`,
        `Source Type: ${doc.sourceType || ''}`,
        `Original Filename: ${doc.originalName || ''}`,
      ];
      const chunkText = (doc.chunks || []).map((chunk) => chunk.content).join('\n\n');
      return `${metadataLines.join('\n')}\n\nDocument Content:\n${chunkText}`;
    })
    .join('\n\n---\n\n');

  const imageGroups = await Promise.all(
    rankedDocs.map(async (doc) => getDocumentImagesFromDocumentId(doc.id, teacherId))
  );
  const images = imageGroups.flat().slice(0, maxImages);

  return { context, images };
}

async function getRelevantUploadedImages(topic, docContext, limit = 10) {
  try {
    const uploadedImages = await fetchAllImages();
    const indexedImages = buildImageIndex(uploadedImages);
    const scoringTokens = tokenize(`${topic} ${String(docContext || '').slice(0, 3000)}`);

    const scoredImages = indexedImages
      .map((img) => ({
        ...img,
        relevanceScore: scoreImageForSlide(img, scoringTokens),
      }))
      .filter((img) => img.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);

    const filtered = [];
    for (const img of scoredImages) {
      if (filtered.length >= limit) break;
      if (await isUsableDocumentImage(img)) {
        filtered.push(img);
      }
    }

    if (filtered.length > 0) {
      return filtered;
    }

    const vectorCandidates = await findBestImageCandidatesByVector(
      cleanTextForEmbedding(`${topic} ${String(docContext || '').slice(0, 3000)}`),
      limit
    );

    const normalizedVectorCandidates = buildImageIndex(
      vectorCandidates
        .filter((img) => Number(img?.distance) <= IMAGE_DISTANCE_THRESHOLD)
        .map((img) => ({
          id: img.id,
          url: normalizePublicUploadUrl(img.url),
          description: img.description || 'Uploaded image',
          tags: Array.isArray(img.tags) ? img.tags : [],
          source: 'UPLOAD',
        }))
    );

    const vectorFiltered = [];
    for (const img of normalizedVectorCandidates) {
      if (vectorFiltered.length >= limit) break;
      if (await isUsableDocumentImage(img)) {
        vectorFiltered.push(img);
      }
    }

    return vectorFiltered;
  } catch (err) {
    console.error('[Image Retrieval] Failed to fetch relevant uploaded images:', err.message);
    return [];
  }
}

async function createCourse(topic, numSlides = 5, teacherId, documentId = null) {
  numSlides = Math.min(Math.max(numSlides, 1), 10);

  if (!teacherId) {
    throw ErrorResponse.badRequest('teacherId is required for course generation.');
  }

  let extraContext = '';
  let imageIndex = [];
  let teacher = null;
  let teacherPolicy = resolveTeacherCoursePolicy(null, documentId);
  let systemPersona = 'You are a professional educational content architect. Your purpose is to structure and summarize provided document content into high-quality study materials.';
  let selectedVoiceId = DEFAULT_VOICE_ID;

  console.log('[Course Service] createCourse input', {
    topic,
    numSlides,
    teacherId,
    documentId,
  });

  if (teacherId) {
    try {
      teacher = await prisma.avatarTeacher.findUnique({
        where: { id: teacherId },
      });

      console.log('[Course Service] teacher lookup result', {
        requestedTeacherId: teacherId,
        found: Boolean(teacher),
        resolvedTeacherId: teacher?.id || null,
        resolvedTeacherName: teacher?.name || null,
        resolvedTeacherCategory: teacher?.category || null,
      });

      if (teacher) {
        teacherPolicy = resolveTeacherCoursePolicy(teacher, documentId);
        selectedVoiceId = teacher.voiceId || DEFAULT_VOICE_ID;

        systemPersona = `You are generating content on behalf of ${teacher.name}. Description: ${teacher.description}. 
${teacher.systemPrompt ? `Specific Teacher Instructions: ${teacher.systemPrompt}` : ''}`;
      }
    } catch (err) {
      console.error('Failed to fetch teacher config for content generation:', err);
    }
  }

  if (!teacher) {
    throw ErrorResponse.notFound('Selected teacher was not found.');
  }

  console.log('[Course Service] resolved teacher policy', {
    requestedTeacherId: teacherId,
    resolvedTeacherId: teacher?.id || null,
    resolvedTeacherName: teacher?.name || null,
    documentId,
    teacherPolicy,
  });

  // ── Step 0: Build context from document(s) ────────────────────────────────
  let docContext = '';
  let documentImages = [];

  if (teacherPolicy.useDatabaseDocs) {
    if (documentId) {
      docContext = await getContextFromDocumentId(documentId, teacherId);
      documentImages = await getDocumentImagesFromDocumentId(documentId, teacherId);
    } else if (teacherPolicy.requireDocumentContext) {
      const bundle = await getRelevantDocumentBundle(topic, teacherId);
      docContext = bundle.context;
      documentImages = bundle.images;
    } else {
      docContext = await getContextFromDocuments(topic, teacherId);
    }
  }

  console.log('[Course Service] retrieval outcome', {
    requestedTeacherId: teacherId,
    resolvedTeacherId: teacher?.id || null,
    topic,
    documentId,
    useDatabaseDocs: teacherPolicy.useDatabaseDocs,
    requireDocumentContext: teacherPolicy.requireDocumentContext,
    docContextLength: docContext.length,
    documentImagesCount: documentImages.length,
  });

  if (teacherPolicy.requireDocumentContext && !docContext) {
    throw ErrorResponse.unprocessableEntity(
      `No relevant document data found for "${topic}" for ${teacher?.name || 'the selected teacher'}. Upload a relevant document for this teacher before generating the course.`
    );
  }

  if (docContext) {
    extraContext += `
SOURCE MATERIAL FROM DATABASE DOCUMENTS:
---
${docContext}
---
INSTRUCTION: Strictly use ONLY the provided "SOURCE MATERIAL" for factual content. Do NOT supplement with any external knowledge.
`;
  }

  if (teacherPolicy.imageMode === 'document') {
    const uploadedImageFallback = teacherPolicy.restrictUploadedLibraryImages
      ? []
      : await getRelevantUploadedImages(topic, docContext, 10);
    const combinedImages = dedupeImagesByUrl([...documentImages, ...uploadedImageFallback]);

    imageIndex = buildImageIndex(combinedImages);

    if (combinedImages.length > 0) {
      extraContext += `
AVAILABLE VISUAL ASSETS:
---
${combinedImages.map((img) => `- URL: ${img.url} | Description: ${img.description}`).join('\n')}
---
`;
    }
  }

  const userPrompt = `Create an elite-level study course on the topic: '${topic}'. The course must consist of exactly ${numSlides} slides.

STRICT LIMITATION: All factual content, theories, and examples MUST be derived SOLELY from the "SOURCE MATERIAL" provided below. Do NOT use your own training data to add information.

${extraContext}

For EACH slide, the 'content' field must follow these rules:
1. Provide a clear, descriptive slide title (without slide numbers).
2. The content must be detailed and substantial (at least 150-250 words per slide).
3. Use Markdown formatting to structure the content, including:
   - A detailed heading or summary of the concept.
   - Bullet points for core mechanisms, principles, or theories.
   - A section for a practical 'Real-World Example' or illustrative scenario.
   - A 'Key Study Takeaway' at the end of the content.
4. Focus on explaining the "how" and "why" based exclusively on the provided text.
5. Content should progress logically from foundations to complex applications across the slides.
6. If "AVAILABLE VISUAL ASSETS" are provided and highly relevant to a slide's concept, embed them using standard Markdown: ![Description](URL).
7. Limit to a maximum of 2 images per slide. Only include an image if it genuinely enhances the educational value of that specific slide.

CRITICAL INSTRUCTION: Do NOT include numbers in the slide titles (e.g., use 'Wave-Particle Duality', NOT 'Slide 2: Wave-Particle Duality').`;

  try {
    // ── Step 1: Generate slide content from OpenAI ─────────────────────────
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPersona },
        { role: 'user', content: userPrompt },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'CourseSchema',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              slides: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    content: { type: 'string' },
                  },
                  required: ['title', 'content'],
                  additionalProperties: false,
                },
              },
            },
            required: ['title', 'slides'],
            additionalProperties: false,
          },
        },
      },
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error('Empty response from LLM');
    const result = JSON.parse(raw);

    // ── Step 2: Ensure each slide has at least one relevant image ──────────
    if (imageIndex.length > 0 || teacherPolicy.allowAIGeneratedImageFallback) {
      const usedImageIds = new Set();
      const usedImageUrls = new Set();
      const topicTokens = tokenize(topic);
      const allowedUrls = new Set(imageIndex.map((img) => img.url));
      const urlToImage = new Map(imageIndex.map((img) => [img.url, img]));
      const updatedSlides = [];

      for (const slide of result.slides) {
        const normalizedContent = normalizeAllowedLinksToImages(slide.content, allowedUrls);
        const sanitized = sanitizeSlideImages(normalizedContent, allowedUrls);
        const existingAllowed = [...new Set(sanitized.allowedUrls || [])];
        const approvedExisting = [];
        const slideText = cleanTextForEmbedding(`${slide.title} ${sanitized.content} ${topic}`);

        for (const url of existingAllowed) {
          if (usedImageUrls.has(url)) continue;
          if (approvedExisting.length >= 2) break;
          const img = urlToImage.get(url);
          if (!img) continue;
          const isRelevant = await isSlideImageRelevant(img, slideText, topicTokens, {
            strict: teacherPolicy.restrictUploadedLibraryImages,
          });
          if (!isRelevant) continue;
          approvedExisting.push(url);
          usedImageUrls.add(url);
          if (img?.id) usedImageIds.add(img.id);
        }

        const needAdditional = approvedExisting.length < 2;
        let selectedImages = [];

        // Prefer vector similarity when embeddings exist
        const vectorCandidates = teacherPolicy.restrictUploadedLibraryImages
          ? []
          : await getSlideVectorCandidates(slideText, SLIDE_IMAGE_VECTOR_LIMIT);
        const vectorMatches = vectorCandidates
          .filter((c) => Number(c?.distance) <= IMAGE_DISTANCE_THRESHOLD)
          .filter((c) => !approvedExisting.includes(c.url))
          .filter((c) => !usedImageUrls.has(c.url));

        if (vectorMatches.length > 0) {
          for (const candidate of vectorMatches) {
            if (selectedImages.length >= (needAdditional ? (2 - approvedExisting.length) : 0)) break;
            if (usedImageIds.has(candidate.id)) continue;
            if (usedImageUrls.has(candidate.url)) continue;
            selectedImages.push(candidate);
            usedImageIds.add(candidate.id);
            usedImageUrls.add(candidate.url);
          }
        }

        // If vector similarity looks weak, fall back to token overlap scoring
        if (selectedImages.length === 0 && needAdditional) {
          const slideTokens = tokenize(`${slide.title} ${sanitized.content} ${topic}`);
          let bestScore = -1;
          let keywordBest = null;

          for (const img of imageIndex) {
            const score = scoreImageForSlide(img, slideTokens);
            if (score > bestScore || (score === bestScore && !usedImageIds.has(img.id))) {
              keywordBest = img;
              bestScore = score;
            }
          }

          if (!keywordBest || bestScore === 0) {
            let topicBest = null;
            let topicBestScore = -1;
            for (const img of imageIndex) {
              const score = scoreImageForSlide(img, topicTokens);
              if (score > topicBestScore || (score === topicBestScore && !usedImageIds.has(img.id))) {
                topicBest = img;
                topicBestScore = score;
              }
            }
            if (topicBest) {
              keywordBest = topicBest;
              bestScore = topicBestScore;
            }
          }

          if (
            keywordBest &&
            bestScore >= (teacherPolicy.restrictUploadedLibraryImages ? STRICT_KEYWORD_SCORE : MIN_SLIDE_IMAGE_KEYWORD_SCORE) &&
            !approvedExisting.includes(keywordBest.url) &&
            !usedImageUrls.has(keywordBest.url)
          ) {
            selectedImages.push(keywordBest);
            usedImageIds.add(keywordBest.id);
            usedImageUrls.add(keywordBest.url);
          }
        }

        if (
          selectedImages.length === 0 &&
          approvedExisting.length === 0 &&
          teacherPolicy.allowAIGeneratedImageFallback
        ) {
          const generatedImage = await generateScienceSlideImage({
            topic,
            slideTitle: slide.title,
            slideContent: sanitized.content,
            teacherName: teacher?.name,
          });

          if (generatedImage) {
            imageIndex.push(generatedImage);
            allowedUrls.add(generatedImage.url);
            urlToImage.set(generatedImage.url, generatedImage);
            selectedImages.push(generatedImage);
            usedImageIds.add(generatedImage.id);
            usedImageUrls.add(generatedImage.url);
          }
        }

        let content = removeAllSlideImages(sanitized.content);
        const approvedExistingImages = approvedExisting
          .map((url) => urlToImage.get(url))
          .filter(Boolean);
        const finalImages = [...approvedExistingImages, ...selectedImages].slice(0, 2);

        if (finalImages.length > 0) {
          content = insertImageAtPosition(content, finalImages[0], null);
          if (finalImages.length > 1) {
            content = insertImageAtPosition(content, finalImages[1], Math.max(0, content.split(/\n{2,}/).length - 1));
          }
        }

        updatedSlides.push({ ...slide, content });
      }

      result.slides = updatedSlides;
    }

    // ── Step 3: Generate ElevenLabs audio for every slide in parallel ──────
    console.log(`[ElevenLabs] Generating audio for ${result.slides.length} slides...`);
    const audioResults = await Promise.all(
      result.slides.map((slide) => generateSlideAudio(slide.title, slide.content,selectedVoiceId))
    );
    console.log(
      `[ElevenLabs] Audio done. ${audioResults.filter(Boolean).length}/${result.slides.length} succeeded.`
    );

    // ── Step 3: Save course + slides (with audio) to DB ────────────────────
    const saved = await prisma.course.create({
      data: {
        title: result.title,
        slides: {
          create: result.slides.map((slide, i) => ({
            title: slide.title,
            content: slide.content,
            audioBase64: audioResults[i] ?? null, // null if ElevenLabs failed
            imageUrls: extractImageUrls(slide.content).slice(0, 2),
          })),
        },
      },
      include: { slides: true },
    });

    return {
      success: true,
      id: saved.id,
      title: saved.title,
      slides: saved.slides.map((s) => ({
        id: s.id,
        title: s.title,
        content: normalizeUploadsInText(s.content),
        audioBase64: s.audioBase64 ?? null, // frontend uses this to play audio
        imageUrls: (s.imageUrls ?? []).map((url) => normalizePublicUploadUrl(url)),
      })),
    };
  } catch (err) {
    console.error('Error in createCourse:', err.message || err);
    throw err;
  }
}

// ─── Exported Service Functions ───────────────────────────────────────────────

export async function generateCourse(topic, numSlides = 5, teacherId, documentId = null) {
  try {
    console.log(`Generating course for topic: '${topic}' from teacher: ${teacherId || 'None'} with ${numSlides} slides. documentId=${documentId || 'None'}`);
    const courseResponse = await createCourse(topic, numSlides, teacherId, documentId);
    console.log(`Course saved with ID: ${courseResponse.id}`);
    return courseResponse.id;
  } catch (err) {
    console.error('Error in generateCourse:', err);
    throw err;
  }
}

export async function fetchCourse(courseId) {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: { slides: true },
  });

  if (!course) return null;

  return {
    success: true,
    id: course.id,
    title: course.title,
    slides: course.slides.map((s) => ({
      id: s.id,
      title: s.title,
      content: normalizeUploadsInText(s.content),
      audioBase64: s.audioBase64 ?? null, // included on fetch too
      imageUrls: (s.imageUrls ?? []).map((url) => normalizePublicUploadUrl(url)),
    })),
  };
}

export async function fetchAllCoursesMetadata() {
  const courses = await prisma.course.findMany({
    orderBy: { createdAt: 'desc' },
    select: { id: true, title: true, createdAt: true },
  });

  return courses.map((c) => ({
    id: c.id,
    title: c.title,
    created_at: c.createdAt.toISOString(),
  }));
}

export async function deleteCourseById(courseId) {
  if (!courseId || typeof courseId !== 'string') {
    return { success: false, error: 'Invalid course id' };
  }

  try {
    const deleted = await prisma.course.deleteMany({
      where: { id: courseId },
    });
    if (deleted.count === 0) {
      return { success: false, notFound: true, error: 'Course not found' };
    }
    return { success: true };
  } catch (err) {
    console.error('Error in deleteCourseById:', err);
    return { success: false, error: 'Failed to delete course' };
  }
}
