"use client";

import { useMemo } from "react";
import {
  MAX_EVENT_RANGE_DAYS,
  WEEKDAY_NAMES,
  generateEventDays,
  hoursBetween,
  rangeDayCount,
  type EventKind,
  type WeekdayTemplate,
} from "@/lib/events";

export type WeekdayRow = { startTime: string; endTime: string };

export type ScheduleState = {
  kind: EventKind;
  includeFriday: boolean;
  includeSaturday: boolean;
  defaultStartTime: string; // "" = no hours set
  defaultEndTime: string;
  // Only the chosen weekdays are present, keyed 0=Sunday … 6=Saturday.
  weekdays: Record<number, WeekdayRow>;
};

export function emptySchedule(): ScheduleState {
  return {
    kind: "recurring",
    includeFriday: false,
    includeSaturday: false,
    defaultStartTime: "",
    defaultEndTime: "",
    weekdays: {},
  };
}

// The shape the API expects. Rows with a missing time are dropped here and
// caught by validateSchedule before anything is sent.
export function toWeekdayTemplates(state: ScheduleState): WeekdayTemplate[] {
  return Object.entries(state.weekdays)
    .map(([weekday, row]) => ({
      weekday: Number(weekday),
      startTime: row.startTime,
      endTime: row.endTime,
    }))
    .filter((w) => w.startTime && w.endTime)
    .sort((a, b) => a.weekday - b.weekday);
}

export function toRequestBody(state: ScheduleState) {
  return {
    kind: state.kind,
    includeFriday: state.includeFriday,
    includeSaturday: state.includeSaturday,
    defaultStartTime: state.defaultStartTime || null,
    defaultEndTime: state.defaultEndTime || null,
    weekdays: toWeekdayTemplates(state),
  };
}

// Same rules the server enforces, said in the same words — the person should
// not have to round-trip to find out a time is back to front.
export function validateSchedule(
  state: ScheduleState,
  startDate: string,
  endDate: string,
): string | null {
  const span = rangeDayCount(startDate, endDate);
  if (span === null) return "תאריך לא תקין או שתאריך ההתחלה מאוחר מתאריך הסיום";
  if (span > MAX_EVENT_RANGE_DAYS) {
    return `הטווח ארוך מדי (${span} ימים). המקסימום הוא ${MAX_EVENT_RANGE_DAYS} ימים`;
  }

  if (state.kind === "recurring") {
    const chosen = Object.keys(state.weekdays);
    if (chosen.length === 0) return "יש לבחור לפחות יום אחד בשבוע";
    for (const day of chosen) {
      const row = state.weekdays[Number(day)];
      if (!row.startTime || !row.endTime) {
        return `יש למלא שעות ליום ${WEEKDAY_NAMES[Number(day)]}`;
      }
      if (row.endTime <= row.startTime) {
        return `שעת הסיום חייבת להיות אחרי שעת ההתחלה ביום ${WEEKDAY_NAMES[Number(day)]}`;
      }
    }
  } else {
    const { defaultStartTime: s, defaultEndTime: e } = state;
    if (Boolean(s) !== Boolean(e)) return "יש למלא גם שעת התחלה וגם שעת סיום";
    if (s && e && e <= s) return "שעת הסיום חייבת להיות אחרי שעת ההתחלה";
  }

  if (previewDays(state, startDate, endDate).length === 0) {
    return "אין ימים בטווח שנבחר";
  }
  return null;
}

function previewDays(state: ScheduleState, startDate: string, endDate: string) {
  if (!startDate || !endDate) return [];
  return generateEventDays({
    startDate,
    endDate,
    kind: state.kind,
    includeFriday: state.includeFriday,
    includeSaturday: state.includeSaturday,
    defaultStartTime: state.defaultStartTime || null,
    defaultEndTime: state.defaultEndTime || null,
    weekdays: toWeekdayTemplates(state),
  });
}

