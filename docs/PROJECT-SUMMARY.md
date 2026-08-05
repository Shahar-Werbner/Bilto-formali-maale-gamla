# מערכת נוכחות מעלה גמלא — סיכום מלא (להעברה לקלוד)

מסמך הקשר מלא להמשך פיתוח. המערכת **חיה ובשימוש** של הצוות. מסכם את כל מה שנבנה,
המבנה, ההחלטות, ומצב הפריסה.

## מה זה
מערכת ניהול לחינוך הבלתי פורמלי במושב מעלה גמלא. הליבה: **סימון נוכחות מבוסס
אירועים**, עם **לוז יומי מובנה** (כולל סידור אוטומטי עם AI). מתוכנן להרחבה: סידור
עבודה, מעקב שעות עבודה, תפקיד הורה.

## Stack
- Next.js 14.2 (App Router, TypeScript), תיקיית `src/`
- Prisma ORM 5.22 + PostgreSQL (Neon)
- Auth.js (NextAuth v5 beta) — Credentials (email+סיסמה), JWT, split-config (edge-safe middleware)
- Tailwind CSS · exceljs (ייצוא) · bcryptjs (סיסמאות) · @anthropic-ai/sdk (AI)
- עברית מלאה RTL, mobile-first · פריסה: Vercel

## פיצ'רים שנבנו
### התחברות ומשתמשים
- `/login` — email + סיסמה. `/register` — הרשמה עצמית מוגנת ב**קוד צוות** (env
  `SIGNUP_CODE`); כל נרשם מקבל role `"staff"`. אין הרשמה אם `SIGNUP_CODE` לא מוגדר.
- כל הדפים מוגנים ב-`middleware.ts`; `/register` ציבורי.

### אירועים (מנגנון הנוכחות)
- `/events` — רשימה + מחיקה. `/events/new` — יצירה: שם, טווח תאריכים, checkbox נפרד
  ל"כלול שישי" ו"כלול שבת" (ברירת מחדל לא), ובחירת משתתפים מהרשימה הראשית. המערכת
  מייצרת `EventDay` לכל יום בטווח (מדלגת שישי/שבת אם לא סומנו).
- `/events/[id]` — בורר ימים; לכל יום: תיאור, **לוז** (ראה למטה), וסימון נוכחות
  פרטני (נוכח/איחור/נעדר) + "סמן הכל נוכח". שמירה מיידית עם `markedByUserId`.
- **ניהול משתתפי האירוע בדיעבד**: בדף האירוע יש סקשן "משתתפים באירוע" — הוספה/הסרה
  של ילד בודד, ו**הוספת קבוצה שלמה** בבת אחת. (רשימת משתתפי האירוע עצמאית מחברות
  בקבוצות — לכן הוספה לקבוצה לא משנה אירוע קיים; יש להוסיף לאירוע במפורש.)
- הנוכחות היא **רק דרך אירועים** (אין דף יומי עצמאי).

### לוז יומי (ActivitySlot)
- בכל יום-אירוע: רשימת "סלוטים" ממוינת לפי order/שעה, עם שעה, כותרת, מיקום, תג קבוצה
  (אם ייעודי), והערות. הוספה/עריכה/מחיקה inline + חצי ▲▼ לשינוי סדר. שמירה מיידית.
- **סידור אוטומטי עם AI**: כפתור "✨ סידור אוטומטי עם AI" — כותבים תיאור חופשי או
  מצרפים קובץ (טקסט/PDF) עם תכנון, ו-Claude ממיר לפעילויות מסודרות (structured
  outputs). שמות קבוצות בטקסט ממופים לקבוצות קיימות. מוגן ב-`ANTHROPIC_API_KEY`
  (בלעדיו הכפתור מחזיר "לא מוגדר", השאר עובד). מודל דרך env `AI_MODEL` (ברירת מחדל
  `claude-opus-5`; אפשר `claude-haiku-4-5` לחיסכון).

### רשימת ילדים וקבוצות
- `/roster` — "כל הילדים" (רשימה ראשית: הוספה, כיתה inline, מחיקה) + "קבוצות"
  (יצירה/מחיקה, הוספת/הסרת חברים דרך dropdown). **שיוך מרובה**: Participant↔Group
  many-to-many — ילד בכמה קבוצות; מחיקת קבוצה לא מוחקת ילדים.
- שדה **כיתה** (`grade`) לכל ילד. **מיון אוטומטי לפי כיתה** (א→ב→ג…, ואז שם; ללא
  כיתה בסוף) בכל הרשימות — לוגיקה ב-`src/lib/attendance.ts` (`gradeRank`/`sortByGrade`).

### ייצוא ל-Google Sheets / Excel
- כל האירוע — `GET /api/events/[id]/export`. יום בודד — `GET /api/event-days/[id]/export`.
  `.xlsx` צבעוני (ירוק=נוכח/צהוב=איחור/אדום=נעדר), RTL, ממוין לפי כיתה, עם סיכומים. (exceljs)

### היסטוריה
- `/history` — כל יום-אירוע עם שם האירוע וסיכום נוכחים/איחורים/נעדרים.

