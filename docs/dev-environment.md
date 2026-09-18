# בדיקה אמיתית בסביבת agent

`npm run typecheck` עובר גם כשהמערכת שבורה. המסמך הזה הוא המתכון להריץ את
האפליקציה **באמת** — מול Postgres חי ומול דפדפן — בתוך סביבת סשן. כל שורה כאן
נבדקה בפועל; היא נכתבה אחרי שכל אחת מהמלכודות למטה עלתה בזמן.

## Postgres מקומי

אין גישה ל-Neon מהסביבה (יציאה 5432 חסומה), אבל Postgres 16 מותקן מקומית.

```bash
PGD=/var/lib/postgresql/attendance-test
rm -rf $PGD && mkdir -p $PGD && chown postgres:postgres $PGD && chmod 700 $PGD
su postgres -c "PATH=\$PATH:/usr/lib/postgresql/16/bin initdb -D $PGD -U app --auth=trust"
su postgres -c "PATH=\$PATH:/usr/lib/postgresql/16/bin pg_ctl -D $PGD -l /var/lib/postgresql/pg.log -o '-p 5433 -k /tmp' start"
psql -h /tmp -p 5433 -U app -d postgres -c "create database attendance;"
```

**מלכודות:**
- `initdb` מסרב לרוץ כ-root — חייבים `su postgres`.
- **אל תשימו את ה-PGDATA תחת הסקראצ'פד.** התיקיות מעליו הן `700` של root,
  והדמון שרץ כ-postgres מאבד גישה באמצע העבודה. השרת נופל עם
  `could not stat data directory`. `/var/lib/postgresql` הוא המקום הנכון.
- הסוקט ב-`/tmp`, ולכן ב-connection string צריך `?host=/tmp`.

## הרצת האפליקציה

```bash
export DATABASE_URL="postgresql://app@localhost:5433/attendance?host=/tmp"
export DIRECT_URL="$DATABASE_URL"
export AUTH_SECRET="local-dev-secret-not-real-0000000000"
export SIGNUP_CODE="test-code-1234"
export AUTH_TRUST_HOST="true"      # בלי זה Auth.js מחזיר UntrustedHost
export AUTH_URL="http://localhost:3300"
npx prisma migrate deploy
SEED_ADMIN_EMAIL="a@b.co" SEED_ADMIN_PASSWORD="password123" npm run seed
npx next start -p 3300
```

**מלכודות:**
- `export A=1 B="$A"` לא עובד בשורה אחת — `$A` עדיין ריק. זה מתגלה כשגיאת
  Prisma מבלבלת על `DIRECT_URL` ריק.
- `AUTH_TRUST_HOST` נחוץ רק ל-`next start` מקומי. ב-Vercel זה אוטומטי.
- הריצו את השרת ברקע (`run_in_background`), לא עם `&` — תהליך עם `&` נהרג
  כשקריאת ה-Bash מסתיימת.
- **אל תריצו `pkill -f "next start"`.** התבנית מתאימה גם למחרוזת הפקודה של
  ה-shell שמריץ אותה, והיא הורגת את עצמה (exit 144). פשוט עברו לפורט אחר.
- `next build` מעל שרת שרץ שובר אותו. בנו, ואז הפעילו על פורט חדש.

## התחברות לבדיקת API

Auth.js דורש CSRF token, אז אי אפשר פשוט לעשות POST עם אימייל וסיסמה:

```bash
B=http://localhost:3300; J=$PWD/cookies.txt; rm -f "$J"
CSRF=$(curl -s -c "$J" "$B/api/auth/csrf" | python3 -c 'import sys,json;print(json.load(sys.stdin)["csrfToken"])')
curl -s -b "$J" -c "$J" -o /dev/null -X POST "$B/api/auth/callback/credentials" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "csrfToken=$CSRF" --data-urlencode "email=a@b.co" \
  --data-urlencode "password=password123" --data-urlencode "callbackUrl=$B/events"
curl -s -b "$J" "$B/api/auth/session"   # אמור להחזיר את המשתמש והתפקיד
```

שני צנצנות עוגיות = שני משתמשים במקביל, וכך בודקים הרשאות (admin מול staff)
באמת ולא בתיאוריה.

## צילומי מסך בדפדפן

Playwright מותקן גלובלית. שימו לב שהוא **CommonJS**, אז `import { chromium }`
נכשל:

```js
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pkg;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, locale: 'he-IL' });
```

**רוחב 390 (טלפון) הוא התצוגה שחשובה** — המערכת נמצאת בשימוש מהטלפון. שתי
בעיות אמיתיות התגלו רק בצילום מסך ולא בשום בדיקה אוטומטית: כפתור שנדחף מחוץ
למסך, ויום שנבחר אוטומטית אבל היה מחוץ לאזור הנראה.

## בדיקת קובץ xlsx שנוצר

```bash
curl -s -b cookies.txt -o out.xlsx "$B/api/events/<id>/export"
python3 -c "
import zipfile, re
z = zipfile.ZipFile('out.xlsx')
print(re.search(r'name=\"([^\"]+)\"', z.read('xl/workbook.xml').decode()).group(1))
"
```

כך התגלה שֶׁשֵּׁם אירוע עם `/` מפיל את הייצוא: ExcelJS זורק על שם גיליון לא חוקי.
