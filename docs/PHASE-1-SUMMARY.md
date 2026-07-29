# מערכת נוכחות מעלה גמלא — סיכום שלב 1 (להעברה לקלוד)

מסמך הקשר להמשך פיתוח. מסכם מה נבנה, החלטות טכניות, מבנה, ומצב הפריסה.

## מה זה
מערכת ניהול לחינוך הבלתי פורמלי במושב מעלה גמלא. שלב 1 = **סימון נוכחות** בלבד,
אבל בנוי כך שיתמוך בהמשך ב: סידור עבודה, סידור לוז פעילויות, הכנת פעילויות בעזרת AI,
חלוקה לקבוצות, מעקב שעות עבודה — בלי שכתוב.

## Stack
- Next.js 14.2 (App Router, TypeScript) — `src/` directory
- Prisma ORM 5.22 + PostgreSQL (Neon)
- Auth.js (NextAuth v5 beta) — Credentials (email + password), JWT session
- Tailwind CSS
- ממשק עברית מלא, RTL (`<html dir="rtl">`), mobile-first
- פריסה: Vercel

## מה נבנה (שלב 1)
- **`/login`** — התחברות email + סיסמה. bcrypt, JWT. אין מסך הרשמה (משתמשים
  מתווספים ידנית).
- **`/attendance`** — בחירת תאריך (ברירת מחדל היום), תצוגה לפי קבוצות, כפתור
  "סמן הכל נוכח" לכל קבוצה, סטטוס פרטני נוכח/איחור/נעדר לכל משתתף. שמירה מיידית
  ל-DB בכל שינוי (optimistic UI) עם `markedByUserId`. באדג' כיתה ליד השם, zebra striping.
- **`/roster`** — ניהול קבוצות ומשתתפים: הוספה/מחיקה, שדה כיתה (הוספה + עריכה inline).
- **`/history`** — סיכום נוכחים/איחורים/נעדרים לפי תאריך (30 ימים אחרונים), groupBy.
- **API routes** תחת `/api/*`, כולם מוגנים ב-session (`requireSession`):
  - `GET/POST /api/groups`, `PATCH/DELETE /api/groups/[id]`
  - `POST /api/participants` (name, grade, groupId), `PATCH/DELETE /api/participants/[id]`
  - `GET /api/attendance?date=`, `POST /api/attendance` (upsert יחיד),
    `POST /api/attendance/bulk` (קבוצה שלמה)
- הגנת דפים ב-`src/middleware.ts` (redirect ל-`/login`). Split-config של Auth.js
  כדי ש-middleware יישאר Edge-safe (`auth.config.ts` בלי Prisma/bcrypt; `auth.ts` עם).

## מבנה קבצים עיקרי
```
prisma/schema.prisma          # מודל הנתונים
prisma/migrations/            # 0_init, 20260729144334_add_participant_grade
prisma/seed.ts                # יצירת משתמש staff ראשון + קבוצת דוגמה
src/auth.ts / src/auth.config.ts   # הגדרת Auth.js (split config)
src/middleware.ts             # הגנת ראוטים
src/lib/prisma.ts             # PrismaClient singleton
src/lib/attendance.ts         # STATUSES, לוגיקת תאריך (date-only ב-UTC)
src/lib/api-auth.ts           # requireSession() ל-API
src/app/{attendance,roster,history,login}/page.tsx
src/components/{AttendanceBoard,RosterManager,AppHeader,LoginForm,SignOutButton}.tsx
```

## מודל הנתונים (Prisma)
- **User**: id (cuid), email (unique), name, role (String, default `"staff"`),
  `passwordHash String?`, attendance[], createdAt.
- **Group**: id, name, participants[], createdAt.
- **Participant**: id, name, `grade String?` (כיתה), groupId→Group (onDelete Cascade),
  attendance[], createdAt.
