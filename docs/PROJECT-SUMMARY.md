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
### התחברות, משתמשים והרשאות
- `/login` — email + סיסמה. `/register` — הרשמה עצמית מוגנת ב**קוד צוות** (env
  `SIGNUP_CODE`); כל נרשם מקבל role `"staff"`. אין הרשמה אם `SIGNUP_CODE` לא מוגדר.
- כל הדפים מוגנים ב-`middleware.ts`; `/register` ציבורי.
- **שני תפקידים: `admin` ו-`staff`** (`src/lib/roles.ts`). מנהל/ת בלבד: מחיקת
  אירוע, מחיקת ילד/ה, שחזור, ושינוי תפקידים. אכיפה ב-`requireAdmin()`
  (`src/lib/api-auth.ts`), **שקורא את התפקיד מה-DB ולא מה-JWT** — אחרת הורדה
  מתפקיד לא הייתה נכנסת לתוקף עד ההתחברות הבאה, ימים אחר כך. המחיר: שאילתה
  אחת נוספת, רק בפעולות האלה.
- **`/admin`** — ניהול תפקידים + סל מחזור. מוגן פעמיים (הקישור בתפריט הוא נוחות;
  העמוד וה-API בודקים בעצמם). הגנות: אי אפשר להוריד לעצמך הרשאות ואי אפשר
  להשאיר את המערכת בלי אף מנהל/ת.
- **מחיקה רכה** (`deletedAt`) ל-`Event` ול-`Participant`: נעלמים מכל מסך, ייצוא
  ודוח, אבל הנתונים והנוכחות נשמרים ומנהל/ת משחזר/ת מ-`/admin`. כל נתיב קריאה
  במערכת מסנן `deletedAt: null`.

### אירועים (מנגנון הנוכחות)
- `/events` — רשימה + מחיקה. `/events/new` — יצירה: שם, טווח תאריכים, checkbox נפרד
  ל"כלול שישי" ו"כלול שבת" (ברירת מחדל לא), ובחירת משתתפים מהרשימה הראשית. המערכת
  מייצרת `EventDay` לכל יום בטווח (מדלגת שישי/שבת אם לא סומנו).
- `/events/[id]` — בורר ימים; לכל יום: תיאור, **לוז** (ראה למטה), וסימון נוכחות
  פרטני (נוכח/איחור/נעדר) + "סמן הכל נוכח". שמירה מיידית עם `markedByUserId`.
  היום הנפתח הוא **היום הנוכחי** (או הקרוב לו), והצ'יפ שלו נגלל לתצוגה.
