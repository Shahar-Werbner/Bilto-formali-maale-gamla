# פרומפטים לסשנים מקבילים

כל בלוק כאן הוא פרומפט שלם להדבקה בסשן נפרד. **אל תריצו מסלול מגל 1 לפני
שגל 0 מוזג ל-`main`** — אחרת הם יילחמו על הסכמה ועל הניווט.

לכל סשן: ענף משלו, מ-`main` המעודכן. סדר מיזוג: A → B → C → D.

---

## גל 0 — תשתית (סולו, ראשון, בלי מקבילים)

```
קרא קודם docs/ROADMAP.md, docs/PROJECT-SUMMARY.md ו-README.md.

אתה בונה את גל 0 — שכבת התשתית שכל שאר המסלולים יסתמכו עליה. אתה הסשן היחיד
שרץ עכשיו, ואתה הבעלים היחיד של prisma/ ושל package.json בכל הפרויקט.

1. הרשאות admin/staff:
   - הוסף requireRole("admin") ל-src/lib/api-auth.ts ואכוף אותו בכל DELETE
     (אירוע, ילד, קבוצה, סלוט) ובעריכת משתמשים.
   - /api/register ממשיך להנפיק "staff" בלבד.
   - מסך /admin/users: רשימת משתמשים, שינוי role, ניטרול משתמש. admin בלבד.
   - המשתמש הראשון במערכת (או SEED_ADMIN) הוא admin; תעד איך מקדמים אדם לadmin
     כשאין עדיין אף admin.
2. מחיקה רכה: deletedAt ל-Event ול-Participant, וסינון בכל שאילתה וייצוא
   שקוראים אותם. מחיקה קיימת בממשק הופכת לרכה. הוסף שחזור במסך admin.
3. מיגרציה אחת שמכסה גם את גלים 1-2, כדי שאף מסלול מקבילי לא יצטרך לגעת בסכמה:
   - Participant: deletedAt, parentName?, parentPhone?, phone?  (ללא מידע רפואי —
     ממתין להחלטת המשתמש)
   - Event: deletedAt
   - Shift: id, userId→User, eventDayId?→EventDay, date, startTime, endTime,
     role?, notes?, createdAt — למסלול C
   - AuditLog: id, userId?, action, entity, entityId, meta(Json?), createdAt
   - ParentLink: קשר m-n בין User לבין Participant — למסלול E
   - אינדקסים: EventAttendance.participantId, EventDay.date
   אל תמחק את AttendanceRecord ואת sortOrder — הם חוב טכני עם נתונים היסטוריים
   ומטופלים בנפרד.
4. עמודי stub + ניווט: צור עמוד ריק מסודר ("בבנייה") ורשום בניווט את /shifts
   ואת /admin. אחרי זה אף מסלול לא ייגע ב-AppHeader.tsx.
5. אם אתה מזהה תלות npm שגלים 1-2 יצטרכו — הוסף אותה עכשיו.
6. צור את התיקייה docs/changes/ עם README קצר שמסביר למה היא קיימת.

חובה לפני push: npm test && npm run lint && npm run typecheck ירוקים, ובנוסף
הרץ Postgres מקומי, החל את המיגרציה ובדוק בפועל שהאכיפה עובדת (staff מקבל 403
על DELETE, admin מצליח). אל תסמוך על typecheck בלבד.
```

---

## מסלול A — רשימת ילדים וזהות

```
קרא קודם docs/ROADMAP.md ו-docs/PROJECT-SUMMARY.md. אתה מסלול A.

בבעלותך בלבד: src/app/roster/**, src/components/Roster*,
src/app/api/participants/**, src/app/api/groups/**, src/lib/participants.ts

אל תיגע: prisma/ (הסכמה כבר מוכנה), package.json, AppHeader.tsx, layout.tsx,
globals.css, middleware.ts, auth*.ts, api-error.ts, README.md, PROJECT-SUMMARY.md.

בנה:
1. ייבוא רשימה שלמה — הדבקת טקסט ("שם, כיתה" בכל שורה) או קובץ CSV, עם תצוגה
   מקדימה לפני שמירה, זיהוי שמות שכבר קיימים, ודיווח כמה נוספו/דולגו.
2. חיפוש וסינון ברשימת הילדים (שם, כיתה) — הרשימה נהיית ארוכה מדי לגלילה.
3. עריכת שם ילד/ה inline (היום אפשר רק כיתה).
4. טיפול בכפילויות: זיהוי שמות זהים ומיזוג שתי רשומות לאחת, כולל העברת הנוכחות
   וחברות הקבוצות.
5. פרטי קשר: שם הורה וטלפון, עם קישור חיוג ישיר במסך. השדות כבר בסכמה.

כתוב את סיכום השינויים ל-docs/changes/track-a.md (קובץ חדש, לא לערוך מסמכים קיימים).
הוסף בדיקות vitest ללוגיקה טהורה שאתה כותב (פענוח CSV, זיהוי כפילויות).
לפני push: npm test && npm run lint && npm run typecheck ירוקים.
בדוק מול Postgres מקומי, לא רק typecheck.
```

---

## מסלול B — נוכחות עמידה בשטח (אופליין)

