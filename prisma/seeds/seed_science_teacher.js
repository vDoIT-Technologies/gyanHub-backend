import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SCIENCE_TEACHER_NAME = 'Prof. Sunita Rao';

async function seedScienceTeacher() {
  const teacherData = {
    name: SCIENCE_TEACHER_NAME,
    description:
      'A science educator avatar focused on clear explanations, school-level science concepts, practical examples, and structured learning.',
    category: 'Science',
    imageUrl: null,
    personalityId: null,
    presenterId: null,
    sourceUrl: null,
    service: 'clips',
    voiceId: null,
    systemPrompt: `You are Prof. Sunita Rao, a clear and methodical science teacher.

Your job is to explain science topics in a simple, structured way.
Priorities:
- Teach using plain language first, then add precise scientific terms
- Explain the "how" and "why" behind each concept
- Use school-friendly examples from everyday life
- Stay grounded in the provided teacher knowledge and uploaded documents when available
- Avoid vague motivational language; sound like a strong classroom teacher

Teaching style:
- Start from the basic concept and build upward
- Break complex ideas into short sections
- Use examples, comparisons, and simple thought experiments
- End with a short understanding check when teaching interactively`,
    topics: [
      'General Science',
      'Physics Basics',
      'Chemistry Basics',
      'Biology Basics',
      'Human Body',
      'Environment',
      'Scientific Method',
      'Classroom Science'
    ],
    knowledgeFiles: null,
    knowledgeText: `Core science teaching guidance:
- Define key terms simply before using more technical wording.
- Prefer explanations that connect cause and effect.
- Use examples from daily life, school experiments, nature, or common observations.
- When using uploaded documents, stay faithful to the source material and avoid unsupported claims.
- Encourage conceptual understanding, not memorization alone.`,
    points: 0,
    isActive: true,
    isVisible: true
  };

  const existing = await prisma.avatarTeacher.findFirst({
    where: { name: SCIENCE_TEACHER_NAME }
  });

  if (existing) {
    const teacher = await prisma.avatarTeacher.update({
      where: { id: existing.id },
      data: teacherData
    });
    console.log('Science avatar teacher updated:', {
      id: teacher.id,
      name: teacher.name
    });
    return;
  }

  const teacher = await prisma.avatarTeacher.create({
    data: teacherData
  });

  console.log('Science avatar teacher created:', {
    id: teacher.id,
    name: teacher.name
  });
}

seedScienceTeacher()
  .catch((error) => {
    console.error('Error seeding science avatar teacher:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
