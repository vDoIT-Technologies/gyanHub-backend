import { Hono } from 'hono';
import {
  generateTest,
  generateTestFromContent,
  fetchTest,
  fetchAllTestsMetadata,
} from '../services/testService.js';

const app = new Hono();

// GET /tests/?test_id=<id>  — fetch a single test
app.get('/', async (c) => {
  const testId = c.req.query('test_id');
  if (!testId) {
    return c.json({ error: 'test_id query parameter is required' }, 400);
  }

  const test = await fetchTest(testId);
  if (!test) {
    return c.json({ error: 'Test not found' }, 404);
  }

  return c.json(test);
});

// GET /tests/all — list all tests (metadata)
app.get('/all', async (c) => {
  const tests = await fetchAllTestsMetadata();
  return c.json(tests);
});

// POST /tests/ — generate a new test from topic
app.post('/', async (c) => {
  const { topic, num_questions = 10, difficulty = 'Medium' } = await c.req.json();

  if (!topic) {
    return c.json({ error: 'topic is required' }, 400);
  }

  const testId = await generateTest(topic, difficulty, Number(num_questions));
  if (!testId) {
    return c.json({ error: 'Failed to generate test' }, 500);
  }

  return c.json({ test_id: testId }, 201);
});

// POST /tests/upload-pdf — generate a test from an uploaded PDF
app.post('/upload-pdf', async (c) => {
  const formData = await c.req.formData();

  const file = formData.get('file');
  if (!file || !(file instanceof File)) {
    return c.json({ error: 'A PDF file is required' }, 400);
  }

  if (file.type !== 'application/pdf') {
    return c.json({ error: 'Only PDF files are allowed' }, 400);
  }

  const difficulty = formData.get('difficulty') ?? 'Medium';
  const numQuestions = Number(formData.get('num_questions') ?? 10);

  const { default: pdfParse } = await import('pdf-parse');
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const pdfData = await pdfParse(buffer);
  const content = pdfData.text;

  if (!content || content.trim().length === 0) {
    return c.json({ error: 'Could not extract text from PDF' }, 400);
  }

  const testId = await generateTestFromContent(content, difficulty, numQuestions);
  if (!testId) {
    return c.json({ error: 'Failed to generate test from PDF' }, 500);
  }

  return c.json({ test_id: testId }, 201);
});

export default app;