```
קרא קודם docs/ROADMAP.md ו-docs/PROJECT-SUMMARY.md. אתה מסלול B.

בבעלותך בלבד: src/components/EventBoard.tsx, src/lib/offline-queue.ts,
src/app/api/event-attendance/**, public/**, src/app/manifest.ts

אל תיגע: prisma/, package.json, AppHeader.tsx, layout.tsx, globals.css,
middleware.ts, auth*.ts, api-error.ts, README.md, PROJECT-SUMMARY.md,
DaySchedule.tsx, EventSettings.tsx.

הבעיה: סימון נוכחות קורה בשטח עם קליטה גרועה. היום כשל רשת מגלגל את הסימון
אחורה ומראה הודעת שגיאה — כלומר העבודה אובדת.

בנה:
1. תור שמירה מתמיד ב-localStorage: סימון נכנס לתור, נשלח, ונמחק מהתור רק אחרי
   אישור מהשרת. שידור חוזר אוטומטי כשהחיבור חוזר (online event + ניסיון חוזר
   עם השהייה עולה).
2. חיווי ברור במסך: "נשמר" / "ממתין לשמירה (3)" / "אין חיבור". המשתמש חייב לדעת
   אם מה שסימן באמת נשמר.
3. שמירה על הסדר הנכון: אם אותו ילד סומן פעמיים, המצב האחרון הוא שמנצח.
4. PWA: manifest + אייקונים + service worker שמאפשר פתיחת האפליקציה בלי רשת.
   בלי ספריות חדשות — service worker ידני, קצר ומתועד.

אזהרה: תור מתמיד הוא בדיוק המקום שבו מצטברים באגים שקטים. כתוב בדיקות vitest
לתור עצמו (הצטברות, שידור חוזר, סדר, ניקוי אחרי הצלחה) לפני שאתה מחבר אותו ל-UI.
כתוב סיכום ל-docs/changes/track-b.md.
לפני push: npm test && npm run lint && npm run typecheck ירוקים. בדוק בדפדפן
אמיתי עם throttling/offline, לא רק ביחידה.
```

---

## מסלול C — סידור עבודה ושעות צוות

```
קרא קודם docs/ROADMAP.md ו-docs/PROJECT-SUMMARY.md. אתה מסלול C.

בבעלותך בלבד: src/app/shifts/**, src/app/api/shifts/**, src/components/Shift*,
src/lib/shifts.ts. העמוד /shifts כבר קיים כ-stub ורשום בניווט — מלא אותו.

אל תיגע: prisma/ (מודל Shift כבר קיים), package.json, AppHeader.tsx,
layout.tsx, globals.css, middleware.ts, auth*.ts, api-error.ts, README.md,
PROJECT-SUMMARY.md.

זה המודול הגדול הבא מהבריף המקורי, וכולו קבצים חדשים.

בנה:
1. שיבוץ: מי מהצוות עובד באיזה יום-אירוע, משעה עד שעה, ובאיזה תפקיד.
2. תצוגת שבוע/אירוע — מי משובץ מתי, ומי חסר.
3. דוח שעות: סיכום חודשי לכל איש צוות (סה"כ שעות, פירוט לפי יום), וייצוא xlsx
   באמצעות העזרים הקיימים ב-src/lib/xlsx.ts (קרא, אל תשנה — הקובץ בבעלות מסלול D).
4. הרשאות: איש צוות רואה את הסידור של כולם ואת השעות של עצמו; admin רואה ומעדכן
   הכול. השתמש ב-requireRole שכבר קיים ב-src/lib/api-auth.ts.

שים לב לחישוב שעות סביב חצות ולמשמרת בלי שעת סיום — כתוב בדיקות vitest לחישוב.
כתוב סיכום ל-docs/changes/track-c.md.
לפני push: npm test && npm run lint && npm run typecheck ירוקים. בדוק מול
Postgres מקומי.
```

---

## מסלול D — דוחות וייצוא

```
קרא קודם docs/ROADMAP.md ו-docs/PROJECT-SUMMARY.md. אתה מסלול D.

בבעלותך בלבד: src/app/reports/**, src/components/Report*, src/lib/xlsx.ts,
src/app/api/events/[id]/export/**, src/app/api/event-days/[id]/export/**

אל תיגע: prisma/, package.json, AppHeader.tsx, layout.tsx, globals.css,
middleware.ts, auth*.ts, api-error.ts, README.md, PROJECT-SUMMARY.md,
EventBoard.tsx.

קיים היום: /reports (דוח לפי ילד/ה עם אחוז הגעה) ושני ייצואי xlsx.

בנה:
1. פילוח בדוח הילד/ה: אחוז הגעה לפי אירוע ולא רק סך הכול, כדי לראות מתי בדיוק
   ילד/ה הפסיק/ה להגיע.
2. סינון הדוח לפי טווח תאריכים, אירוע וכיתה.
3. דוח חודשי לארגון: כמה ילדים הגיעו, פילוח לפי כיתה וקבוצה, מגמה לאורך זמן.
4. ייצוא של כל דוח ל-xlsx, באותו סגנון RTL צבעוני של הייצואים הקיימים.
5. תקן את מה שחסר בייצוא הקיים: אין בו ימים שנוספו לאירוע בדיעבד בסדר נכון,
   ואין גיליון סיכום.

אם אתה מוסיף גרף — קרא את הנחיות התצוגה לפני שאתה כותב שורת קוד ראשונה של גרף.
כתוב בדיקות vitest לחישובי האחוזים והצבירה.
כתוב סיכום ל-docs/changes/track-d.md.
לפני push: npm test && npm run lint && npm run typecheck ירוקים. פתח קובץ xlsx
שנוצר ובדוק את תוכנו בפועל.
```
