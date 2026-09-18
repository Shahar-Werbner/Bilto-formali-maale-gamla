# פרומפטים לסשנים מקבילים

כל בלוק כאן הוא פרומפט שלם להדבקה בסשן נפרד.

**גל 0 כבר הושלם ונמצא בענף `claude/system-development-continuation-5uuneg`.**
לפני שמתחילים את A ו-B: למזג אותו ל-`main`. אחרי זה שני הסשנים יוצאים
מ-`main` המעודכן, כל אחד לענף משלו. סדר מיזוג בסוף: A ואז B.

---

## גל 0 — תשתית ✅ הושלם

נבנה ונבדק מקצה לקצה מול Postgres אמיתי. מה שיש עכשיו ושני המסלולים מסתמכים עליו:

- `requireAdmin()` ו-`requireSession()` ב-`src/lib/api-auth.ts`;
  אוצר המילים של התפקידים ב-`src/lib/roles.ts` (ללא תלות ב-auth/prisma, ניתן
  לבדיקה ביחידה).
- מחיקה רכה (`deletedAt`) ל-`Event` ול-`Participant`. **כל נתיב קריאה במערכת
  כבר מסנן `deletedAt: null`** — אם אתם מוסיפים שאילתה חדשה, סננו גם.
- `/admin` — ניהול תפקידים וסל מחזור. בבעלות אף אחד מהמסלולים; אל תיגעו.
- `Participant` כולל `parentName`, `parentPhone`, `phone` — מוכנים לשימוש.
- `vitest.config.ts` עם alias `@/` — אפשר לייבא בבדיקות בדיוק כמו באפליקציה.

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

## מסלולים C ו-D — נדחו לגל הבא

`Shift` ו-`AuditLog` **עוד לא קיימים בסכמה**. כשנגיע אליהם תנחת קודם מיגרציה
ייעודית (סשן יחיד, כמו גל 0), ורק אחריה אפשר להריץ אותם. הפרומפטים שלהם ייכתבו
אז, מול הסכמה שבאמת קיימת ולא מול סכמה מתוכננת.
