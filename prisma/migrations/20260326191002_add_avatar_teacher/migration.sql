-- CreateTable
CREATE TABLE "AvatarTeacher" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "presenterId" TEXT,
    "sourceUrl" TEXT,
    "service" TEXT NOT NULL DEFAULT 'clips',
    "voiceId" TEXT,
    "systemPrompt" TEXT,
    "topics" TEXT[],
    "points" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "knowledgeFiles" JSONB,
    "category" TEXT,
    "personalityId" TEXT,
    "knowledgeText" TEXT,

    CONSTRAINT "AvatarTeacher_pkey" PRIMARY KEY ("id")
);
