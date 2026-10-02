import {
  type CalendarEvent,
  DAILY_BUFFER_MINUTES,
  DAYS,
  type Emergency,
  type EventType,
  FIXED_BLOCKS,
  type Project,
  type ProjectPriority,
} from "./scheduler";

interface Interval {
  start: Date;
  end: Date;
}

export interface ScheduleOptions {
  weeklyBudgets: { P1: number; P2: number };
  meetings: CalendarEvent[];
  manualEvents: CalendarEvent[];
  now?: Date;
}

export interface ScheduleResult {
  events: CalendarEvent[];
  availableEmergencySlots: CalendarEvent[];
  projectMinutes: Record<ProjectPriority, number>;
  priorityWarnings: ProjectPriority[];
  bufferMinutes: number;
  emergencyMinutes: number;
  unscheduledEmergencyMinutes: number;
}

const minutes = (date: Date) => date.getTime() / 60_000;
const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function atTime(day: Date, time: string): Date {
  const [hours, minute] = time.split(":").map(Number);
  const result = new Date(day);
  result.setHours(hours, minute, 0, 0);
  return result;
}

function localDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

function subtract(intervals: Interval[], blocked: Interval): Interval[] {
  return intervals.flatMap((interval) => {
    if (blocked.end <= interval.start || blocked.start >= interval.end)
      return [interval];
    const result: Interval[] = [];
    if (blocked.start > interval.start)
      result.push({ start: interval.start, end: blocked.start });
    if (blocked.end < interval.end)
      result.push({ start: blocked.end, end: interval.end });
    return result;
  });
}

function takeFromEnd(intervals: Interval[], requested: number) {
  const remaining = intervals.map((interval) => ({ ...interval }));
  const selected: Interval[] = [];
  let unallocated = requested;
  for (
    let index = remaining.length - 1;
    index >= 0 && unallocated > 0;
    index -= 1
  ) {
    const interval = remaining[index];
    const duration = Math.min(
      unallocated,
      minutes(interval.end) - minutes(interval.start),
    );
    if (duration <= 0) continue;
    const start = new Date(interval.end.getTime() - duration * 60_000);
    selected.unshift({ start, end: interval.end });
    interval.end = start;
    unallocated -= duration;
    if (interval.start >= interval.end) remaining.splice(index, 1);
  }
  return { selected, remaining, unallocated };
}

function takeFromStart(intervals: Interval[], requested: number) {
  const remaining = intervals.map((interval) => ({ ...interval }));
  const selected: Interval[] = [];
  let unallocated = requested;
  for (let index = 0; index < remaining.length && unallocated > 0; index += 1) {
    const interval = remaining[index];
    const duration = Math.min(
      unallocated,
      minutes(interval.end) - minutes(interval.start),
    );
    if (duration <= 0) continue;
    const end = new Date(interval.start.getTime() + duration * 60_000);
    selected.push({ start: interval.start, end });
    interval.start = end;
    unallocated -= duration;
    if (interval.start >= interval.end) {
      remaining.splice(index, 1);
      index -= 1;
    }
  }
  return { selected, remaining, unallocated };
}

function claimExact(intervals: Interval[], wanted: Interval): boolean {
  const index = intervals.findIndex(
    (interval) => interval.start <= wanted.start && interval.end >= wanted.end,
  );
  if (index < 0) return false;
  const interval = intervals[index];
  intervals.splice(
    index,
    1,
    ...[
      ...(interval.start < wanted.start
        ? [{ start: interval.start, end: wanted.start }]
        : []),
      ...(wanted.end < interval.end
        ? [{ start: wanted.end, end: interval.end }]
        : []),
    ],
  );
  return true;
}

function takeContiguous(
  intervals: Interval[],
  duration: number,
): Interval | undefined {
  const index = intervals.findIndex(
    (interval) => minutes(interval.end) - minutes(interval.start) >= duration,
  );
  if (index < 0) return undefined;
  const interval = intervals[index];
  const selected = {
    start: interval.start,
    end: new Date(interval.start.getTime() + duration * 60_000),
  };
  interval.start = selected.end;
  if (interval.start >= interval.end) intervals.splice(index, 1);
  return selected;
}

