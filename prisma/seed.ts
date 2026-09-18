import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "change-me";
  const name = process.env.SEED_ADMIN_NAME ?? "מנהל/ת";

  const passwordHash = await bcrypt.hash(password, 10);

  // The seeded account is the first admin. Without one nobody could delete an
  // event or promote anyone else, so seeding a plain staff user would lock the
  // system's admin operations out entirely.
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, name, role: "admin" },
    create: { email, name, role: "admin", passwordHash },
  });
  console.log(`✓ Admin user ready: ${user.email}`);

  // Demo group + participants so the UI has something to show on first run.
  // Safe to delete once real data is entered.
  const existing = await prisma.group.findFirst();
  if (!existing) {
    const group = await prisma.group.create({
      data: {
        name: "קבוצת דוגמה",
        participants: {
          create: [{ name: "משתתף/ת א'" }, { name: "משתתף/ת ב'" }],
        },
      },
    });
    console.log(`✓ Demo group created: ${group.name}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
