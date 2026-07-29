# נוכחות מעלה גמלא — שלב 1

מערכת סימון נוכחות לחינוך הבלתי פורמלי. Next.js 14 (App Router) + Prisma +
Postgres (Neon) + Auth.js + Tailwind, ממשק עברית מלא ב-RTL, מותאם לשימוש מהטלפון.

## מה נבנה

- **`/login`** — התחברות עם אימייל + סיסמה (Auth.js Credentials).
- **`/attendance`** — עמוד ראשי: בחירת תאריך (ברירת מחדל היום), תצוגה לפי קבוצות,
  כפתור "סמן הכל נוכח" לכל קבוצה, וסטטוס פרטני (נוכח / איחור / נעדר) לכל משתתף.
  **כל שינוי נשמר מיידית** ל-DB (עם `markedByUserId`).
- **`/roster`** — ניהול קבוצות ומשתתפים (הוספה/מחיקה).
- **`/history`** — סיכום נוכחים/איחורים/נעדרים לפי תאריך (30 הימים האחרונים).
- **API routes** תחת `/api/*` ל-CRUD, כולם מוגנים ב-session.
- כל הדפים מוגנים ב-`middleware.ts` (redirect ל-`/login` אם לא מחובר).

## הרצה מקומית

```bash
cp .env.example .env         # מלאו DATABASE_URL / DIRECT_URL / AUTH_SECRET
npm install
npm run prisma:generate
npm run prisma:migrate       # יוצר את הטבלאות ב-DB המקומי/Neon
npm run seed                 # יוצר משתמש צוות ראשון + קבוצת דוגמה
npm run dev                  # http://localhost:3000
```

`AUTH_SECRET` אפשר לייצר עם: `openssl rand -base64 32`.

## הוספת משתמשי צוות

אין מסך הרשמה (בכוונה). הוספת משתמשים נעשית ידנית:

1. **דרך ה-seed** — עדכנו `SEED_ADMIN_*` ב-`.env` והריצו `npm run seed`.
2. **משתמש נוסף** — הדרך הפשוטה: הריצו `npm run seed` עם ערכי מייל/סיסמה חדשים
   (ה-upsert יוסיף אותו), או הכניסו ישירות ל-DB רשומת `User` עם `passwordHash`
   של bcrypt (עלות 10).

---

## פריסה (Deployment)

הריפו הזה הוא שורש האפליקציה — אין צורך בהגדרת Root Directory ב-Vercel.

### 1. Vercel + Neon Postgres

1. ב-[vercel.com](https://vercel.com) → **Add New → Project** → יבוא הריפו מ-GitHub.
   Framework Preset יזוהה אוטומטית כ-Next.js.
2. **Storage → Create Database → Neon (Postgres)** וחברו לפרויקט. Vercel יזריק
   אוטומטית משתני סביבה של Neon (`DATABASE_URL`, `POSTGRES_PRISMA_URL`,
   `POSTGRES_URL_NON_POOLING` וכו').
3. הגדירו את שני המשתנים שהאפליקציה מצפה להם (Settings → Environment Variables):
   - `DATABASE_URL` → החיבור ה-**pooled** (למשל הערך של `POSTGRES_PRISMA_URL`).
   - `DIRECT_URL` → החיבור ה-**ישיר/non-pooled** (`POSTGRES_URL_NON_POOLING`).
   - `AUTH_SECRET` → תוצאת `openssl rand -base64 32`.

   > `AUTH_SECRET` הוא השם ב-Auth.js v5 (מחליף את `NEXTAUTH_SECRET` הישן).

### 2. הרצת המיגרציות בפרודקשן

הדרך הפשוטה — מהמחשב שלכם מול ה-DB של Neon (עם ה-URL-ים מ-Vercel ב-`.env`):

```bash
npm run prisma:deploy   # = prisma migrate deploy
npm run seed            # יצירת משתמש הצוות הראשון בפרודקשן
```

לחלופין אפשר להוסיף `prisma migrate deploy` ל-Build Command של Vercel:
`prisma generate && prisma migrate deploy && next build`.

### 3. משתני סביבה נדרשים (סיכום)

| משתנה           | חובה | תיאור                                           |
| --------------- | :--: | ----------------------------------------------- |
| `DATABASE_URL`  |  ✓   | חיבור Postgres (pooled) — לשימוש הרגיל של האפליקציה |
| `DIRECT_URL`    |  ✓   | חיבור ישיר (non-pooled) — למיגרציות Prisma       |
| `AUTH_SECRET`   |  ✓   | סוד לחתימת ה-session של Auth.js                  |
| `SEED_ADMIN_*`  |  −   | אימייל/סיסמה/שם למשתמש הראשון (ל-seed בלבד)       |

---

## החלטות טכניות

- **סיסמה במקום magic link** — נבחרה אימות סיסמה (Credentials + bcrypt) כי הוא
  פשוט יותר לפרוס: אין צורך בשירות שליחת מיילים (SMTP). לכן נוסף השדה
  `passwordHash` ל-`User` (לא היה בבריף המקורי). ה-session מסוג JWT.
- **`role` נשאר `String`** עם ברירת מחדל `"staff"` — הוספת `"parent"` בעתיד לא
  דורשת שינוי מבני. אין קישור קשיח של הרשאות ל-"staff" בקוד.
- **Cascade delete** — מחיקת קבוצה/משתתף מוחקת גם את רשומות הנוכחות התלויות;
  `markedBy` הופך ל-`null` אם המשתמש נמחק (השמירה ההיסטורית נשמרת).
