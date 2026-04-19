import { Prisma } from '@prisma/client';
import { OpenAI } from 'openai';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ENV } from '../configs/constant.js';
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
const OPENAI_IMAGE_MODEL = 'gpt-image-1';
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
async function getContextFromDocuments(topic) {
  try {
    // 1. Try exact or partial title match first
    const titleMatchedDocs = await prisma.document.findMany({
      where: {
        title: { contains: topic, mode: 'insensitive' },
        status: 'READY',
      },
      include: { chunks: { orderBy: { chunkIndex: 'asc' }, take: 10 } },
      take: 2,
    });

    if (titleMatchedDocs.length > 0) {
      return titleMatchedDocs.flatMap(d => d.chunks.map(c => c.content)).join('\n\n');
    }

    // 2. Fallback: Semantic search using pgvector
    const embeddingResponse = await client.embeddings.create({
      model: 'text-embedding-3-small',
      input: topic,
    });
    const vector = embeddingResponse.data[0].embedding;
    const vectorString = `[${vector.join(',')}]`;

    // Find the top 5 most relevant chunks across all documents
    const similarChunks = await prisma.$queryRaw`
      SELECT content FROM "document_chunks"
      ORDER BY "embedding" <=> ${vectorString}::vector
      LIMIT 8
    `;

    return similarChunks.map(c => c.content).join('\n\n');
  } catch (err) {
    console.error(`[Retrieval] Failed to fetch document context: ${err.status || 'Error'} - ${err.message}`);
    return '';
  }
}

async function getContextFromDocumentId(documentId) {
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

async function getDocumentImagesFromDocumentId(documentId) {
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

  if (!doc || doc.status !== 'READY') return [];
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
  if (documentId) {
    return {
      useTeacherKnowledge: true,
      useDatabaseDocs: true,
      requireDocumentContext: true,
      allowGeneralKnowledge: false,
      imageMode: 'document',
    };
  }

  const teacherName = String(teacher?.name || '').trim().toLowerCase();
  const teacherCategory = String(teacher?.category || '').trim().toLowerCase();

  if (teacherName === 'dr. asha verma' || teacherCategory.includes('health')) {
    return {
      useTeacherKnowledge: true,
      useDatabaseDocs: true,
      requireDocumentContext: true,
      allowGeneralKnowledge: false,
      imageMode: 'document',
    };
  }

  if (teacherName === 'prof. sunita rao' || teacherCategory.includes('science')) {
    return {
      useTeacherKnowledge: true,
      useDatabaseDocs: false,
      requireDocumentContext: false,
      allowGeneralKnowledge: true,
      imageMode: 'openai',
    };
  }

  return {
    useTeacherKnowledge: true,
    useDatabaseDocs: true,
    requireDocumentContext: false,
    allowGeneralKnowledge: false,
    imageMode: 'library',
  };
}

async function getRelevantDocumentBundle(topic, { maxDocs = 3, maxChunksPerDoc = 10, maxImages = 10 } = {}) {
  const safeTopic = String(topic || '').trim();
  if (!safeTopic) return { context: '', images: [] };

  let docs = await prisma.document.findMany({
    where: {
      title: { contains: safeTopic, mode: 'insensitive' },
      status: 'READY',
    },
    include: {
      chunks: {
        orderBy: { chunkIndex: 'asc' },
        take: maxChunksPerDoc,
        select: { content: true, metadata: true },
      },
    },
    take: maxDocs,
  });

  if (docs.length === 0) {
    try {
      const embeddingResponse = await client.embeddings.create({
        model: 'text-embedding-3-small',
        input: safeTopic,
      });
      const vector = embeddingResponse.data[0].embedding;
      const vectorString = `[${vector.join(',')}]`;

      const matchingDocs = await prisma.$queryRaw(
        Prisma.sql`
          SELECT dc."document_id" AS "documentId",
                 MIN(dc."embedding" <=> ${vectorString}::vector) AS distance
          FROM "document_chunks" dc
          INNER JOIN "documents" d ON d."id" = dc."document_id"
          WHERE d."status" = 'READY'
            AND dc."embedding" IS NOT NULL
          GROUP BY dc."document_id"
          ORDER BY distance ASC
          LIMIT ${maxDocs}
        `
      );

      const orderedDocIds = (Array.isArray(matchingDocs) ? matchingDocs : [])
        .map((row) => row.documentId)
        .filter(Boolean);

      if (orderedDocIds.length > 0) {
        const fetchedDocs = await prisma.document.findMany({
          where: { id: { in: orderedDocIds } },
          include: {
            chunks: {
              orderBy: { chunkIndex: 'asc' },
              take: maxChunksPerDoc,
              select: { content: true, metadata: true },
            },
          },
        });

        const orderMap = new Map(orderedDocIds.map((id, index) => [id, index]));
        docs = fetchedDocs.sort((a, b) => (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999));
      }
    } catch (err) {
      console.error('[Retrieval] Failed to fetch semantic document bundle:', err.message);
    }
  }

  if (docs.length === 0) return { context: '', images: [] };

  const context = docs
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
    docs.map(async (doc) => getDocumentImagesFromDocumentId(doc.id))
  );
  const images = imageGroups.flat().slice(0, maxImages);

  return { context, images };
}

