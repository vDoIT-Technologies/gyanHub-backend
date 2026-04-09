import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanupOldData() {
  try {
    console.log('🧹 Starting cleanup...');

    // ─── COURSES: Keep latest 2 ─────────────────────────────
    const latestCourses = await prisma.course.findMany({
      orderBy: { createdAt: 'desc' },
      take: 2,
      select: { id: true },
    });

    const latestCourseIds = latestCourses.map(c => c.id);

    const deletedCourses = await prisma.course.deleteMany({
      where: {
        id: { notIn: latestCourseIds },
      },
    });

    console.log(`✅ Deleted ${deletedCourses.count} old courses`);

    // ─── TESTS (QUIZZES): Keep latest 2 ─────────────────────
    const latestTests = await prisma.test.findMany({
      orderBy: { createdAt: 'desc' },
      take: 2,
      select: { id: true },
    });

    const latestTestIds = latestTests.map(t => t.id);

    const deletedTests = await prisma.test.deleteMany({
      where: {
        id: { notIn: latestTestIds },
      },
    });

    console.log(`✅ Deleted ${deletedTests.count} old tests`);

    console.log('🎉 Cleanup complete!');
  } catch (err) {
    console.error('❌ Cleanup failed:', err);
  } finally {
    await prisma.$disconnect();
  }
}

cleanupOldData();