// Picking a weekday pattern is the one place where a wrong tap costs 80 rows.
// Show the count and the total hours before anything is written.
export default function ScheduleFields({
  state,
  onChange,
  startDate,
  endDate,
  compact = false,
}: {
  state: ScheduleState;
  onChange: (next: ScheduleState) => void;
  startDate: string;
  endDate: string;
  compact?: boolean;
}) {
  const days = useMemo(
    () => previewDays(state, startDate, endDate),
    [state, startDate, endDate],
  );
  const totalHours = useMemo(
    () => days.reduce((sum, d) => sum + hoursBetween(d.startTime, d.endTime), 0),
    [days],
  );

  function toggleWeekday(weekday: number) {
    const next = { ...state.weekdays };
    if (next[weekday]) {
      delete next[weekday];
    } else {
      // Copy the hours of a weekday already chosen: "Friday too, same times"
      // is the common case, and four taps per row adds up on a phone.
      const template = Object.values(state.weekdays).find(
        (r) => r.startTime && r.endTime,
      );
      next[weekday] = template
        ? { ...template }
        : { startTime: "", endTime: "" };
    }
    onChange({ ...state, weekdays: next });
  }

  function setWeekdayTime(
    weekday: number,
    field: "startTime" | "endTime",
    value: string,
  ) {
    onChange({
      ...state,
      weekdays: {
        ...state.weekdays,
        [weekday]: { ...state.weekdays[weekday], [field]: value },
      },
    });
  }

  const pad = compact ? "px-2 py-2" : "px-3 py-3";

  return (
    <div className="flex flex-col gap-3">
      {/* Kind */}
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-slate-700">סוג האירוע</span>
        <div className="flex gap-2">
          {(
            [
              ["recurring", "קבוע בשבוע", "למשל כל שלישי וכל שישי"],
              ["camp", "קייטנה / רצף ימים", "כל הימים בטווח"],
            ] as const
          ).map(([value, label, hint]) => (
            <button
              key={value}
              type="button"
              onClick={() => onChange({ ...state, kind: value })}
              aria-pressed={state.kind === value}
              className={`min-w-0 flex-1 rounded-lg border px-3 py-2 text-right ${
                state.kind === value
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-700"
              }`}
            >
              <span className="block text-sm font-semibold">{label}</span>
              <span
                className={`block text-xs ${
                  state.kind === value ? "text-slate-300" : "text-slate-400"
                }`}
              >
                {hint}
              </span>
            </button>
          ))}
        </div>
      </div>

      {state.kind === "recurring" ? (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-700">
            באילו ימים, ובאילו שעות?
          </span>
          <div className="flex flex-col divide-y divide-slate-100 rounded-lg border border-slate-200">
            {WEEKDAY_NAMES.map((label, weekday) => {
              const row = state.weekdays[weekday];
              const on = Boolean(row);
              return (
                <div key={label} className="p-2">
                  <label className="flex items-center gap-2 text-slate-800">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleWeekday(weekday)}
                      className="h-5 w-5"
                    />
                    <span className="font-medium">יום {label}</span>
                    {on && row.startTime && row.endTime && (
                      <span className="mr-auto text-xs text-slate-500">
                        {hoursBetween(row.startTime, row.endTime)} שעות
                      </span>
                    )}
                  </label>
                  {on && (
                    <div className="mt-2 flex gap-2 pr-7">
                      <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-slate-500">
                        משעה
                        <input
                          type="time"
                          value={row.startTime}
                          onChange={(e) =>
                            setWeekdayTime(weekday, "startTime", e.target.value)
                          }
                          dir="ltr"
                          className={`rounded-lg border border-slate-300 text-base ${pad}`}
                        />
                      </label>
                      <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-slate-500">
                        עד שעה
                        <input
                          type="time"
                          value={row.endTime}
                          onChange={(e) =>
                            setWeekdayTime(weekday, "endTime", e.target.value)
                          }
                          dir="ltr"
                          className={`rounded-lg border border-slate-300 text-base ${pad}`}
                        />
                      </label>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-slate-700">
              לכלול סופי שבוע?
            </span>
            <label className="flex items-center gap-2 text-slate-700">
              <input
                type="checkbox"
                checked={state.includeFriday}
                onChange={(e) =>
                  onChange({ ...state, includeFriday: e.target.checked })
                }
                className="h-5 w-5"
              />
              לכלול ימי שישי
            </label>
            <label className="flex items-center gap-2 text-slate-700">
              <input
                type="checkbox"
                checked={state.includeSaturday}
                onChange={(e) =>
                  onChange({ ...state, includeSaturday: e.target.checked })
                }
                className="h-5 w-5"
              />
              לכלול ימי שבת
            </label>
          </div>

          <div className="flex gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-medium text-slate-700">
              משעה
              <input
                type="time"
                value={state.defaultStartTime}
                onChange={(e) =>
                  onChange({ ...state, defaultStartTime: e.target.value })
                }
                dir="ltr"
                className={`rounded-lg border border-slate-300 text-base ${pad}`}
              />
            </label>
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-medium text-slate-700">
              עד שעה
              <input
                type="time"
                value={state.defaultEndTime}
                onChange={(e) =>
                  onChange({ ...state, defaultEndTime: e.target.value })
                }
                dir="ltr"
                className={`rounded-lg border border-slate-300 text-base ${pad}`}
              />
            </label>
          </div>
          <p className="text-xs text-slate-400">
            השעות חלות על כל ימי הקייטנה, וניתן לשנות יום בודד אחר כך.
          </p>
        </>
      )}

      {days.length > 0 && (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
          ייווצרו <span className="font-bold">{days.length}</span> מפגשים
          {totalHours > 0 && (
            <>
              {" · "}
              סה״כ{" "}
              <span className="font-bold">
                {Math.round(totalHours * 10) / 10}
              </span>{" "}
              שעות
            </>
          )}
        </p>
      )}
    </div>
  );
}
