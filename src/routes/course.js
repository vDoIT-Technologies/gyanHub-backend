import { Hono } from 'hono';
import {
  generateCourse,
  fetchCourse,
  fetchAllCoursesMetadata,
  deleteCourseById,
} from '../services/courseService.js';

const app = new Hono();

// GET /courses/?course_id=<id>  — fetch a single course
app.get('/', async (c) => {
  const courseId = c.req.query('course_id');
  if (!courseId) {
    return c.json({ error: 'course_id query parameter is required' }, 400);
  }

  const course = await fetchCourse(courseId);
  if (!course) {
    return c.json({ error: 'Course not found' }, 404);
  }

  return c.json(course);
});

// GET /courses/all — list all courses (metadata)
app.get('/all', async (c) => {
  const courses = await fetchAllCoursesMetadata();
  return c.json(courses);
});

// POST /courses/ — generate a new course
app.post('/', async (c) => {
  const { topic, num_slides = 5, teacherId, document_id, documentId } = await c.req.json();

  if (!topic) {
    return c.json({ error: 'topic is required' }, 400);
  }

  const selectedDocumentId =
    typeof document_id === 'string' && document_id.trim()
      ? document_id.trim()
      : (typeof documentId === 'string' && documentId.trim() ? documentId.trim() : null);

  const courseId = await generateCourse(topic, Number(num_slides), teacherId, selectedDocumentId);
  if (!courseId) {
    return c.json({ error: 'Failed to generate course' }, 500);
  }

  return c.json({ course_id: courseId }, 201);
});

// DELETE /courses/:id — delete a course and all associated slides
app.delete('/:id', async (c) => {
  const courseId = c.req.param('id');
  if (!courseId) {
    return c.json({ error: 'course id is required' }, 400);
  }

  const result = await deleteCourseById(courseId);
  if (!result.success) {
    if (result.notFound) {
      return c.json({ error: result.error || 'Course not found' }, 404);
    }
    return c.json({ error: result.error || 'Failed to delete course' }, 500);
  }

  return c.json({ success: true, deleted_course_id: courseId, deleted_at: result.deletedAt || null }, 200);
});

export default app;
