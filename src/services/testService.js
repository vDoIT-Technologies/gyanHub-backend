import { OpenAI } from 'openai';
import { ENV } from '../configs/constant.js';
import prisma from '../lib/prisma.js';

const client = new OpenAI({ apiKey: ENV.OPENAI_API_KEY });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDifficultyInstruction(difficulty) {
  switch (difficulty) {
    case 'Easy':
      return 'Focus on basic retrieval of facts, definitions, and simple concepts. Questions should be short, direct, and unambiguous.';
    case 'Medium':
      return "Focus on application and deeper understanding. Questions should provide context or a short scenario (2-3 sentences). Avoid simple recall; ask 'why', 'how', or 'what is the implication'.";
    case 'Hard':
      return 'Focus on analysis, synthesis, and evaluation. Questions should be complex, involving longer scenarios or requiring connection of multiple concepts. Distractors should be plausible and require critical thinking to rule out.';
    default:
      return 'Ensure questions are appropriate for the requested difficulty level.';
  }
}

const quizJsonSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              properties: { text: { type: 'string' } },
              required: ['text'],
              additionalProperties: false,
            },
          },
          correct_option_indices: {
            type: 'array',
            items: { type: 'number' },
          },
          explanation: { type: 'string' },
        },
        required: ['question', 'options', 'correct_option_indices', 'explanation'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'questions'],
  additionalProperties: false,
};

async function processAndSave(result, difficulty) {
  return prisma.$transaction(async (tx) => {
    const test = await tx.test.create({
      data: {
        title: result.title,
        difficulty,
        questions: {
          create: result.questions.map((q) => ({
            question: q.question,
            explanation: q.explanation,
            options: {
              create: q.options.map((opt, idx) => ({
                text: opt.text,
                isCorrect: q.correct_option_indices.includes(idx),
              })),
            },
          })),
        },
      },
    });

    return test.id;
  });
}

async function buildTestResponse(testId) {
  const test = await prisma.test.findUnique({
    where: { id: testId },
    include: {
      questions: {
        include: { options: true },
      },
    },
  });

  if (!test) return null;

  const questions = test.questions.map((q) => ({
    id: q.id,
    question: q.question,
    options: q.options.map((o) => ({ id: o.id, text: o.text })),
    correct_ids: q.options.filter((o) => o.isCorrect).map((o) => o.id),
    explanation: q.explanation,
  }));

  return {
    success: true,
    id: test.id,
    title: test.title,
    difficulty: test.difficulty,
    test: questions,
  };
}

// ─── LLM Generation ───────────────────────────────────────────────────────────

async function createTest(topic, difficulty = 'Medium', numQuestions = 10) {
  numQuestions = Math.min(Math.max(numQuestions, 1), 20);

  const instructions = getDifficultyInstruction(difficulty);
  const systemPrompt = `You are an expert quiz generator.
Create a ${difficulty} level quiz with ${numQuestions} questions on the topic: "${topic}".

Instructions:
- Provide a suitable, generated title for the quiz.
- Provide 4 options per question.
- Provide a clear explanation.
- Accurately mark the index of the correct option(s).
- ${instructions}`;

  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Generate the quiz data now.' },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'LLMQuizRequest', strict: true, schema: quizJsonSchema },
    },
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error('Empty response from LLM');

  const result = JSON.parse(raw);
  return processAndSave(result, difficulty);
}

async function createTestFromContent(content, difficulty = 'Medium', numQuestions = 10) {
  numQuestions = Math.min(Math.max(numQuestions, 1), 50);

  const CHUNK_SIZE = 12000;
  const CHUNK_OVERLAP = 500;
  const chunks = [];

  let start = 0;
  while (start < content.length) {
    chunks.push(content.slice(start, Math.min(start + CHUNK_SIZE, content.length)));
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }

  const questionsPerChunk = new Array(chunks.length).fill(0);
  for (let i = 0; i < numQuestions; i++) {
    questionsPerChunk[i % chunks.length] += 1;
  }

  const instructions = getDifficultyInstruction(difficulty);
  const systemPrompt = `You are an expert quiz generator.
Create a ${difficulty} level quiz with {n} questions based strictly on the provided text content segment.

Instructions:
- Provide a suitable, generated title for the quiz (only if this is the first segment, otherwise ignore title).
- Provide 4 options per question.
- Provide a clear explanation.
- Accurately mark the index of the correct option(s).
- ${instructions}
- **CRITICAL**: Do NOT refer to "the text", "the article", "the chapter", "the book", or "the author" in questions or options.
- Ask questions directly about the concepts, facts, and theories as if they are general knowledge.`;

  let finalQuestions = [];
  let finalTitle = '';

  for (let i = 0; i < chunks.length; i++) {
    const n = questionsPerChunk[i];
    if (n === 0) continue;

    try {
      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt.replace('{n}', String(n)) },
          { role: 'user', content: `Content Segment:\n${chunks[i]}\n\nGenerate ${n} questions now.` },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'LLMQuizRequest', strict: true, schema: quizJsonSchema },
        },
      });

      const raw = completion.choices[0]?.message?.content;
      if (!raw) continue;

      const res = JSON.parse(raw);
      finalQuestions = finalQuestions.concat(res.questions);
      if (!finalTitle && res.title) finalTitle = res.title;
    } catch (err) {
      console.error(`Error processing chunk ${i}:`, err);
    }
  }

  if (!finalTitle) finalTitle = `${difficulty} Quiz from Document`;

  return processAndSave({ title: finalTitle, questions: finalQuestions }, difficulty);
}

// ─── Exported Service Functions ───────────────────────────────────────────────

export async function generateTest(topic, difficulty = 'Medium', numQuestions = 10) {
  try {
    console.log(`Generating quiz: topic='${topic}', difficulty='${difficulty}', questions=${numQuestions}`);
    const testId = await createTest(topic, difficulty, numQuestions);
    console.log(`Quiz saved with ID: ${testId}`);
    return testId;
  } catch (err) {
    console.error('Error in generateTest:', err);
    return null;
  }
}

export async function generateTestFromContent(content, difficulty = 'Medium', numQuestions = 10) {
  try {
    console.log(`Generating quiz from content, difficulty='${difficulty}', questions=${numQuestions}`);
    const testId = await createTestFromContent(content, difficulty, numQuestions);
    console.log(`Quiz from content saved with ID: ${testId}`);
    return testId;
  } catch (err) {
    console.error('Error in generateTestFromContent:', err);
    return null;
  }
}

export async function fetchTest(testId) {
  return buildTestResponse(testId);
}

export async function fetchAllTestsMetadata() {
  const tests = await prisma.test.findMany({
    orderBy: { createdAt: 'desc' },
    select: { id: true, title: true, difficulty: true, createdAt: true },
  });

  return tests.map((t) => ({
    id: t.id,
    title: t.title,
    difficulty: t.difficulty,
    created_at: t.createdAt.toISOString(),
  }));
}