async function saveGeneratedImage(base64Data, prefix = 'course-image') {
  const outputDir = path.join(process.cwd(), 'public', 'uploads', 'generated-course-images');
  await fs.mkdir(outputDir, { recursive: true });

  const safePrefix = String(prefix || 'course-image')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'course-image';

  const fileName = `${Date.now()}-${safePrefix}-${Math.random().toString(36).slice(2, 8)}.png`;
  const fullPath = path.join(outputDir, fileName);
  await fs.writeFile(fullPath, Buffer.from(base64Data, 'base64'));

  return `/api/v1/uploads/generated-course-images/${fileName}`;
}

async function generateOpenAiImageForSlide(topic, slide, slideIndex) {
  try {
    const prompt = `Create a clean educational science illustration for the topic "${topic}".
Focus on the slide title "${slide.title}".
Visual goals:
- scientifically plausible
- suitable for a learning slide
- no watermarks
- no decorative poster layout
- minimal or no text inside the image
- visually clear and concept-focused`;

    const response = await client.images.generate({
      model: OPENAI_IMAGE_MODEL,
      prompt,
      size: '1024x1024',
    });

    const imageBase64 = response.data?.[0]?.b64_json;
    if (!imageBase64) return null;

    const url = await saveGeneratedImage(imageBase64, `science-slide-${slideIndex + 1}`);
    return {
      id: `openai-science-${slideIndex + 1}`,
      source: 'OPENAI',
      url,
      description: `AI-generated science illustration for ${slide.title}`,
      tags: tokenize(`${topic} ${slide.title}`),
    };
  } catch (err) {
    console.error(`[OpenAI Image] Failed for slide "${slide?.title || slideIndex + 1}":`, err.message);
    return null;
  }
}