function takeAtOrAfter(
  intervals: Interval[],
  earliest: Date,
  duration: number,
): Interval | undefined {
  for (let index = 0; index < intervals.length; index += 1) {
    const interval = intervals[index];
    const start = new Date(
      Math.max(interval.start.getTime(), earliest.getTime()),
    );
    if (minutes(interval.end) - minutes(start) < duration) continue;
    const selected = {
      start,
      end: new Date(start.getTime() + duration * 60_000),
    };
    intervals.splice(
      index,
      1,
      ...(interval.start < selected.start
        ? [{ start: interval.start, end: selected.start }]
        : []),
      ...(selected.end < interval.end
        ? [{ start: selected.end, end: interval.end }]
        : []),
    );
    return selected;
  }
  return undefined;
}

function makeEvent(
  id: string,
  title: string,
  interval: Interval,
  type: EventType,
  options: Partial<
    Pick<
      CalendarEvent,
      "fixed" | "editable" | "display" | "projectId" | "emergencyId" | "status"
    >
  > = {},
): CalendarEvent {
  return {
    id,
    title,
    start: localDateTime(interval.start),
    end: localDateTime(interval.end),
    type,
    fixed: options.fixed ?? false,
    editable: options.editable ?? true,
    ...options,
  };
}

function dayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

function projectPriority(type: EventType): ProjectPriority | undefined {
  if (type === "PROJECT_P1") return "P1";
  if (type === "PROJECT_P2") return "P2";
  if (type === "PROJECT_P3") return "P3";
  return undefined;
}