## מבנה קבצים (עיקרי)
```
prisma/schema.prisma, prisma/migrations/*, prisma/seed.ts
src/auth.ts, src/auth.config.ts, src/middleware.ts
src/lib/{prisma,attendance,events,api-auth,ai-schedule}.ts
src/app/{login,register,events,events/new,events/[id],roster,history}/page.tsx
src/app/api/
  auth/[...nextauth], register,
  groups, groups/[id], groups/[id]/members,
  participants, participants/[id], participants/reorder(*legacy),
  events, events/[id], events/[id]/export,
  events/[id]/participants, events/[id]/participants/bulk,
  event-days/[id], event-days/[id]/export,
  event-days/[id]/activity-slots, .../activity-slots/reorder, .../activity-slots/ai,
  activity-slots/[id],
  event-attendance, event-attendance/bulk
src/components/{LoginForm,RegisterForm,SignOutButton,AppHeader,RosterManager,
  NewEventForm,EventBoard,DaySchedule,DeleteEventButton}.tsx
```

## מודל הנתונים (Prisma, נוכחי)
- **User**: id, email(unique), name, role(String,"staff"), passwordHash?, createdAt.
- **Group**: id, name, participants (m-n `GroupMembers`), activitySlots[], createdAt.
- **Participant**: id, name, grade?, sortOrder(Int,*legacy*), groups (m-n), events
  (m-n `EventParticipants`), createdAt.
- **Event**: id, name, startDate/endDate(`@db.Date`), includeFriday/includeSaturday
  (Bool), participants (m-n), days[], createdAt.
- **EventDay**: id, eventId→Event(Cascade), date(`@db.Date`), description?,
  attendance[], activitySlots[], `@@unique([eventId,date])`.
- **ActivitySlot**: id, eventDayId→EventDay(Cascade), startTime(String "HH:mm"),
  endTime?, title, location?, groupId?→Group(SetNull), notes?, order, createdAt.
- **EventAttendance**: id, eventDayId→EventDay(Cascade), participantId→Participant
  (Cascade), status, markedByUserId→User(SetNull), createdAt, updatedAt,
  `@@unique([eventDayId,participantId])`.
- **AttendanceRecord**: *legacy מהיום היומי הישן — לא בשימוש, נשאר כדי לא למחוק נתונים.*

### מיגרציות (בסדר)
0_init → add_participant_grade → add_events → add_participant_sort_order →
groups_many_to_many (שומרת חברות קיימות) → add_activity_slots. כולן תוספתיות
(פרט ל-m-n שהמירה groupId ל-join table עם שמירת נתונים).

### החלטות/סטיות מהבריף
1. סיסמה במקום magic link (בלי SMTP) → נוסף `passwordHash`.
2. `role` String — הרחבה ל-"parent" בלי שינוי מבני.
3. הרשמה עצמית עם קוד; נוכחות events-only; Participant↔Group m-n.
4. **חוב טכני**: `AttendanceRecord` + `sortOrder`/`/api/participants/reorder` (legacy,
   לא בשימוש) — אפשר לנקות במיגרציה עתידית.

## פריסה — מצב נוכחי
- **Repo**: `github.com/Shahar-Werbner/Bilto-formali-maale-gamla` (public), `main`.
  ריפו עצמאי, האפליקציה בשורש (אין Root Directory ב-Vercel). (עותק היסטורי גם ב-
  `primo-s-fake-robot` תחת `attendance-app/`.)
- **Vercel**: מחובר, deploy אוטומטי על push. **Neon (Postgres)** בחשבון המשתמש.
- **משתני סביבה ב-Vercel**: `DATABASE_URL` (pooled), `DIRECT_URL` (non-pooled),
  `AUTH_SECRET`, `SIGNUP_CODE`, `ANTHROPIC_API_KEY` (ל-AI, אופציונלי), `AI_MODEL`
  (אופציונלי). **שינוי env דורש Redeploy.**
- **מיגרציות**: רצות אוטומטית ב-build (`prisma generate && prisma migrate deploy && next build`).

### אילוץ סביבת פיתוח (חשוב)
מסביבת ה-agent אין גישה ישירה ל-Postgres של Neon (יציאה 5432 חסומה) ואין
`ANTHROPIC_API_KEY`. לכן: מיגרציות דרך build של Vercel; הכנסת נתונים ידנית דרך Neon
SQL Editor; פיתוח/בדיקות מול Postgres מקומי זמני + screenshots ב-Chromium/Playwright;
את קריאת ה-AI האמיתית בודקים בפרודקשן (עם המפתח).

## צעדים הבאים אפשריים
- מילוי/שיפור הלוז עם AI; חיבור AI גם ליצירת תיאור פעילות.
- סידור עבודה של הצוות, מעקב שעות עבודה.
- תפקיד "parent" (צפייה בנוכחות הילד בלבד) — התשתית (role, markedBy) מוכנה.
- ניקוי חוב טכני (AttendanceRecord, sortOrder/reorder).
- שדרוג Next ל-16 (כמה CVE של DoS מתוקנים רק שם — major + React 19, נדחה).
- תזכורת תפעולית: לאפס את סיסמת ה-DB של Neon (נחשפה בצ'אט בזמן ההקמה).
