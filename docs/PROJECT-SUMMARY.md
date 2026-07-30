# מערכת נוכחות מעלה גמלא — סיכום מלא (להעברה לקלוד)

מסמך הקשר מלא להמשך פיתוח. מסכם את כל מה שנבנה עד כה, המבנה, ההחלטות, ומצב הפריסה.
המערכת **חיה ובשימוש** של הצוות.

## מה זה
מערכת ניהול לחינוך הבלתי פורמלי במושב מעלה גמלא. הליבה: **סימון נוכחות מבוסס
אירועים**. תוכנן להרחבה עתידית: סידור עבודה, לוז פעילויות, הכנת פעילויות עם AI,
מעקב שעות עבודה.

## Stack
- Next.js 14.2 (App Router, TypeScript), תיקיית `src/`
- Prisma ORM 5.22 + PostgreSQL (Neon)
- Auth.js (NextAuth v5 beta) — Credentials (email+סיסמה), JWT session, split-config
  ל-middleware edge-safe
- Tailwind CSS · exceljs (ייצוא) · bcryptjs (סיסמאות)
- עברית מלאה RTL (`<html dir="rtl">`), mobile-first
- פריסה: Vercel

## פיצ'רים שנבנו
### התחברות ומשתמשים
- **`/login`** — email + סיסמה.
- **`/register`** — הרשמה עצמית לצוות, מוגנת ב**קוד צוות משותף** (env `SIGNUP_CODE`).
  כל נרשם מקבל `role="staff"`. אם `SIGNUP_CODE` לא מוגדר — ההרשמה מושבתת.
- כל הדפים מוגנים ב-`middleware.ts` (redirect ל-`/login`). `/register` ציבורי.
- אין OAuth. הוספת משתמש ידנית אפשרית גם דרך seed / SQL.

