import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/**
 * Seeds the admin user with predefined credentials.
 */
async function seedAdmin() {
  const hashedPassword = await bcrypt.hash('Secret@1234', 10);
  const admin = await prisma.admin.create({
    data: {
      email: 'admin@yopmail.com',
      name: 'Sentience Admin',
      password: hashedPassword,
    },
  });

  console.log('Admin seeded:', admin);
}

seedAdmin()
  .catch((e) => {
    console.error('Error seeding admin:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