- **סיכום חי ליום**: נוכחים/איחורים/נעדרים/**לא סומנו**, כפתור "הצג רק לא
  מסומנים" (עובד על snapshot — אחרת שורה נעלמת בזמן הסימון והאצבע פוגעת בילד
  הבא), וכפתור "סמן את הנותרים כנעדרים".
- **עריכת אירוע** (`PATCH /api/events/[id]`, סקשן "הגדרות האירוע"): שינוי שם /
  טווח תאריכים / שישי-שבת. הימים מיוצרים מחדש **תוספתית**: ימים חסרים נוספים,
  וימים שמחוץ לטווח נמחקים **רק אם אין בהם נוכחות ולוז**. התשובה מחזירה
  `{added, removed, keptWithData}` וה-UI מדווח למשתמש.
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
- `/roster` — "כל הילדים" (רשימה ראשית: הוספה, עריכת שם וכיתה inline, מחיקה) +
  "קבוצות" (יצירה/מחיקה, הוספת/הסרת חברים דרך dropdown). **שיוך מרובה**:
  Participant↔Group many-to-many — ילד בכמה קבוצות; מחיקת קבוצה לא מוחקת ילדים.
- **ייבוא רשימה שלמה** — הדבקת טקסט או קובץ CSV/TSV. הפורמט:
  `שם, כיתה, שם הורה, טלפון` (הכול חוץ מהשם אופציונלי), עם תמיכה במפרידים
  פסיק/טאב/נקודה-פסיק, שדות במרכאות, ודילוג על שורת כותרת שהודבקה בטעות.
  **תצוגה מקדימה לפני שמירה** שמראה מי ייווסף, מי ידולג ואילו שורות לא נקראו —
  כתיבה המונית לרשימה חיה לא אמורה להפתיע. ילד שכבר קיים מדולג, ולכן ייבוא של
  אותה רשימה פעמיים לא מוסיף אף אחד. הלוגיקה ב-`src/lib/participants.ts`,
  מכוסה ב-17 בדיקות.
- **חיפוש** לפי שם/כיתה/שם הורה (מופיע כשיש יותר מ-8 ילדים).
- **פרטי קשר**: `parentName`, `parentPhone`, `phone` — נפתחים בשורה, ואייקון
  טלפון בשורה עצמה פותח חיוג (`tel:`). בטיול זה מה שצריך: הורה בלחיצה אחת.
  מספרים מנורמלים בכל כתיבה (`050-123-4567` ← `0501234567`), כדי שמספר שהוקלד
  ידנית יתנהג כמו אחד שהגיע מייבוא.
- **כפילויות**: שני ילדים עם אותו שם (אחרי נרמול רווחים/גרשים) מסומנים בשורה
  עצמה — המקום שבו מבחינים בכפילות הוא בזמן שמסתכלים עליה. **מיזוג** (מנהל/ת
  בלבד, `POST /api/participants/merge`) מעביר קבוצות, אירועים ונוכחות לרשומה
  שנשארת. ביום שבו לשתי הרשומות יש סימון, **הסימון של הרשומה ששורדת גובר** ולא
  נדרס בשקט. הרשומה הממוזגת עוברת מחיקה רכה, כך שמיזוג בטעות ניתן לשחזור.
- שדה **כיתה** (`grade`) לכל ילד. **מיון אוטומטי לפי כיתה** (א→ב→ג…, ואז שם; ללא
  כיתה בסוף) בכל הרשימות — לוגיקה ב-`src/lib/attendance.ts` (`gradeRank`/`sortByGrade`).

### ייצוא ל-Google Sheets / Excel
- כל האירוע — `GET /api/events/[id]/export`. יום בודד — `GET /api/event-days/[id]/export`.
  `.xlsx` צבעוני (ירוק=נוכח/צהוב=איחור/אדום=נעדר), RTL, ממוין לפי כיתה, עם סיכומים. (exceljs)

### היסטוריה ודוחות
- `/history` — כל יום-אירוע עם שם האירוע וסיכום נוכחים/איחורים/נעדרים.
- `/reports` — **דוח לפי ילד/ה**: נוכח/איחור/נעדר ואחוז הגעה על פני כל האירועים.
  המכנה הוא כל ימי האירועים שהילד/ה רשומ/ה אליהם — **כולל ימים שלא סומנו**,
  אחרת ילד שהפסיק להגיע פשוט נעלם מהדוח. שאילתה אחת (`groupBy`) + ספירת ימים.

### איכות ועמידות (נוסף בסבב האחרון)
- **`src/lib/api-error.ts`** — כל route עוטף את עצמו ב-try/catch וממפה שגיאות
  Prisma: `P2025`→404, `P2002`→409, `P2003`→400, אחרת 500 מלוגג. קודם כל מחיקה
  של רשומה שכבר נמחקה החזירה 500 עם stack trace.
- **Scoping**: reorder של סלוטים מוודא שה-ids שייכים ל-`eventDay` שבנתיב;
  סימון נוכחות מוודא שהמשתתף רשום לאירוע; `groupId` נבדק לפני כתיבה.
- **AI**: תקרה לגודל טקסט/PDF, והיצירה בטרנזקציה אחת (לא חצי לוז).
- **`/api/register`**: השוואת קוד ב-timing-safe, תקרת ניסיונות לכל IP, וסיסמה
  מינימלית 8 תווים.
- **בדיקות**: `npm test` (vitest) — 21 בדיקות על הלוגיקה הטהורה.

## מבנה קבצים (עיקרי)
```
prisma/schema.prisma, prisma/migrations/*, prisma/seed.ts
src/auth.ts, src/auth.config.ts, src/middleware.ts
src/lib/{prisma,attendance,events,api-auth,api-error,ai-schedule,xlsx}.ts
src/lib/__tests__/{attendance,events,xlsx}.test.ts
src/app/{login,register,events,events/new,events/[id],roster,history,reports}/page.tsx
src/app/api/
  auth/[...nextauth], register,
  groups, groups/[id], groups/[id]/members,
  participants, participants/[id],
  events, events/[id] (PATCH+DELETE), events/[id]/export,
  events/[id]/participants, events/[id]/participants/bulk,
  event-days/[id], event-days/[id]/export,
  event-days/[id]/activity-slots, .../activity-slots/reorder, .../activity-slots/ai,
  activity-slots/[id],
  event-attendance, event-attendance/bulk
src/components/{LoginForm,RegisterForm,SignOutButton,AppHeader,RosterManager,
  NewEventForm,EventBoard,EventSettings,DaySchedule,DeleteEventButton}.tsx
```

## מודל הנתונים (Prisma, נוכחי)
- **User**: id, email(unique), name, role(String: "admin"|"staff"), passwordHash?, createdAt.
- **Group**: id, name, participants (m-n `GroupMembers`), activitySlots[], createdAt.
- **Participant**: id, name, grade?, parentName?, parentPhone?, phone?, deletedAt?,
  sortOrder(Int,*legacy — כבר לא נכתב ולא ממיין*), groups (m-n), events
  (m-n `EventParticipants`), createdAt.
- **Event**: id, name, startDate/endDate(`@db.Date`), includeFriday/includeSaturday
  (Bool), deletedAt?, participants (m-n), days[], createdAt.
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
groups_many_to_many (שומרת חברות קיימות) → add_activity_slots →
**add_roles_soft_delete_contacts**. כולן תוספתיות (פרט ל-m-n שהמירה groupId
ל-join table עם שמירת נתונים).

המיגרציה האחרונה מוסיפה `deletedAt` ל-Event ול-Participant, שדות קשר
(`parentName`/`parentPhone`/`phone`), אינדקסים על
`EventAttendance.participantId` ו-`EventDay.date`, וכוללת **שלב data migration**
שמקדם את המשתמש הוותיק ביותר ל-`admin`. השלב הזה קריטי: בלעדיו הפרודקשן — שכל
המשתמשים בו נוצרו לפני שהיו תפקידים — היה נשאר בלי אף מנהל/ת, ובלי דרך למנות
אחד. הוא idempotent (לא עושה כלום אם כבר יש admin).

### החלטות/סטיות מהבריף
1. סיסמה במקום magic link (בלי SMTP) → נוסף `passwordHash`.
2. `role` String — הרחבה ל-"parent" בלי שינוי מבני.
3. הרשמה עצמית עם קוד; נוכחות events-only; Participant↔Group m-n.
4. **חוב טכני**: `AttendanceRecord` ו-`Participant.sortOrder` — עמודות legacy
   שנשארו ב-DB כדי לא למחוק נתונים. הקוד כבר לא משתמש בהן (route ה-reorder הוסר,
   המיון הוא לפי כיתה). אפשר לנקות במיגרציה עתידית.
5. **הפרדת הרשאות** נוספה: `admin` מול `staff` (ראו למעלה). מידע רפואי/אלרגיות
   **לא נאגר** — החלטה מודעת; הסכמה תומכת בהוספה בהמשך בלי שינוי מבני.

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

## צעדים הבאים אפשריים (לפי סדר תשואה)
תוכנית העבודה המלאה וחלוקת העבודה בין סשנים: **`docs/ROADMAP.md`**.

1. ~~**תפקיד admin**~~ — ✅ נבנה.
2. **הורים** — תפקיד `parent` שרואה רק את הנוכחות של הילד שלו. דורש קישור
   `User ↔ Participant`.
3. **סידור עבודה ושעות של הצוות** — מודל `Shift` (מדריך, אירוע-יום, שעות),
   ודוח שעות חודשי. זה הפער הגדול הבא לפי הבריף המקורי.
4. **שיוך ילד לקבוצה בתוך אירוע** — היום `ActivitySlot.groupId` מצביע על קבוצה
   גלובלית; בקייטנה מחלקים לקבוצות אד-הוק.
5. **תיעוד פעילות עם AI** — סיכום יום מהלוז + הנוכחות.
6. **ניקוי חוב טכני** — מיגרציה שמורידה `AttendanceRecord` ו-`sortOrder`.
7. **אינדקסים** — `EventAttendance.participantId` ללא אינדקס; ירגיש כשיהיו
   אלפי רשומות.
8. שדרוג Next ל-16 (כמה CVE של DoS מתוקנים רק שם — major + React 19, נדחה).
9. תזכורת תפעולית: לאפס את סיסמת ה-DB של Neon (נחשפה בצ'אט בזמן ההקמה).