### אירועים (מנגנון הנוכחות)
- **`/events`** — רשימת אירועים (שם, טווח, מס' ימים/משתתפים), מחיקה.
- **`/events/new`** — יצירת אירוע: שם, טווח תאריכים, **checkbox נפרד** ל"כלול שישי"
  ו"כלול שבת" (ברירת מחדל: לא), ובחירת משתתפים מהרשימה הראשית (ברירת מחדל כולם).
  המערכת מייצרת אוטומטית `EventDay` לכל יום בטווח (מדלגת על שישי/שבת אם לא סומנו).
- **`/events/[id]`** — בורר ימים; לכל יום: **תיאור פעילות** (נשמר אוטומטית, מיועד
  ל-AI בעתיד) + סימון נוכחות פרטני (נוכח/איחור/נעדר) + "סמן הכל נוכח". שמירה מיידית
  עם `markedByUserId`.
- **הנוכחות היא רק דרך אירועים** — אין דף נוכחות יומי עצמאי (הוסר).

### רשימת ילדים וקבוצות
- **`/roster`** — שני חלקים:
  1. **"כל הילדים"** — הרשימה הראשית (master). הוספה (שם+כיתה), עריכת כיתה inline, מחיקה.
  2. **"קבוצות"** — יצירה/מחיקה; לכל קבוצה: חברים + הסרה + הוספת ילד מהרשימה (dropdown).
- **שיוך מרובה**: Participant↔Group הוא many-to-many. ילד יכול להיות בכמה קבוצות.
  מחיקת קבוצה לא מוחקת ילדים.
- **כיתה (`grade`)** — שדה טקסט חופשי לכל ילד ("א'", "ה'2"...).
- **מיון אוטומטי לפי כיתה** — כל הרשימות ממוינות א→ב→ג… (ואז לפי שם; ללא כיתה בסוף).
  הלוגיקה: `sortByGrade` / `gradeRank` ב-`src/lib/attendance.ts`. אין מיון ידני יותר.

### ייצוא ל-Google Sheets / Excel
- **כל האירוע** — `GET /api/events/[id]/export` → `.xlsx` צבעוני: שורה לכל ילד, עמודה
  לכל יום, תאים ירוק/צהוב/אדום (נוכח/איחור/נעדר), עמודות סיכום. RTL. (exceljs)
- **יום בודד** — `GET /api/event-days/[id]/export` → `.xlsx` ליום אחד (כותרת, תיאור
  פעילות, ילדים ממוינים לפי כיתה, סטטוס צבוע, שורת סיכום).
- כפתורים בדף האירוע. הצבעים נשמרים כשפותחים ב-Google Sheets.

### היסטוריה
- **`/history`** — כל יום-אירוע עם שם האירוע וסיכום נוכחים/איחורים/נעדרים (60 אחרונים).

## מבנה קבצים
```
prisma/schema.prisma, prisma/migrations/*, prisma/seed.ts
src/auth.ts, src/auth.config.ts, src/middleware.ts
src/lib/{prisma,attendance,events,api-auth}.ts   # attendance.ts: STATUSES, date-only, gradeRank/sortByGrade
src/app/{login,register}/page.tsx
src/app/{events,events/new,events/[id],roster,history}/page.tsx
src/app/api/
  auth/[...nextauth], register,
  groups, groups/[id], groups/[id]/members,
  participants, participants/[id], participants/reorder(*legacy),
  events, events/[id], events/[id]/export,
  event-days/[id], event-days/[id]/export,
  event-attendance, event-attendance/bulk
src/components/{LoginForm,RegisterForm,SignOutButton,AppHeader,
  RosterManager,NewEventForm,EventBoard,DeleteEventButton}.tsx
```

## מודל הנתונים (Prisma, נוכחי)
- **User**: id, email(unique), name, role(String,"staff"), passwordHash?, createdAt.
- **Group**: id, name, participants (m-n `GroupMembers`), createdAt.
- **Participant**: id, name, grade?, sortOrder(Int, *legacy — לא בשימוש למיון*),
  groups (m-n), events (m-n `EventParticipants`), createdAt.
- **Event**: id, name, startDate/endDate (`@db.Date`), includeFriday/includeSaturday
  (Bool), participants (m-n), days (EventDay[]), createdAt.
- **EventDay**: id, eventId→Event(Cascade), date(`@db.Date`), description?, attendance,
  `@@unique([eventId,date])`.
- **EventAttendance**: id, eventDayId→EventDay(Cascade), participantId→Participant
  (Cascade), status, markedByUserId→User(SetNull), createdAt, updatedAt,
  `@@unique([eventDayId,participantId])`.
- **AttendanceRecord**: *legacy מהיום היומי הישן — לא בשימוש, נשאר כדי לא למחוק נתונים.*

### החלטות טכניות (סטיות מהבריף המקורי)
1. **סיסמה במקום magic link** — פשוט לפרוס (בלי SMTP). נוסף `passwordHash` ל-User.
2. **`role` נשאר String** — הרחבה ל-"parent" בעתיד בלי שינוי מבני.
3. **הרשמה עצמית עם קוד** — נוסף אחרי הבריף (הצוות נרשם לבד, לא ידני).
4. **Participant↔Group m-n** — במקום קבוצה יחידה (מיגרציה שמרה חברות קיימות).
5. **נוכחות events-only** — הדף היומי הוסר.
6. **חוב טכני קטן**: `AttendanceRecord` (legacy), `sortOrder` + `/api/participants/reorder`
   (legacy מהמיון הידני שהוחלף במיון-כיתה) — לא בשימוש, אפשר לנקות במיגרציה עתידית.

## פריסה — מצב נוכחי
- **Repo**: `github.com/Shahar-Werbner/Bilto-formali-maale-gamla` (public), `main`.
  ריפו עצמאי, האפליקציה בשורש (אין Root Directory ב-Vercel).
  (יש עותת נוסף גם בריפו `primo-s-fake-robot` תחת `attendance-app/`, branch
  `claude/attendance-system-phase-1-0l8v83` — היסטורי, לא הריפו שנפרס.)
- **Vercel**: מחובר לריפו, deploy אוטומטי על כל push.
- **Neon (Postgres)**: נוצר ישירות בחשבון Neon של המשתמש.
- **משתני סביבה ב-Vercel**: `DATABASE_URL` (pooled, `-pooler`), `DIRECT_URL`
  (non-pooled), `AUTH_SECRET`, `SIGNUP_CODE` (קוד ההרשמה של הצוות).
- **מיגרציות**: רצות אוטומטית ב-build —
  `build: "prisma generate && prisma migrate deploy && next build"`.

### אילוץ סביבת פיתוח (חשוב לדעת)
מסביבת ה-agent אין גישה ישירה ל-Postgres של Neon (יציאה 5432 חסומה, יוצא רק HTTPS).
לכן:
- מיגרציות מיושמות דרך build של Vercel.
- הכנסת נתונים ידנית (משתמש ראשון, רשימת ילדים) — דרך **Neon SQL Editor** (ווב) עם
  statements מוכנים; bcrypt hash מחושב מקומית.
- פיתוח/בדיקות מול Postgres מקומי זמני; screenshots ב-Chromium (Playwright) לבדיקת RTL/מובייל.

## מצב הנתונים
- משתמש/י צוות קיימים (role staff); צוות נרשם עצמאית דרך `/register` + קוד.
- קבוצה "כללי" עם ~40 ילדים; הכיתות מולאו.
- אירועים נוצרים דרך הממשק (למשל קייטנת קיץ 2–13/8, בלי שישי/שבת → 10 ימים).

## צעדים הבאים אפשריים (שלבים עתידיים מהבריף)
- סידור עבודה של הצוות, לוז פעילויות, הכנת פעילויות עם AI (תיאור היום כבר קיים
  כשדה — מקום טבעי לחיבור AI), מעקב שעות עבודה.
- תפקיד "parent" (צפייה בנוכחות הילד בלבד) — התשתית (role, markedBy) מוכנה.
- ניקוי חוב טכני: הסרת `AttendanceRecord` + `sortOrder`/reorder.
- שדרוג Next ל-16 (כמה CVE של DoS מתוקנים רק שם; נדחה — major + React 19).
- תזכורת תפעולית: לאפס את סיסמת ה-DB של Neon (נחשפה בצ'אט בזמן ההקמה).