- **AttendanceRecord**: id, `date @db.Date`, status (`present|late|absent`),
  participantId→Participant (Cascade), `markedByUserId String?`→User (SetNull),
  createdAt, updatedAt, `@@unique([date, participantId])`.

### החלטות שסטו מהבריף המקורי
1. **סיסמה במקום magic link** — פשוט יותר לפרוס (בלי SMTP). לכן נוסף `passwordHash`
   ל-User (לא היה בבריף).
2. **`role` נשאר String** (`"staff"`) — הרחבה ל-`"parent"` בעתיד בלי שינוי מבני,
   ובלי קשירת הרשאות קשיחה ל-staff בקוד (הדלת להורים פתוחה כפי שהבריף ביקש).
3. **`grade`** — נוסף ב-Participant אחרי שלב 1 לבקשת המשתמש (כיתה לכל ילד).

## פריסה — מצב נוכחי
- **Repo:** `github.com/Shahar-Werbner/Bilto-formali-maale-gamla` (public), branch `main`.
  זהו ריפו עצמאי — האפליקציה בשורש (אין Root Directory ב-Vercel).
- **Vercel:** הפרויקט מחובר לריפו, deploy אוטומטי על push.
- **Neon (Postgres):** נוצר ישירות בחשבון Neon של המשתמש (לא דרך אינטגרציית Vercel).
- **משתני סביבה ב-Vercel:** `DATABASE_URL` (pooled, עם `-pooler`),
  `DIRECT_URL` (non-pooled), `AUTH_SECRET`.
- **מיגרציות:** רצות אוטומטית ב-build — `build: "prisma generate && prisma migrate
  deploy && next build"`. כל push מחיל מיגרציות חדשות על Neon.

### אילוץ סביבה חשוב (למד תוך כדי)
מסביבת ה-agent אין גישה ישירה ל-Postgres של Neon (יציאה 5432 חסומה, יוצא רק HTTPS).
לכן:
- מיגרציות מיושמות דרך ה-build של Vercel (שכן מגיע ל-Neon).
- הכנסת נתונים ידנית (משתמש ראשון, רשימת ילדים) נעשתה דרך **SQL Editor של Neon**
  (ווב) עם statements שהוכנו מראש. bcrypt hash מחושב מקומית ונשתל ב-INSERT.
- לפיתוח/בדיקות משתמשים ב-Postgres מקומי (זמני) לפני push.

## מצב הנתונים כרגע
- משתמש צוות ראשון קיים (email = של המשתמש, role staff).
- קבוצה אחת: **"כללי"** עם ~40 ילדים (כולל פיצול "אלון וייס"/"ליאור וייס").
- שדות `grade` עדיין ריקים ברובם — למילוי (באפליקציה ב-`/roster` או ב-bulk SQL).

## פתוח / צעדים הבאים
- **מילוי כיתות** ל-40 הילדים הקיימים.
- **חלוקה לקבוצות** (א'/ב'/ג') — כשיוחלט. אפשר ליצור קבוצות ולהעביר משתתפים
  (אין UI ל"העברה" בין קבוצות — כרגע מחיקה+הוספה, או UPDATE של `groupId` ב-SQL).
- **אבטחה:** Next נעול ל-14.2.35; כמה CVE של DoS מתוקנים רק ב-Next 16 (שדרוג major
  עם React 19) — נדחה. להזכיר: לאפס את סיסמת ה-DB של Neon (נחשפה בצ'אט בזמן ההקמה).
- **שלבים עתידיים** (מהבריף): סידור עבודה, לוז פעילויות, הכנת פעילויות עם AI,
  חלוקה לקבוצות, מעקב שעות עבודה. הבריף רומז ש-WorkShift/ActivitySchedule ישתמשו
  ב-Group/Participant הקיימים.

## איך מוסיפים משתמש צוות
אין מסך הרשמה. או `npm run seed` (עם `SEED_ADMIN_*` ב-.env), או INSERT ידני ל-`User`
עם `passwordHash` של bcrypt (cost 10) דרך Neon SQL Editor.