export function buildSchedule(
  weekStart: Date,
  projects: Project[],
  emergencies: Emergency[],
  options: ScheduleOptions,
): ScheduleResult {
  const events: CalendarEvent[] = [];
  const availableEmergencySlots: CalendarEvent[] = [];
  const freeByDay: Interval[][] = [];
  const emergencySlotIntervalsByDay: Interval[][] = DAYS.map(() => []);
  const projectMinutes: Record<ProjectPriority, number> = {
    P1: 0,
    P2: 0,
    P3: 0,
  };
  const manualDailyMinutes: Record<ProjectPriority, number[]> = {
    P1: DAYS.map(() => 0),
    P2: DAYS.map(() => 0),
    P3: DAYS.map(() => 0),
  };
  let bufferMinutes = 0;
  let emergencyMinutes = 0;
  let unscheduledEmergencyMinutes = 0;

  DAYS.forEach((dayName, index) => {
    const day = new Date(weekStart);
    day.setDate(day.getDate() + index);
    const close = index === 4 ? "16:00" : "18:00";
    let free: Interval[] = [
      { start: atTime(day, "09:00"), end: atTime(day, "13:00") },
      { start: atTime(day, "14:00"), end: atTime(day, close) },
    ];

    events.push(
      makeEvent(
        `lunch-${index}`,
        "Pausa pranzo",
        { start: atTime(day, "13:00"), end: atTime(day, "14:00") },
        "BREAK",
        { fixed: true, editable: false, display: "background" },
      ),
    );
    FIXED_BLOCKS.filter((block) => block.day === index).forEach((block) => {
      const interval = {
        start: atTime(day, block.start),
        end: atTime(day, block.end),
      };
      free = subtract(free, interval);
      events.push(
        makeEvent(
          `fixed-${index}-${block.start}`,
          block.title,
          interval,
          block.type,
          { fixed: true, editable: false },
        ),
      );
    });

    const emptyWindows =
      index === 0
        ? [{ start: "14:00", end: "14:15" }]
        : index >= 1 && index <= 3
          ? [{ start: "09:00", end: "09:15" }]
          : [];
    emptyWindows.forEach(({ start, end }, gapIndex) => {
      const interval = { start: atTime(day, start), end: atTime(day, end) };
      free = subtract(free, interval);
      events.push(
        makeEvent(
          `gap-${index}-${gapIndex}`,
          "Intervallo fisso · lasciare libero",
          interval,
          "GAP",
          { fixed: true, editable: false, display: "background" },
        ),
      );
    });

    if (index === 2)
      events.push(
        makeEvent(
          "focus-wed",
          "Focus · no call",
          { start: atTime(day, "14:00"), end: atTime(day, "18:00") },
          "FOCUS",
          { fixed: true, editable: false, display: "background" },
        ),
      );
    if (index === 4) {
      events.push(
        makeEvent(
          "focus-fri-am",
          "No call · sviluppo e formazione",
          { start: atTime(day, "09:00"), end: atTime(day, "13:00") },
          "FOCUS",
          { fixed: true, editable: false, display: "background" },
        ),
      );
      events.push(
        makeEvent(
          "focus-fri-pm",
          "No call · sviluppo e formazione",
          { start: atTime(day, "14:00"), end: atTime(day, "15:30") },
          "FOCUS",
          { fixed: true, editable: false, display: "background" },
        ),
      );
    }

    options.meetings
      .filter((meeting) => dateKey(new Date(meeting.start)) === dateKey(day))
      .forEach((meeting) => {
        const interval = {
          start: new Date(meeting.start),
          end: new Date(meeting.end),
        };
        free = subtract(free, interval);
        events.push({ ...meeting, fixed: false, editable: true });
      });

    const dayEmergencies = emergencies.filter(
      (emergency) => emergency.day === dayName,
    );
    const floatingEmergencies = dayEmergencies.filter(
      (emergency) => !emergency.startTime,
    );
    const reserved = takeFromEnd(free, DAILY_BUFFER_MINUTES[index]);
    free = reserved.remaining;
    let emergencySlots = reserved.selected;

    dayEmergencies
      .filter((emergency) => emergency.startTime)
      .forEach((emergency) => {
        const start = atTime(day, emergency.startTime!);
        const end = emergency.endTime
          ? atTime(day, emergency.endTime)
          : new Date(start.getTime() + emergency.durationMinutes * 60_000);
        const interval = {
          start,
          end,
        };
        const durationMinutes = minutes(end) - minutes(start);
        const usedBuffer = claimExact(emergencySlots, interval);
        const placedOutsideBuffer = !usedBuffer && claimExact(free, interval);
        if (!usedBuffer && !placedOutsideBuffer) {
          unscheduledEmergencyMinutes += durationMinutes;
          return;
        }
        emergencyMinutes += durationMinutes;
        events.push(
          makeEvent(emergency.id, emergency.title, interval, "EMERGENCY", {
            emergencyId: emergency.id,
            status: emergency.status ?? "TODO",
          }),
        );
      });

    floatingEmergencies.forEach((emergency) => {
      const placed = takeFromStart(emergencySlots, emergency.durationMinutes);
      emergencySlots = placed.remaining;
      placed.selected.forEach((interval, part) => {
        events.push(
          makeEvent(
            `${emergency.id}-${part}`,
            emergency.title,
            interval,
            "EMERGENCY",
            { emergencyId: emergency.id, status: emergency.status ?? "TODO" },
          ),
        );
        emergencyMinutes += minutes(interval.end) - minutes(interval.start);
      });
      unscheduledEmergencyMinutes += placed.unallocated;
    });

    emergencySlotIntervalsByDay[index].push(...emergencySlots);

    freeByDay.push(free);
  });

  const activeP1 = projects.find(
    (project) => project.priority === "P1" && project.name.trim(),
  );
  const activeP2 = projects.find(
    (project) => project.priority === "P2" && project.name.trim(),
  );
  const p3Projects = projects.filter(
    (project) => project.priority === "P3" && project.name.trim(),
  );

  const manualEvents = [...options.manualEvents].sort((a, b) => {
    const rank = (event: CalendarEvent) =>
      (
        ({
          PROJECT_P1: 0,
          PROJECT_P2: 1,
          PROJECT_P3: 2,
          CUSTOM: 3,
          FIX_BUFFER: 4,
        }) as Record<string, number>
      )[event.type] ?? 5;
    return rank(a) - rank(b) || a.start.localeCompare(b.start);
  });
  const projectSlots = freeByDay.map((intervals) => [...intervals]);

  manualEvents.forEach((manual) => {
    const priority = projectPriority(manual.type);
    const originalStart = new Date(manual.start);
    const originalEnd = new Date(manual.end);
    const duration = minutes(originalEnd) - minutes(originalStart);
    const index = dayIndex(originalStart);
    if (index < 0 || index > 4 || duration <= 0) return;
    const exact = { start: originalStart, end: originalEnd };
    if (manual.type === "CUSTOM") return;
    if (!priority || priority === "P3") return;
    const weeklyLimit = priority === "P1" ? 1200 : 600;
    const dailyLimit = priority === "P1" ? 240 : 120;
    if (duration > weeklyLimit - projectMinutes[priority]) return;

    let placed: Interval | undefined;
    const dayOrder = [
      ...Array.from(
        { length: projectSlots.length - index },
        (_, offset) => index + offset,
      ),
      ...Array.from({ length: index }, (_, earlierDay) => earlierDay),
    ];
    for (const day of dayOrder) {
      if (duration > dailyLimit - manualDailyMinutes[priority][day]) continue;
      if (day === index && claimExact(projectSlots[day], exact)) {
        placed = exact;
        break;
      }
      placed = takeContiguous(projectSlots[day], duration);
      if (placed) break;
    }
    if (!placed) {
      unscheduledEmergencyMinutes += 0;
      return;
    }
    events.push({
      ...manual,
      start: localDateTime(placed.start),
      end: localDateTime(placed.end),
    });
    projectMinutes[priority] += duration;
    manualDailyMinutes[priority][dayIndex(placed.start)] += duration;
  });

  const assigned = { ...projectMinutes };
  const p1Project = activeP1;
  const p1Type: EventType = "PROJECT_P1";
  const p1Budget = Math.max(
    0,
    Math.min(1200, Math.max(600, options.weeklyBudgets.P1)) - projectMinutes.P1,
  );
  const p2Budget = activeP2
    ? Math.max(
        0,
        Math.min(600, Math.max(360, options.weeklyBudgets.P2)) -
          projectMinutes.P2,
      )
    : 0;

  const allocate = (
    index: number,
    project: Project,
    type: EventType,
    requested: number,
    priority: ProjectPriority,
    part: number,
  ) => {
    const taken = takeFromStart(projectSlots[index], requested);
    projectSlots[index] = taken.remaining;
    taken.selected.forEach((interval, chunk) => {
      events.push(
        makeEvent(
          `auto-${project.id}-${dateKey(interval.start)}-${part}-${chunk}`,
          project.name,
          interval,
          type,
          { projectId: project.id },
        ),
      );
      const duration = minutes(interval.end) - minutes(interval.start);
      projectMinutes[priority] += duration;
      manualDailyMinutes[priority][index] += duration;
    });
    return taken.unallocated;
  };

  let p1Remaining = p1Budget;
  let p2Remaining = p2Budget;
  if (p1Project) {
    for (let index = 0; index < DAYS.length && p1Remaining > 0; index += 1) {
      const dailyGoal = Math.min(
        120,
        Math.max(0, 120 - manualDailyMinutes.P1[index]),
        p1Remaining,
      );
      const before = p1Remaining;
      p1Remaining = allocate(index, p1Project, p1Type, dailyGoal, "P1", 0);
      const spent = dailyGoal - p1Remaining;
      p1Remaining = before - spent;
    }
    for (let index = 0; index < DAYS.length && p1Remaining > 0; index += 1) {
      const dailyRoom = Math.max(0, 240 - manualDailyMinutes.P1[index]);
      if (dailyRoom === 0) continue;
      const before = p1Remaining;
      const requested = Math.min(p1Remaining, dailyRoom);
      const unallocated = allocate(
        index,
        p1Project,
        p1Type,
        requested,
        "P1",
        1,
      );
      p1Remaining = before - (requested - unallocated);
    }
  }
  if (activeP2) {
    for (let index = 0; index < DAYS.length && p2Remaining > 0; index += 1) {
      const dailyGoal = Math.min(
        90,
        Math.max(0, 90 - manualDailyMinutes.P2[index]),
        p2Remaining,
      );
      const before = p2Remaining;
      const unallocated = allocate(
        index,
        activeP2,
        "PROJECT_P2",
        dailyGoal,
        "P2",
        0,
      );
      p2Remaining = before - (dailyGoal - unallocated);
    }
    for (let index = 0; index < DAYS.length && p2Remaining > 0; index += 1) {
      const dailyRoom = Math.max(0, 120 - manualDailyMinutes.P2[index]);
      if (dailyRoom === 0) continue;
      const before = p2Remaining;
      const requested = Math.min(p2Remaining, dailyRoom);
      const unallocated = allocate(
        index,
        activeP2,
        "PROJECT_P2",
        requested,
        "P2",
        1,
      );
      p2Remaining = before - (requested - unallocated);
    }
  }

  manualEvents
    .filter((event) => event.type === "PROJECT_P3")
    .forEach((manual) => {
      const requestedStart = new Date(manual.start);
      const requestedEnd = new Date(manual.end);
      const duration = minutes(requestedEnd) - minutes(requestedStart);
      const preferredDay = dayIndex(requestedStart);
      if (preferredDay < 0 || preferredDay > 4 || duration <= 0) return;

      const exact = { start: requestedStart, end: requestedEnd };
      let placed: Interval | undefined;
      for (
        let index = preferredDay;
        index < DAYS.length && !placed;
        index += 1
      ) {
        const dailyRoom = 120 - manualDailyMinutes.P3[index];
        if (duration > dailyRoom) continue;
        const earliestStart =
          index === preferredDay
            ? requestedStart
            : atTime(
                new Date(weekStart.getTime() + index * 86_400_000),
                "09:00",
              );
        if (index === preferredDay && claimExact(projectSlots[index], exact)) {
          placed = exact;
          break;
        }
        if (
          index === preferredDay &&
          claimExact(emergencySlotIntervalsByDay[index], exact)
        ) {
          placed = exact;
          break;
        }
        placed = takeAtOrAfter(projectSlots[index], earliestStart, duration);
        if (!placed)
          placed = takeAtOrAfter(
            emergencySlotIntervalsByDay[index],
            earliestStart,
            duration,
          );
      }
      if (!placed) return;

      events.push({
        ...manual,
        start: localDateTime(placed.start),
        end: localDateTime(placed.end),
      });
      const durationMinutes = minutes(placed.end) - minutes(placed.start);
      projectMinutes.P3 += durationMinutes;
      manualDailyMinutes.P3[dayIndex(placed.start)] += durationMinutes;
    });

  const priorityWarnings: ProjectPriority[] = [];
  if (activeP1 && projectMinutes.P1 < 600) priorityWarnings.push("P1");
  if (activeP2 && projectMinutes.P2 < 360) priorityWarnings.push("P2");

  const p3DailyRemaining = DAYS.map((_, index) =>
    Math.max(0, 120 - manualDailyMinutes.P3[index]),
  );
  const p3Total = DAYS.reduce((total, _, index) => {
    const available = [
      ...projectSlots[index],
      ...emergencySlotIntervalsByDay[index],
    ].reduce(
      (dailyTotal, interval) =>
        dailyTotal + minutes(interval.end) - minutes(interval.start),
      0,
    );
    return total + Math.min(available, p3DailyRemaining[index]);
  }, 0);
  const automaticP3Projects = p3Projects.filter(
    (project) => !project.day || !project.startTime || !project.endTime,
  );
  let p3Used = 0;
  (priorityWarnings.length === 0 ? automaticP3Projects : []).forEach(
    (project, projectIndex) => {
      const share =
        projectIndex === automaticP3Projects.length - 1
          ? p3Total - p3Used
          : Math.floor(p3Total / automaticP3Projects.length);
      p3Used += share;
      let remaining = share;
      for (let index = 0; index < DAYS.length && remaining > 0; index += 1) {
        let dailyRemaining = Math.min(remaining, p3DailyRemaining[index]);
        let chunk = 0;
        while (dailyRemaining > 0) {
          const candidate = [
            ...projectSlots[index].map((interval) => ({
              interval,
              slots: projectSlots[index],
            })),
            ...emergencySlotIntervalsByDay[index].map((interval) => ({
              interval,
              slots: emergencySlotIntervalsByDay[index],
            })),
          ].sort(
            (left, right) =>
              left.interval.start.getTime() - right.interval.start.getTime(),
          )[0];
          if (!candidate) break;
          const duration = Math.min(
            dailyRemaining,
            minutes(candidate.interval.end) - minutes(candidate.interval.start),
          );
          const interval = takeAtOrAfter(
            candidate.slots,
            candidate.interval.start,
            duration,
          );
          if (!interval) break;
          events.push(
            makeEvent(
              `auto-${project.id}-${dateKey(interval.start)}-p3-${chunk}`,
              project.name,
              interval,
              "PROJECT_P3",
              { projectId: project.id },
            ),
          );
          chunk += 1;
          projectMinutes.P3 += duration;
          manualDailyMinutes.P3[index] += duration;
          p3DailyRemaining[index] -= duration;
          remaining -= duration;
          dailyRemaining -= duration;
        }
      }
    },
  );

  manualEvents
    .filter((event) => event.type === "CUSTOM")
    .forEach((manual) => {
      const requestedStart = new Date(manual.start);
      const requestedEnd = new Date(manual.end);
      const duration = minutes(requestedEnd) - minutes(requestedStart);
      const preferredDay = dayIndex(requestedStart);
      if (preferredDay < 0 || preferredDay > 4 || duration <= 0) return;

      const exact = { start: requestedStart, end: requestedEnd };
      let placed: Interval | undefined;
      if (claimExact(projectSlots[preferredDay], exact)) placed = exact;
      if (
        !placed &&
        claimExact(emergencySlotIntervalsByDay[preferredDay], exact)
      )
        placed = exact;
      for (
        let index = preferredDay;
        index < DAYS.length && !placed;
        index += 1
      ) {
        const earliest =
          index === preferredDay
            ? requestedStart
            : atTime(
                new Date(weekStart.getTime() + index * 86_400_000),
                "09:00",
              );
        placed = takeAtOrAfter(projectSlots[index], earliest, duration);
        if (!placed)
          placed = takeAtOrAfter(
            emergencySlotIntervalsByDay[index],
            earliest,
            duration,
          );
      }
      if (placed)
        events.push({
          ...manual,
          start: localDateTime(placed.start),
          end: localDateTime(placed.end),
        });
    });

  emergencySlotIntervalsByDay.forEach((intervals, index) => {
    intervals.forEach((interval, part) => {
      availableEmergencySlots.push(
        makeEvent(
          `buffer-${index}-${part}`,
          "Slot urgenze",
          interval,
          "EMERGENCY_SLOT",
          { fixed: false, editable: false },
        ),
      );
      bufferMinutes += minutes(interval.end) - minutes(interval.start);
    });
  });

  void assigned;
  return {
    events: events.sort((a, b) => a.start.localeCompare(b.start)),
    availableEmergencySlots,
    projectMinutes,
    priorityWarnings,
    bufferMinutes,
    emergencyMinutes,
    unscheduledEmergencyMinutes,
  };
}