async function createCourse(topic, numSlides = 5, teacherId, documentId = null) {
  numSlides = Math.min(Math.max(numSlides, 1), 10);

  let extraContext = '';
  let imageIndex = [];
  let fallbackImageIndex = [];
  let teacher = null;
  let teacherPolicy = resolveTeacherCoursePolicy(null, documentId);
  const strictDocumentOnlyMode = teacherPolicy.requireDocumentContext;
  let systemPersona = 'You are a professional educational content architect. Your purpose is to structure and summarize provided document content into high-quality study materials.';
  let selectedVoiceId = DEFAULT_VOICE_ID;

  if (teacherId) {
    try {
      teacher = await prisma.avatarTeacher.findUnique({
        where: { id: teacherId },
      });

      if (teacher) {
        teacherPolicy = resolveTeacherCoursePolicy(teacher, documentId);
        selectedVoiceId = teacher.voiceId || DEFAULT_VOICE_ID;
        if (teacherPolicy.useTeacherKnowledge) {
          extraContext += `
TEACHER SPECIFIC KNOWLEDGE:
---
${teacher.knowledgeText || ''}
---
Teacher Expertise: ${teacher.topics?.join(', ') || ''}\n`;
        }

        systemPersona = `You are generating content on behalf of ${teacher.name}. Description: ${teacher.description}. 
${teacher.systemPrompt ? `Specific Teacher Instructions: ${teacher.systemPrompt}` : ''}`;
      }
    } catch (err) {
      console.error('Failed to fetch teacher config for content generation:', err);
    }
  }

  const effectiveStrictDocumentMode = Boolean(documentId) || teacherPolicy.requireDocumentContext;

  // ── Step 0: Build context from document(s) ────────────────────────────────
  let docContext = '';
  let documentImages = [];

  if (teacherPolicy.useDatabaseDocs) {
    if (documentId) {
      docContext = await getContextFromDocumentId(documentId);
      documentImages = await getDocumentImagesFromDocumentId(documentId);
    } else if (teacherPolicy.requireDocumentContext) {
      const bundle = await getRelevantDocumentBundle(topic);
      docContext = bundle.context;
      documentImages = bundle.images;
    } else {
      docContext = await getContextFromDocuments(topic);
    }
  }

  if (teacherPolicy.requireDocumentContext && !docContext) {
    throw new Error(`No relevant document data found for "${topic}" for ${teacher?.name || 'the selected teacher'}.`);
  }

  if (docContext) {
    extraContext += `
SOURCE MATERIAL FROM DATABASE DOCUMENTS:
---
${docContext}
---
INSTRUCTION: ${teacherPolicy.allowGeneralKnowledge
  ? 'Use the source material when it helps, but you may also use your own knowledge.'
  : 'Strictly use ONLY the provided "SOURCE MATERIAL" for factual content. Do NOT supplement with any external knowledge.'}
`;
  }

  // ── Step 0.5: Fetch Relevant Images from Library ────────────────────────
  if (teacherPolicy.imageMode === 'library') {
    try {
      const images = await fetchAllImages();
      imageIndex = buildImageIndex(images);
      // Filter images that match the topic in description or tags
      const topicLower = (topic || '').toLowerCase();
      const relevantImages = images.filter((img) => {
        const desc = (img.description || '').toLowerCase();
        const tags = Array.isArray(img.tags)
          ? img.tags.join(' ').toLowerCase()
          : (typeof img.tags === 'string' ? img.tags.toLowerCase() : '');
        return desc.includes(topicLower) || tags.includes(topicLower);
      }).slice(0, 10); // Provide a slightly larger pool for the AI to choose from

      if (relevantImages.length > 0) {
        extraContext += `
AVAILABLE VISUAL ASSETS:
---
${relevantImages.map(img => `- URL: ${img.url} | Description: ${img.description}`).join('\n')}
---
`;
      }
    } catch (err) {
      console.error('[Image Retrieval] Failed:', err.message);
    }
  } else if (teacherPolicy.imageMode === 'document') {
    imageIndex = buildImageIndex(documentImages);

    if (documentImages.length > 0) {
      extraContext += `
AVAILABLE VISUAL ASSETS:
---
${documentImages.map((img) => `- URL: ${img.url} | Description: ${img.description}`).join('\n')}
---
`;
    }

    if (imageIndex.length === 0) {
      try {
        const uploadedImages = await fetchAllImages();
        fallbackImageIndex = buildImageIndex(uploadedImages);
        const topicLower = (topic || '').toLowerCase();
        const relevantFallbackImages = uploadedImages.filter((img) => {
          const desc = (img.description || '').toLowerCase();
          const tags = Array.isArray(img.tags)
            ? img.tags.join(' ').toLowerCase()
            : (typeof img.tags === 'string' ? img.tags.toLowerCase() : '');
          return desc.includes(topicLower) || tags.includes(topicLower);
        }).slice(0, 10);

        if (relevantFallbackImages.length > 0) {
          extraContext += `
FALLBACK VISUAL ASSETS:
---
${relevantFallbackImages.map((img) => `- URL: ${img.url} | Description: ${img.description}`).join('\n')}
---
`;
        }
      } catch (err) {
        console.error('[Fallback Image Retrieval] Failed:', err.message);
      }
    }
  }

  const userPrompt = `Create an elite-level study course on the topic: '${topic}'. The course must consist of exactly ${numSlides} slides.

${teacherPolicy.allowGeneralKnowledge
  ? 'Use your own expertise to produce accurate, clear educational content. If teacher guidance is provided, align with it.'
  : 'STRICT LIMITATION: All factual content, theories, and examples MUST be derived SOLELY from the "SOURCE MATERIAL" provided below. Do NOT use your own training data to add information.'}

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
${teacherPolicy.allowGeneralKnowledge ? '4a. If no source material is provided, explain accurately using your own knowledge.' : ''}
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
    if (teacherPolicy.imageMode === 'openai') {
      const generatedImages = await Promise.all(
        result.slides.map((slide, index) => generateOpenAiImageForSlide(topic, slide, index))
      );

      result.slides = result.slides.map((slide, index) => {
        const image = generatedImages[index];
        const contentWithoutImages = removeAllSlideImages(slide.content);
        if (!image) return { ...slide, content: contentWithoutImages };
        return {
          ...slide,
          content: insertImageAtPosition(contentWithoutImages, image, null),
        };
      });
    } else if (imageIndex.length > 0 || fallbackImageIndex.length > 0) {
      const effectiveImageIndex = imageIndex.length > 0 ? imageIndex : fallbackImageIndex;
      const usedImageIds = new Set();
      const usedImageUrls = new Set();
      const topicTokens = tokenize(topic);
      const allowedUrls = new Set(effectiveImageIndex.map((img) => img.url));
      const urlToImage = new Map(effectiveImageIndex.map((img) => [img.url, img]));
      const updatedSlides = [];

      for (const slide of result.slides) {
        const normalizedContent = normalizeAllowedLinksToImages(slide.content, allowedUrls);
        const sanitized = sanitizeSlideImages(normalizedContent, allowedUrls);
        const existingAllowed = [...new Set(sanitized.allowedUrls || [])];
        const approvedExisting = [];

        for (const url of existingAllowed) {
          if (usedImageUrls.has(url)) continue;
          if (approvedExisting.length >= 2) break;
          approvedExisting.push(url);
          usedImageUrls.add(url);
          const img = urlToImage.get(url);
          if (img?.id) usedImageIds.add(img.id);
        }

        const needAdditional = approvedExisting.length < 2;
        const slideText = cleanTextForEmbedding(`${slide.title} ${sanitized.content} ${topic}`);
        let selectedImages = [];

        // Prefer vector similarity when embeddings exist
        const vectorCandidates = effectiveStrictDocumentMode
          ? []
          : await findBestImageCandidatesByVector(slideText, 5);
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

          for (const img of effectiveImageIndex) {
            const score = scoreImageForSlide(img, slideTokens);
            if (score > bestScore || (score === bestScore && !usedImageIds.has(img.id))) {
              keywordBest = img;
              bestScore = score;
            }
          }

          if (!keywordBest || bestScore === 0) {
            let topicBest = null;
            let topicBestScore = -1;
            for (const img of effectiveImageIndex) {
              const score = scoreImageForSlide(img, topicTokens);
              if (score > topicBestScore || (score === topicBestScore && !usedImageIds.has(img.id))) {
                topicBest = img;
                topicBestScore = score;
              }
            }
            keywordBest = topicBest || keywordBest;
          }

          if (keywordBest && !approvedExisting.includes(keywordBest.url) && !usedImageUrls.has(keywordBest.url)) {
            selectedImages.push(keywordBest);
            usedImageIds.add(keywordBest.id);
            usedImageUrls.add(keywordBest.url);
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
    return { success: false, error: err.message || 'Unknown error occurred', id: '', title: '', slides: [] };
  }
}

// ─── Exported Service Functions ───────────────────────────────────────────────

export async function generateCourse(topic, numSlides = 5, teacherId, documentId = null) {
  try {
    console.log(`Generating course for topic: '${topic}' from teacher: ${teacherId || 'None'} with ${numSlides} slides. documentId=${documentId || 'None'}`);
    const courseResponse = await createCourse(topic, numSlides, teacherId, documentId);
    if (!courseResponse.success) throw new Error(courseResponse.error || 'Course generation failed');
    console.log(`Course saved with ID: ${courseResponse.id}`);
    return courseResponse.id;
  } catch (err) {
    console.error('Error in generateCourse:', err);
    return null;
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
