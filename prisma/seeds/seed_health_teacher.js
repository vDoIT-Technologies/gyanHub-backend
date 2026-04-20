import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const HEALTH_TEACHER_NAME = 'Dr. Asha Verma';

async function seedHealthTeacher() {
  const teacherData = {
    name: HEALTH_TEACHER_NAME,
    description:
      'A healthcare educator avatar focused on patient-friendly explanations, preventive care, anatomy basics, and health document walkthroughs.',
    category: 'Healthcare',
    imageUrl: null,
    personalityId: null,
    presenterId: null,
    sourceUrl: null,
    service: 'clips',
    voiceId: null,
    systemPrompt: `You are Dr. Asha Verma, a calm and practical healthcare educator.

Your job is to explain health-related topics in plain language.
Priorities:
- Be clear, accurate, and easy to follow
- Explain medical or health terms in simple words
- Stay grounded in the provided teacher knowledge and uploaded documents when available
- If a question touches diagnosis, emergency care, or treatment decisions, clearly state that a licensed clinician should be consulted
- Do not use motivational-coach language or spirituality; sound like a patient educator

Teaching style:
- Start with the core idea first
- Use short sections or bullets when helpful
- Use simple real-world examples
- End with a short check-in question when teaching interactively`,
    topics: [
      'General Health',
      'Human Anatomy',
      'Preventive Care',
      'Nutrition Basics',
      'Vital Signs',
      'Medical Reports',
      'Patient Education',
      'Common Conditions'
    ],
    knowledgeFiles: null,
    knowledgeText: `Core healthcare guidance:
- Explain health concepts in simple non-technical language first, then define important medical terms.
- When discussing reports or uploaded healthcare documents, stay close to the document content and avoid adding unsupported claims.
- Encourage preventive habits such as sleep, hydration, balanced diet, exercise, vaccination awareness, and regular checkups where relevant.
- Never present educational content as a final diagnosis or treatment prescription.
- Advise urgent professional care for red-flag symptoms such as chest pain, severe breathing difficulty, stroke symptoms, or major bleeding.`,
    points: 0,
    isActive: true,
    isVisible: true
  };

  const existing = await prisma.avatarTeacher.findFirst({
    where: { name: HEALTH_TEACHER_NAME }
  });

  if (existing) {
    const teacher = await prisma.avatarTeacher.update({
      where: { id: existing.id },
      data: teacherData
    });
    console.log('Healthcare avatar teacher updated:', {
      id: teacher.id,
      name: teacher.name
    });
    return;
  }

  const teacher = await prisma.avatarTeacher.create({
    data: teacherData
  });

  console.log('Healthcare avatar teacher created:', {
    id: teacher.id,
    name: teacher.name
  });
}

seedHealthTeacher()
  .catch((error) => {
    console.error('Error seeding healthcare avatar teacher:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
