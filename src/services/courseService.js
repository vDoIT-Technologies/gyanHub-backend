import { Prisma } from '@prisma/client';
import { OpenAI } from 'openai';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { ENV } from '../configs/constant.js';
import prisma from '../lib/prisma.js';
import { fetchAllImages } from './imageLibraryService.js';

const client = new OpenAI({ apiKey: ENV.OPENAI_API_KEY });
const elevenlabs = new ElevenLabsClient({ apiKey: ENV.ELEVENLABS_API_KEY });

const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
const IMAGE_MARKDOWN_RE = /!\[.*?\]\(.*?\)/g;
const IMAGE_MARKDOWN_TEST_RE = /!\[.*?\]\(.*?\)/;
const IMAGE_MARKDOWN_URL_RE = /!\[[^\]]*]\(([^)]+)\)/g;
const IMAGE_DISTANCE_THRESHOLD = 0.45;
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
    return { ...img, _tokenSet: tokenSet };
  });
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
  const alt = image.description || 'Related image';
  return `${content}\n\n![${alt}](${image.url})`;
}

function insertImageAtPosition(content, image, positionIndex = null) {
  const alt = image.description || 'Related image';
  const imageMarkdown = `![${alt}](${image.url})`;

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
    console.error('[Retrieval] Failed to fetch document context:', err.message);
    return '';
  }
}

async function createCourse(topic, numSlides = 5, teacherId) {
  numSlides = Math.min(Math.max(numSlides, 1), 10);

  let extraContext = '';
  let imageIndex = [];
  let systemPersona = 'You are a professional educational content architect and expert researcher. Your purpose is to create high-quality, in-depth study materials for students. Each slide must be informative, pedagogically sound, and contain sufficient detail for a learner to actually master the concepts presented. Use a professional, academic, yet engaging tone.';
  let selectedVoiceId = DEFAULT_VOICE_ID;

  if (teacherId) {
    try {
      const teacher = await prisma.avatarTeacher.findUnique({
        where: { id: teacherId },
      });

      if (teacher) {
        selectedVoiceId = teacher.voiceId || DEFAULT_VOICE_ID;
        extraContext += `
TEACHER SPECIFIC KNOWLEDGE:
---
${teacher.knowledgeText || ''}
---
Teacher Expertise: ${teacher.topics?.join(', ') || ''}\n`;

        systemPersona = `You are generating content on behalf of ${teacher.name}. Description: ${teacher.description}. 
${teacher.systemPrompt ? `Specific Teacher Instructions: ${teacher.systemPrompt}` : ''}`;
      }
    } catch (err) {
      console.error('Failed to fetch teacher config for content generation:', err);
    }
  }

  // ── Step 0: Search Database Documents (RAG) ───────────────────────────────
  const docContext = await getContextFromDocuments(topic);
  if (docContext) {
    extraContext += `
SOURCE MATERIAL FROM DATABASE DOCUMENTS:
---
${docContext}
---
INSTRUCTION: Prioritize the "SOURCE MATERIAL" above for factual content. If the material is insufficient, supplement it with your general knowledge.
`;
  }

  // ── Step 0.5: Fetch Relevant Images from Library ────────────────────────
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

  const userPrompt = `Create an elite-level study course on the topic: '${topic}'. The course must consist of exactly ${numSlides} slides.
${extraContext}

For EACH slide, the 'content' field must follow these rules:
1. Provide a clear, descriptive slide title (without slide numbers).
2. The content must be detailed and substantial (at least 150-250 words per slide).
3. Use Markdown formatting to structure the content, including:
   - A detailed heading or summary of the concept.
   - Bullet points for core mechanisms, principles, or theories.
   - A section for a practical 'Real-World Example' or illustrative scenario.
   - A 'Key Study Takeaway' at the end of the content.
4. Focus on deep understanding (the "how" and "why"), not just high-level definitions.
5. Content should progress logically from foundations to complex applications across the slides.
6. If any "AVAILABLE VISUAL ASSETS" are highly relevant to a slide's concept, embed them using standard Markdown: ![Description](URL).
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
    if (imageIndex.length > 0) {
      const usedImageIds = new Set();
      const topicTokens = tokenize(topic);
      const allowedUrls = new Set(imageIndex.map((img) => img.url));
      const urlToImage = new Map(imageIndex.map((img) => [img.url, img]));
      const updatedSlides = [];

      for (const slide of result.slides) {
        const sanitized = sanitizeSlideImages(slide.content, allowedUrls);
        const existingAllowed = new Set(sanitized.allowedUrls || []);
        const needAdditional = existingAllowed.size < 2;
        for (const url of existingAllowed) {
          const img = urlToImage.get(url);
          if (img?.id) usedImageIds.add(img.id);
        }

        const slideText = cleanTextForEmbedding(`${slide.title} ${sanitized.content} ${topic}`);
        let selectedImages = [];

        // Prefer vector similarity when embeddings exist
        const vectorCandidates = await findBestImageCandidatesByVector(slideText, 5);
        const vectorMatches = vectorCandidates
          .filter((c) => Number(c?.distance) <= IMAGE_DISTANCE_THRESHOLD)
          .filter((c) => !existingAllowed.has(c.url));

        if (vectorMatches.length > 0) {
          for (const candidate of vectorMatches) {
            if (selectedImages.length >= (needAdditional ? (2 - existingAllowed.size) : 0)) break;
            if (usedImageIds.has(candidate.id)) continue;
            selectedImages.push(candidate);
            usedImageIds.add(candidate.id);
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
            keywordBest = topicBest || keywordBest;
          }

          if (keywordBest && !existingAllowed.has(keywordBest.url)) {
            selectedImages.push(keywordBest);
            usedImageIds.add(keywordBest.id);
          }
        }

        let content = sanitized.content;

        if (sanitized.hasAllowedImage) {
          content = sanitized.content;
        }

        if (selectedImages.length > 0) {
          // Insert first image in the middle; second (if any) near the end.
          content = insertImageAtPosition(content, selectedImages[0], null);
          if (selectedImages.length > 1) {
            content = insertImageAtPosition(content, selectedImages[1], Math.max(0, content.split(/\n{2,}/).length - 1));
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
        content: s.content,
        audioBase64: s.audioBase64 ?? null, // frontend uses this to play audio
      })),
    };
  } catch (err) {
    console.error('Error in createCourse:', err);
    return { success: false, id: '', title: '', slides: [] };
  }
}

// ─── Exported Service Functions ───────────────────────────────────────────────

export async function generateCourse(topic, numSlides = 5, teacherId) {
  try {
    console.log(`Generating course for topic: '${topic}' from teacher: ${teacherId || 'None'} with ${numSlides} slides.`);
    const courseResponse = await createCourse(topic, numSlides, teacherId);
    if (!courseResponse.success) throw new Error('Course generation failed');
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
      content: s.content,
      audioBase64: s.audioBase64 ?? null, // included on fetch too
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
