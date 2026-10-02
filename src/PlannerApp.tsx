import { useAtom } from 'jotai'
import {
  Activity,
  CalendarDays,
  CalendarPlus,
  ClipboardCheck,
  Layers3,
  RefreshCw,
  ShieldAlert,
  X,
} from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { CustomCalendarView } from './components/CustomCalendarView'
import {
  EmergenciesView,
  MeetingsView,
  ProjectsView,
  RetrospectiveView,
} from './components/ManagementViews'
import {
  EMPTY_WEEK_DATA,
  expireWeeklyMeetings,
  plannerDataAtom,
  type Retrospective,
  savePlannerData,
  type WeekPlannerData,
} from './lib/plannerStorage'
import { buildSchedule } from './lib/scheduleEngine'
import {
  type CalendarEvent,
  DAYS,
  type Emergency,
  type EventType,
  getMonday,
  type Project,
  type ProjectPriority,
  weekKey,
} from './lib/scheduler'

type View =
  | 'calendar'
  | 'projects'
  | 'emergencies'
  | 'meetings'
  | 'retrospective'
const tabs: { id: View; label: string; icon: typeof CalendarDays }[] = [
  { id: 'calendar', label: 'Calendario', icon: CalendarDays },
  { id: 'projects', label: 'Progetti', icon: Layers3 },
  { id: 'emergencies', label: 'Emergenze', icon: ShieldAlert },
  { id: 'meetings', label: 'Riunioni', icon: Activity },
  { id: 'retrospective', label: 'Retrospettiva', icon: ClipboardCheck },
]

function dateTimeLocal(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`
}

function wholeHour(value: string, roundUp = false): string {
  const date = new Date(value)
  const minute = date.getMinutes()
  date.setMinutes(0, 0, 0)
  if (roundUp && minute > 0) date.setHours(date.getHours() + 1)
  return dateTimeLocal(date).slice(0, 16)
}

function eventFromSelection(start: Date, end: Date): CalendarEvent {
  return {
    id: `custom-${crypto.randomUUID()}`,
    title: '',
    start: dateTimeLocal(start),
    end: dateTimeLocal(end),
    type: 'CUSTOM',
    fixed: false,
    editable: true,
  }
}

function plannedP3Events(
  weekStart: Date,
  projects: Project[],
): CalendarEvent[] {
  return projects.flatMap((project) => {
    if (
      project.priority !== 'P3' ||
      !project.day ||
      !project.startTime ||
      !project.endTime
    )
      return []
    const day = new Date(weekStart)
    day.setDate(day.getDate() + DAYS.indexOf(project.day))
    const atTime = (time: string) => {
      const [hour, minute] = time.split(':').map(Number)
      const date = new Date(day)
      date.setHours(hour, minute, 0, 0)
      return dateTimeLocal(date)
    }
    return [
      {
        id: `p3-slot-${project.id}`,
        title: project.name,
        start: atTime(project.startTime),
        end: atTime(project.endTime),
        type: 'PROJECT_P3' as const,
        fixed: false,
        editable: true,
        projectId: project.id,
      },
    ]
  })
}

function nextEventDraft(
  weekStart: Date,
  now: Date,
  events: CalendarEvent[],
): CalendarEvent | null {
  const blockers = events.filter(
    (event) =>
      event.fixed ||
      event.type === 'MEETING' ||
      event.type === 'EMERGENCY' ||
      event.display === 'background',
  )
  for (let dayIndex = 0; dayIndex < 5; dayIndex += 1) {
    const day = new Date(weekStart)
    day.setDate(day.getDate() + dayIndex)
    const closeMinute = dayIndex === 4 ? 16 * 60 : 18 * 60
    const today = day.toDateString() === now.toDateString()
    const nowMinute = now.getHours() * 60 + now.getMinutes()
    const firstMinute = Math.max(
      9 * 60,
      today ? Math.ceil(nowMinute / 15) * 15 : 9 * 60,
    )
    for (let minute = firstMinute; minute + 30 <= closeMinute; minute += 15) {
      const start = new Date(day)
      start.setHours(Math.floor(minute / 60), minute % 60, 0, 0)
      if (start <= now) continue
      const candidate = eventFromSelection(
        start,
        new Date(start.getTime() + 30 * 60_000),
      )
      if (canPlaceEvent(candidate, blockers)) return candidate
    }
  }
  return null
}

function fitInSlot(
  slot: CalendarEvent,
  durationMinutes: number,
  now: Date,
): { start: Date; end: Date } | undefined {
  const slotEnd = new Date(slot.end)
  let start = new Date(slot.start)
  if (start <= now) {
    start = new Date(now)
    start.setSeconds(0, 0)
    start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0)
  }
  const end = new Date(start.getTime() + durationMinutes * 60_000)
  return start > now && end <= slotEnd ? { start, end } : undefined
}

function canPlaceEvent(
  candidate: CalendarEvent,
  existing: CalendarEvent[],
  meetingMayDisplace = false,
  emergencyUsesBuffer = false,
): boolean {
  const start = new Date(candidate.start)
  const end = new Date(candidate.end)
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    start >= end ||
    start.toDateString() !== end.toDateString()
  )
    return false
  const weekday = start.getDay()
  if (weekday === 0 || weekday === 6) return false
  const startMinute = start.getHours() * 60 + start.getMinutes()
  const endMinute = end.getHours() * 60 + end.getMinutes()
  const closing = weekday === 5 ? 16 * 60 : 18 * 60
  if (
    startMinute < 9 * 60 ||
    endMinute > closing ||
    (startMinute < 14 * 60 && endMinute > 13 * 60)
  )
    return false
  const emptyWindow =
    weekday === 1
      ? { start: 14 * 60, end: 14 * 60 + 15 }
      : weekday >= 2 && weekday <= 4
        ? { start: 9 * 60, end: 9 * 60 + 15 }
        : undefined
  if (
    emptyWindow &&
    startMinute < emptyWindow.end &&
    endMinute > emptyWindow.start
  )
    return false

  return !existing.some((event) => {
    if (event.id === candidate.id) return false
    const overlaps = new Date(event.start) < end && new Date(event.end) > start
    if (event.type === 'EMERGENCY_SLOT') return false
    if (event.type === 'GAP') return overlaps
    if (event.display === 'background') return false
    if (meetingMayDisplace && !event.fixed && event.type !== 'MEETING')
      return false
    if (
      emergencyUsesBuffer &&
      (event.type === 'PROJECT_P2' || event.type === 'PROJECT_P3')
    )
      return false
    return overlaps
  })
}

function meetingWarning(event: CalendarEvent): string | undefined {
  const start = new Date(event.start)
  const end = new Date(event.end)
  const overlaps = (from: string, to: string) => {
    const day = new Date(start)
    const [fromHour, fromMinute] = from.split(':').map(Number)
    const [toHour, toMinute] = to.split(':').map(Number)
    const windowStart = new Date(day)
    windowStart.setHours(fromHour, fromMinute, 0, 0)
    const windowEnd = new Date(day)
    windowEnd.setHours(toHour, toMinute, 0, 0)
    return start < windowEnd && end > windowStart
  }
  if (start.getDay() === 3 && overlaps('14:00', '18:00'))
    return 'Il mercoledì dalle 14:00 alle 18:00 è riservato al lavoro senza meeting. Il meeting verrà comunque inserito.'
  if (start.getDay() === 5 && overlaps('09:00', '16:00'))
    return 'Il venerdì è dedicato a formazione e sviluppo P1/P2. Il meeting verrà comunque inserito.'
}

function overlaps(left: CalendarEvent, right: CalendarEvent): boolean {
  return (
    new Date(left.start) < new Date(right.end) &&
    new Date(left.end) > new Date(right.start)
  )
}

function EventEditor({
  event,
  projects,
  onClose,
  onSave,
  onDelete,
}: {
  event: CalendarEvent
  projects: Project[]
  onClose: () => void
  onSave: (event: CalendarEvent) => void
  onDelete: (event: CalendarEvent) => void
}) {
  const [title, setTitle] = useState(event.title)
  const [type, setType] = useState<EventType>(
    event.type === 'EMERGENCY_SLOT' ? 'EMERGENCY' : event.type,
  )
  const [projectId, setProjectId] = useState(event.projectId ?? '')
  const [start, setStart] = useState(event.start.slice(0, 16))
  const [end, setEnd] = useState(event.end.slice(0, 16))
  const startDate = new Date(start)
  const endDate = new Date(end)
  const projectPriority: ProjectPriority | undefined =
    type === 'PROJECT_P1'
      ? 'P1'
      : type === 'PROJECT_P2'
        ? 'P2'
        : type === 'PROJECT_P3'
          ? 'P3'
          : undefined
  const options = projectPriority
    ? projects.filter((project) => project.priority === projectPriority)
    : []
  const selectedProject = options.find((project) => project.id === projectId)
  const wholeHourEmergency =
    type !== 'EMERGENCY' ||
    (startDate.getMinutes() === 0 && endDate.getMinutes() === 0)
  const canSave =
    title.trim().length > 0 &&
    Number.isFinite(startDate.getTime()) &&
    endDate > startDate &&
    wholeHourEmergency &&
    (!projectPriority || Boolean(selectedProject))
  const submit = (formEvent: FormEvent) => {
    formEvent.preventDefault()
    if (!canSave) return
    onSave({
      ...event,
      title: selectedProject?.name ?? title.trim(),
      type,
      projectId: selectedProject?.id,
      fixed: false,
      editable: true,
      start: `${start}:00`,
      end: `${end}:00`,
    })
  }

  return (
    <button
      type="button"
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"
      onMouseDown={(mouseEvent) => {
        if (mouseEvent.target === mouseEvent.currentTarget) onClose()
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-editor-title"
        className="w-full max-w-md border border-slate-700 bg-slate-900 p-5 shadow-2xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="event-editor-title" className="font-semibold text-lg">
            {event.title ? 'Modifica evento' : 'Nuovo evento'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Chiudi"
            className="rounded p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <label className="block text-slate-300 text-sm">
            Tipo di slot
            <select
              aria-label="Tipo di slot"
              value={type}
              onChange={(inputEvent) => {
                const nextType = inputEvent.target.value as EventType
                setType(nextType)
                setProjectId('')
                if (nextType === 'EMERGENCY') {
                  setStart((value) => wholeHour(value))
                  setEnd((value) => wholeHour(value, true))
                }
              }}
              className="mt-1 w-full border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400"
            >
              <option value="PROJECT_P1">Progetto P1</option>
              <option value="PROJECT_P2">Progetto P2</option>
              <option value="PROJECT_P3">Progetto P3</option>
              <option value="EMERGENCY">Emergenza urgente</option>
              <option value="MEETING">Meeting ad alta priorità</option>
              <option value="CUSTOM">Altro</option>
            </select>
          </label>
          {projectPriority ? (
            <label className="block text-slate-300 text-sm">
              Progetto
              <select
                aria-label="Progetto assegnato"
                value={projectId}
                onChange={(inputEvent) => {
                  const project = options.find(
                    (item) => item.id === inputEvent.target.value,
                  )
                  setProjectId(inputEvent.target.value)
                  if (project) setTitle(project.name)
                }}
                className="mt-1 w-full border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400"
              >
                <option value="">Seleziona progetto</option>
                {options.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="block text-slate-300 text-sm">
              Titolo
              <input
                value={title}
                onChange={(inputEvent) => setTitle(inputEvent.target.value)}
                className="mt-1 w-full border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400"
              />
            </label>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-slate-300 text-sm">
              Inizio
              <input
                type="datetime-local"
                step={type === 'EMERGENCY' ? 3600 : 900}
                value={start}
                onChange={(inputEvent) =>
                  setStart(
                    type === 'EMERGENCY'
                      ? wholeHour(inputEvent.target.value)
                      : inputEvent.target.value,
                  )
                }
                className="mt-1 w-full border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-white outline-none focus:border-emerald-400"
              />
            </label>
            <label className="block text-slate-300 text-sm">
              Fine
              <input
                type="datetime-local"
                step={type === 'EMERGENCY' ? 3600 : 900}
                value={end}
                onChange={(inputEvent) =>
                  setEnd(
                    type === 'EMERGENCY'
                      ? wholeHour(inputEvent.target.value, true)
                      : inputEvent.target.value,
                  )
                }
                className="mt-1 w-full border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-white outline-none focus:border-emerald-400"
              />
            </label>
          </div>
          <div className="flex items-center justify-between border-slate-800 border-t pt-4">
            <button
              type="button"
              onClick={() => onDelete(event)}
              className="text-red-300 text-sm hover:text-red-200"
            >
              Elimina
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-2 text-slate-300 text-sm hover:bg-slate-800"
              >
                Annulla
              </button>
              <button
                type="submit"
                disabled={!canSave}
                className="bg-emerald-500 px-4 py-2 font-semibold text-slate-950 text-sm disabled:opacity-40"
              >
                Salva evento
              </button>
            </div>
          </div>
        </form>
      </section>
    </button>
  )
}

export function App() {
  const [plannerData, setPlannerData] = useAtom(plannerDataAtom)
  const [weekStart, setWeekStart] = useState(() => getMonday())
  const [now, setNow] = useState(() => new Date())
  const [activeView, setActiveView] = useState<View>('calendar')
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)
  const [retrospectiveAlertWeek, setRetrospectiveAlertWeek] = useState<
    string | null
  >(null)
  const currentWeekKey = weekKey(weekStart)
  const week = plannerData.weeks[currentWeekKey] ?? EMPTY_WEEK_DATA

  useEffect(() => savePlannerData(plannerData), [plannerData])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(
    () => setPlannerData((current) => expireWeeklyMeetings(current, now)),
    [now, setPlannerData],
  )
  useEffect(() => {
    if (now.getDay() !== 1 || now.getHours() >= 12) return
    const previousWeek = getMonday(now)
    previousWeek.setDate(previousWeek.getDate() - 7)
    const key = weekKey(previousWeek)
    const retrospective = plannerData.weeks[key]?.retrospective
    const hasNotes = Boolean(retrospective?.nextWeek.trim())
    if (hasNotes && plannerData.retrospectiveAlertWeek !== key)
      setRetrospectiveAlertWeek(key)
  }, [now, plannerData.weeks, plannerData.retrospectiveAlertWeek])

  const schedule = useMemo(() => {
    return buildSchedule(weekStart, week.projects, week.emergencies, {
      weeklyBudgets: week.weeklyBudgets,
      meetings: week.meetings,
      manualEvents: [
        ...week.customEvents,
        ...plannedP3Events(weekStart, week.projects),
      ],
      now,
    })
  }, [
    weekStart,
    week.projects,
    week.emergencies,
    week.weeklyBudgets,
    week.meetings,
    week.customEvents,
    now,
  ])
  const calendarEvents = useMemo(
    () =>
      schedule.events
        .filter((event) => !week.deletedEventIds.includes(event.id))
        .map((event) => week.eventOverrides[event.id] ?? event),
    [schedule.events, week.deletedEventIds, week.eventOverrides],
  )

  const updateWeek = (update: (current: WeekPlannerData) => WeekPlannerData) =>
    setPlannerData((current) => ({
      ...current,
      weeks: {
        ...current.weeks,
        [currentWeekKey]: update(
          current.weeks[currentWeekKey] ?? EMPTY_WEEK_DATA,
        ),
      },
    }))

  const handleSaveEvent = (event: CalendarEvent) => {
    const source = schedule.events.find((item) => item.id === event.id)
    const durationMinutes =
      (new Date(event.end).getTime() - new Date(event.start).getTime()) / 60_000
    const sourceMinutes = source
      ? (new Date(source.end).getTime() - new Date(source.start).getTime()) /
      60_000
      : 0
    if (
      event.type !== 'EMERGENCY' &&
      occupiedMinutes - sourceMinutes + durationMinutes > 38 * 60
    ) {
      window.alert(
        'La settimana supera le 38 ore disponibili. Libera spazio prima di aggiungere eventi; le emergenze urgenti restano consentite.',
      )
      return
    }
    const projectLimits = {
      PROJECT_P1: { daily: 240, weekly: 1200 },
      PROJECT_P2: { daily: 120, weekly: 600 },
      PROJECT_P3: { daily: 120, weekly: Number.POSITIVE_INFINITY },
    } as const
    if (event.type in projectLimits) {
      const limit = projectLimits[event.type as keyof typeof projectLimits]
      const projectEvents = calendarEvents.filter(
        (item) => item.type === event.type && item.id !== event.id,
      )
      const dayKey = new Date(event.start).toDateString()
      const minutesOf = (item: CalendarEvent) =>
        (new Date(item.end).getTime() - new Date(item.start).getTime()) / 60_000
      const dailyMinutes = projectEvents
        .filter((item) => new Date(item.start).toDateString() === dayKey)
        .reduce((total, item) => total + minutesOf(item), 0)
      const weeklyMinutes = projectEvents.reduce(
        (total, item) => total + minutesOf(item),
        0,
      )
      if (
        dailyMinutes + durationMinutes > limit.daily ||
        weeklyMinutes + durationMinutes > limit.weekly
      ) {
        window.alert(
          `Il progetto ${event.type.slice(-2)} supererebbe il limite di ${limit.daily / 60} h al giorno${Number.isFinite(limit.weekly) ? ` e ${limit.weekly / 60} h a settimana` : ''}.`,
        )
        return
      }
    }
    const warning = event.type === 'MEETING' ? meetingWarning(event) : undefined
    if (warning) window.alert(warning)
    if (
      event.fixed ||
      new Date(event.start) < now ||
      new Date(event.end) <= now ||
      !canPlaceEvent(
        event,
        [...calendarEvents, ...schedule.availableEmergencySlots],
        event.type === 'MEETING',
        event.type === 'EMERGENCY',
      )
    ) {
      window.alert(
        'Lo slot deve essere futuro, modificabile e rispettare orari e blocchi fissi.',
      )
      return
    }
    updateWeek((current) => {
      const source = schedule.events.find((item) => item.id === event.id)
      if (event.type === 'MEETING') {
        const existing = current.meetings.some((item) => item.id === event.id)
        const id =
          source && !existing ? `meeting-${crypto.randomUUID()}` : event.id
        return {
          ...current,
          meetings: [
            ...current.meetings.filter((item) => item.id !== event.id),
            { ...event, id },
          ],
          customEvents: current.customEvents.filter(
            (item) => item.id !== event.id,
          ),
          emergencies: current.emergencies.filter(
            (item) => item.id !== event.id && item.id !== event.emergencyId,
          ),
          eventOverrides: {},
          deletedEventIds:
            source && !existing
              ? [...new Set([...current.deletedEventIds, event.id])]
              : current.deletedEventIds,
        }
      }
      if (event.type === 'EMERGENCY') {
        const start = new Date(event.start)
        const id =
          event.emergencyId ??
          (source?.type === 'EMERGENCY_SLOT'
            ? `emergency-${crypto.randomUUID()}`
            : event.id)
        const emergency: Emergency = {
          id,
          title: event.title,
          day: DAYS[(start.getDay() + 6) % 7],
          startTime: event.start.slice(11, 16),
          endTime: event.end.slice(11, 16),
          durationMinutes:
            (new Date(event.end).getTime() - start.getTime()) / 60_000,
          status: event.status ?? 'TODO',
        }
        return {
          ...current,
          emergencies: [
            ...current.emergencies.filter(
              (item) => item.id !== id && item.id !== event.id,
            ),
            emergency,
          ],
          meetings: current.meetings.filter((item) => item.id !== event.id),
          customEvents: current.customEvents.filter(
            (item) => item.id !== event.id,
          ),
          deletedEventIds:
            source && source.type !== 'EMERGENCY_SLOT'
              ? [...new Set([...current.deletedEventIds, event.id])]
              : current.deletedEventIds,
        }
      }
      if (event.type === 'PROJECT_P3' && event.projectId) {
        const project = current.projects.find(
          (item) => item.id === event.projectId,
        )
        if (project) {
          const start = new Date(event.start)
          const autoSlot = source && source.id !== `p3-slot-${project.id}`
          return {
            ...current,
            projects: current.projects.map((item) =>
              item.id === project.id
                ? {
                  ...item,
                  day: DAYS[(start.getDay() + 6) % 7],
                  startTime: event.start.slice(11, 16),
                  endTime: event.end.slice(11, 16),
                }
                : item,
            ),
            deletedEventIds: autoSlot
              ? [...new Set([...current.deletedEventIds, event.id])]
              : current.deletedEventIds.filter((id) => id !== event.id),
          }
        }
      }
      const exists = current.customEvents.some((item) => item.id === event.id)
      const id = exists || !source ? event.id : `manual-${crypto.randomUUID()}`
      return {
        ...current,
        customEvents: [
          ...current.customEvents.filter((item) => item.id !== event.id),
          { ...event, id },
        ],
        meetings: current.meetings.filter((item) => item.id !== event.id),
        emergencies: current.emergencies.filter(
          (item) => item.id !== event.id && item.id !== event.emergencyId,
        ),
        eventOverrides: Object.fromEntries(
          Object.entries(current.eventOverrides).filter(
            ([key]) => key !== event.id,
          ),
        ),
        deletedEventIds:
          source && !exists
            ? [...new Set([...current.deletedEventIds, event.id])]
            : current.deletedEventIds,
      }
    })
    setEditingEvent(null)
  }

  const handleDeleteEvent = (event: CalendarEvent) => {
    if (event.fixed || new Date(event.end) <= now) return
    updateWeek((current) => {
      if (current.meetings.some((item) => item.id === event.id))
        return {
          ...current,
          meetings: current.meetings.filter((item) => item.id !== event.id),
        }
      if (event.type === 'EMERGENCY' && event.emergencyId)
        return {
          ...current,
          emergencies: current.emergencies.filter(
            (item) => item.id !== event.emergencyId,
          ),
        }
      if (event.type === 'PROJECT_P3' && event.projectId)
        return {
          ...current,
          projects: current.projects.map((project) =>
            project.id === event.projectId
              ? {
                ...project,
                day: undefined,
                startTime: undefined,
                endTime: undefined,
              }
              : project,
          ),
        }
      if (current.customEvents.some((item) => item.id === event.id))
        return {
          ...current,
          customEvents: current.customEvents.filter(
            (item) => item.id !== event.id,
          ),
        }
      return {
        ...current,
        deletedEventIds: [...new Set([...current.deletedEventIds, event.id])],
        eventOverrides: Object.fromEntries(
          Object.entries(current.eventOverrides).filter(
            ([id]) => id !== event.id,
          ),
        ),
      }
    })
    setEditingEvent(null)
  }

  const saveProjectList = (
    projects: Project[],
    weeklyBudgets = week.weeklyBudgets,
  ) => {
    const addedP3 = projects.filter(
      (project) =>
        project.priority === 'P3' &&
        !week.projects.some((existing) => existing.id === project.id),
    )
    const nextProjects = [...projects]
    const occupied = [
      ...calendarEvents,
      ...schedule.availableEmergencySlots,
    ]
    for (const added of addedP3) {
      let placement: CalendarEvent | undefined
      for (let dayIndex = 0; dayIndex < DAYS.length && !placement; dayIndex += 1) {
        const day = new Date(weekStart)
        day.setDate(day.getDate() + dayIndex)
        const closingMinute = dayIndex === 4 ? 16 * 60 : 18 * 60
        for (let minute = 9 * 60; minute + 60 <= closingMinute; minute += 15) {
          const start = new Date(day)
          start.setHours(Math.floor(minute / 60), minute % 60, 0, 0)
          const end = new Date(start.getTime() + 60 * 60_000)
          const candidate: CalendarEvent = {
            id: `p3-slot-${added.id}`,
            title: added.name,
            start: dateTimeLocal(start),
            end: dateTimeLocal(end),
            type: 'PROJECT_P3',
            fixed: false,
            editable: true,
            projectId: added.id,
          }
          if (
            start > now &&
            canPlaceEvent(candidate, occupied)
          ) {
            placement = candidate
            break
          }
        }
      }
      if (!placement) {
        window.alert('Non è disponibile uno slot P3 di un’ora.')
        return false
      }
      const start = new Date(placement.start)
      occupied.push(placement)
      const index = nextProjects.findIndex((project) => project.id === added.id)
      nextProjects[index] = {
        ...added,
        day: DAYS[(start.getDay() + 6) % 7],
        startTime: placement.start.slice(11, 16),
        endTime: placement.end.slice(11, 16),
      }
    }
    updateWeek((current) => ({
      ...current,
      projects: nextProjects,
      weeklyBudgets,
    }))
    return true
  }
  const saveEmergencyList = (emergencies: Emergency[]) => {
    const added = emergencies.find(
      (item) => !week.emergencies.some((existing) => existing.id === item.id),
    )
    if (!added) {
      updateWeek((current) => ({ ...current, emergencies }))
      return
    }

    const findFit = (slots: CalendarEvent[]) => {
      for (const slot of [...slots].sort((left, right) =>
        left.start.localeCompare(right.start),
      )) {
        const fit = fitInSlot(slot, added.durationMinutes, now)
        if (fit) return fit
      }
      return undefined
    }
    const placement =
      findFit(schedule.availableEmergencySlots) ??
      findFit(
        calendarEvents.filter((event) =>
          ['PROJECT_P2', 'PROJECT_P3'].includes(event.type),
        ),
      )
    if (!placement) {
      window.alert(
        'Nessuno slot futuro può contenere la durata dell’emergenza.',
      )
      return
    }

    const event: CalendarEvent = {
      id: added.id,
      title: added.title,
      start: dateTimeLocal(placement.start),
      end: dateTimeLocal(placement.end),
      type: 'EMERGENCY',
      fixed: false,
      editable: true,
      emergencyId: added.id,
      status: added.status ?? 'TODO',
    }
    const displacedEvent = calendarEvents.find(
      (existing) => existing.type === 'CUSTOM' && overlaps(event, existing),
    )
    let movedEvent: CalendarEvent | undefined
    if (displacedEvent) {
      const shouldMove = window.confirm(
        `L'emergenza si sovrappone a "${displacedEvent.title}". OK: sposta l'evento; Annulla: elimina l'evento.`,
      )
      if (shouldMove) {
        const duration =
          new Date(displacedEvent.end).getTime() -
          new Date(displacedEvent.start).getTime()
        const blockers = calendarEvents.filter(
          (existing) => existing.id !== displacedEvent.id,
        )
        for (
          let dayIndex = 0;
          dayIndex < DAYS.length && !movedEvent;
          dayIndex += 1
        ) {
          const day = new Date(weekStart)
          day.setDate(day.getDate() + dayIndex)
          const closing = dayIndex === 4 ? 16 * 60 : 18 * 60
          for (
            let minute = 9 * 60;
            minute + duration / 60_000 <= closing;
            minute += 15
          ) {
            const start = new Date(day)
            start.setHours(Math.floor(minute / 60), minute % 60, 0, 0)
            const candidate: CalendarEvent = {
              ...displacedEvent,
              start: dateTimeLocal(start),
              end: dateTimeLocal(new Date(start.getTime() + duration)),
            }
            const usesEmergencySlot = schedule.availableEmergencySlots.some(
              (slot) => overlaps(candidate, slot),
            )
            if (
              !usesEmergencySlot &&
              new Date(candidate.start) > now &&
              canPlaceEvent(candidate, blockers)
            ) {
              movedEvent = candidate
              break
            }
          }
        }
        if (!movedEvent) {
          window.alert('Non c’è uno slot libero per spostare l’evento.')
          return
        }
      }
    }
    const blockers = displacedEvent
      ? calendarEvents.filter((existing) => existing.id !== displacedEvent.id)
      : calendarEvents
    if (
      !canPlaceEvent(
        event,
        [...blockers, ...schedule.availableEmergencySlots],
        false,
        true,
      )
    ) {
      window.alert(
        'Il primo slot non è disponibile per vincoli fissi o meeting.',
      )
      return
    }
    const start = new Date(event.start)
    const assigned: Emergency = {
      ...added,
      day: DAYS[(start.getDay() + 6) % 7],
      startTime: event.start.slice(11, 16),
      endTime: event.end.slice(11, 16),
      status: added.status ?? 'TODO',
    }
    updateWeek((current) => ({
      ...current,
      emergencies: [
        ...current.emergencies.filter((item) => item.id !== assigned.id),
        assigned,
      ],
      customEvents: current.customEvents.flatMap((item) => {
        if (item.id !== displacedEvent?.id) return [item]
        return movedEvent ? [movedEvent] : []
      }),
    }))
  }
  const saveMeetingList = (meetings: CalendarEvent[]) => {
    const added = meetings.find(
      (item) => !week.meetings.some((existing) => existing.id === item.id),
    )
    if (
      added &&
      (new Date(added.start) < now ||
        !canPlaceEvent(added, calendarEvents, true))
    ) {
      window.alert(
        'Il meeting deve essere futuro e non può sovrapporsi a un blocco fisso o a un altro meeting.',
      )
      return
    }
    if (added) {
      const durationMinutes =
        (new Date(added.end).getTime() - new Date(added.start).getTime()) /
        60_000
      if (occupiedMinutes + durationMinutes > 38 * 60) {
        window.alert(
          'La settimana supera le 38 ore disponibili. Libera spazio prima di aggiungere altri eventi.',
        )
        return
      }
      const warning = meetingWarning(added)
      if (warning) window.alert(warning)
    }
    updateWeek((current) => ({ ...current, meetings, eventOverrides: {} }))
  }

  const dismissRetrospectiveAlert = () => {
    if (!retrospectiveAlertWeek) return
    setPlannerData((current) => ({
      ...current,
      retrospectiveAlertWeek: retrospectiveAlertWeek,
    }))
    setRetrospectiveAlertWeek(null)
  }

  const weekLabel = `${new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' }).format(weekStart)} – ${new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 4))}`
  const reservedMinutes = schedule.bufferMinutes + schedule.emergencyMinutes
  const meetingMinutes = schedule.events
    .filter((event) => event.type === 'MEETING' || event.type === 'REVIEW')
    .reduce(
      (total, event) =>
        total +
        (new Date(event.end).getTime() - new Date(event.start).getTime()) /
        60_000,
      0,
    )
  const customMinutes = schedule.events
    .filter((event) => event.type === 'CUSTOM')
    .reduce(
      (total, event) =>
        total +
        (new Date(event.end).getTime() - new Date(event.start).getTime()) /
        60_000,
      0,
    )
  const occupiedMinutes =
    schedule.projectMinutes.P1 +
    schedule.projectMinutes.P2 +
    schedule.projectMinutes.P3 +
    schedule.emergencyMinutes +
    meetingMinutes +
    customMinutes
  const freeMinutes = Math.max(0, 38 * 60 - occupiedMinutes)
  const capacityReached = occupiedMinutes >= 38 * 60
  const alertNotes: Retrospective | undefined = retrospectiveAlertWeek
    ? plannerData.weeks[retrospectiveAlertWeek]?.retrospective
    : undefined

  return (
    <div className="flex min-h-screen flex-col bg-[#080d12] text-slate-100">
      <header className="border-slate-800 border-b bg-[#0c1319]">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center border border-emerald-400/50 bg-emerald-400/10 text-emerald-300">
              <CalendarDays size={20} />
            </div>
            <div>
              <h1 className="font-bold text-lg">DevPlanner</h1>
              <p className="text-slate-400 text-xs">
                Pianificazione settimanale · 38 ore
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-slate-400 text-xs">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            Salvataggio locale attivo
          </div>
        </div>
        <nav
          aria-label="Sezioni"
          className="mx-auto flex max-w-[1600px] gap-1 overflow-x-auto px-4 sm:px-6"
        >
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              type="button"
              key={id}
              onClick={() => setActiveView(id)}
              className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm ${activeView === id ? 'border-emerald-400 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
              aria-current={activeView === id ? 'page' : undefined}
            >
              <Icon size={16} />
              {label}
              {id === 'emergencies' && week.emergencies.length > 0 ? (
                <span className="bg-red-500/20 px-1.5 text-red-200 text-xs">
                  {week.emergencies.length}
                </span>
              ) : null}
            </button>
          ))}
        </nav>
      </header>
      <section
        aria-label="Riepilogo carico settimanale"
        className="border-slate-800 border-b bg-[#0b1218]"
      >
        <div className="mx-auto grid max-w-[1600px] grid-cols-2 divide-x divide-slate-800 sm:grid-cols-4 2xl:grid-cols-8">
          <Metric label="Totale" value="38,0 h" tone="text-white" />
          <Metric
            label="Occupate"
            value={hours(occupiedMinutes)}
            tone="text-cyan-300"
          />
          <Metric
            label="Libere"
            value={hours(freeMinutes)}
            tone="text-slate-300"
          />
          <Metric
            label="P1 · settimana"
            value={hours(schedule.projectMinutes.P1)}
            tone="text-rose-300"
          />
          <Metric
            label="P2 · settimana"
            value={hours(schedule.projectMinutes.P2)}
            tone="text-amber-300"
          />
          <Metric
            label="P3 · residuo"
            value={hours(schedule.projectMinutes.P3)}
            tone="text-emerald-300"
          />
          <Metric
            label="Slot urgenze"
            value={hours(reservedMinutes)}
            tone="text-orange-300"
          />
          <Metric
            label="Emergenze inserite"
            value={hours(schedule.emergencyMinutes)}
            tone="text-rose-300"
          />
        </div>
      </section>
      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-4 py-5 sm:px-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-semibold text-emerald-300 text-xs uppercase">
              Settimana selezionata
            </p>
            <h2 className="mt-1 font-semibold text-xl">{weekLabel}</h2>
          </div>
          {activeView === 'calendar' && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                title="Aggiungi un evento al calendario"
                disabled={
                  capacityReached ||
                  !nextEventDraft(weekStart, now, [
                    ...calendarEvents,
                    ...schedule.availableEmergencySlots,
                  ])
                }
                onClick={() => {
                  const draft = nextEventDraft(weekStart, now, [
                    ...calendarEvents,
                    ...schedule.availableEmergencySlots,
                  ])
                  if (draft) setEditingEvent(draft)
                }}
                className="flex items-center gap-2 border border-emerald-400/60 px-3 py-2 text-emerald-200 text-sm hover:bg-emerald-950/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <CalendarPlus size={15} /> Aggiungi evento
              </button>
              <button
                type="button"
                title="Rigenera piano"
                aria-label="Rigenera piano"
                onClick={() => {
                  if (
                    window.confirm(
                      'Rimuovere gli spostamenti manuali e rigenerare gli slot progetto?',
                    )
                  )
                    updateWeek((current) => ({
                      ...current,
                      customEvents: [],
                      eventOverrides: {},
                      deletedEventIds: [],
                    }))
                }}
                className="flex items-center gap-2 border border-slate-700 px-3 py-2 text-slate-200 text-sm hover:border-emerald-400"
              >
                <RefreshCw size={15} /> Rigenera piano
              </button>
            </div>
          )}
        </div>
        {schedule.priorityWarnings.length > 0 && (
          <p
            role="alert"
            className="mb-4 border-amber-400 border-l-2 bg-amber-950/30 px-4 py-3 text-amber-100 text-sm"
          >
            {schedule.priorityWarnings
              .map(
                (priority) =>
                  `${priority} pianificato sotto il minimo di ${priority === 'P1' ? '10 h' : '6 h'}`,
              )
              .join('; ')}
            . Le ore mancanti non vengono assegnate a P3.
          </p>
        )}
        {capacityReached && (
          <p
            role="alert"
            className="mb-4 border-rose-400 border-l-2 bg-rose-950/30 px-4 py-3 text-rose-100 text-sm"
          >
            Hai raggiunto le 38 ore settimanali. Libera spazio prima di inserire
            altri eventi; le emergenze urgenti restano consentite.
          </p>
        )}
        {activeView === 'calendar' && (
          <>
            {schedule.unscheduledEmergencyMinutes > 0 && (
              <p
                role="alert"
                className="mb-4 border-orange-400 border-l-2 bg-orange-950/30 px-4 py-3 text-orange-200 text-sm"
              >
                Restano {hours(schedule.unscheduledEmergencyMinutes)} di
                emergenze fuori dagli orari disponibili.
              </p>
            )}
            <CustomCalendarView
              events={calendarEvents}
              blockedIntervals={schedule.availableEmergencySlots}
              initialDate={weekStart}
              onWeekChange={(date) => setWeekStart(getMonday(date))}
              onSelect={(start, end) =>
                setEditingEvent(eventFromSelection(start, end))
              }
              onEventClick={setEditingEvent}
              onEventChange={handleSaveEvent}
            />
          </>
        )}
        {activeView === 'projects' && (
          <ProjectsView
            projects={week.projects}
            budgets={week.weeklyBudgets}
            onChange={saveProjectList}
          />
        )}
        {activeView === 'emergencies' && (
          <EmergenciesView
            emergencies={week.emergencies}
            onChange={saveEmergencyList}
          />
        )}
        {activeView === 'meetings' && (
          <MeetingsView
            events={schedule.events}
            meetings={week.meetings}
            weekStart={weekStart}
            onChange={saveMeetingList}
          />
        )}
        {activeView === 'retrospective' && (
          <RetrospectiveView
            value={week.retrospective}
            onChange={(retrospective) =>
              updateWeek((current) => ({ ...current, retrospective }))
            }
            events={calendarEvents}
            weekStart={weekStart}
            now={now}
          />
        )}
      </main>
      {editingEvent && (
        <EventEditor
          event={editingEvent}
          projects={week.projects}
          onClose={() => setEditingEvent(null)}
          onSave={handleSaveEvent}
          onDelete={handleDeleteEvent}
        />
      )}
      {alertNotes && retrospectiveAlertWeek && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="monday-reminder-title"
            className="w-full max-w-xl border border-emerald-400/50 bg-slate-900 p-6 shadow-2xl"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-emerald-300 text-xs uppercase">
                  Promemoria del lunedì
                </p>
                <h2
                  id="monday-reminder-title"
                  className="mt-1 font-semibold text-xl"
                >
                  Note della retrospettiva
                </h2>
              </div>
              <button
                type="button"
                onClick={dismissRetrospectiveAlert}
                aria-label="Chiudi promemoria"
                className="rounded p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            {alertNotes.nextWeek && (
              <ReminderNote
                title="Prossima settimana"
                text={alertNotes.nextWeek}
              />
            )}
            <button
              type="button"
              onClick={dismissRetrospectiveAlert}
              className="mt-5 bg-emerald-400 px-4 py-2 font-semibold text-slate-950 text-sm"
            >
              Ho letto le note
            </button>
          </section>
        </div>
      )}
    </div>
  )
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: string
}) {
  return (
    <div className="min-w-0 px-4 py-3 sm:px-5">
      <p className="truncate font-semibold text-[11px] text-slate-500 uppercase">
        {label}
      </p>
      <p className={`mt-1 font-bold text-lg tabular-nums ${tone}`}>{value}</p>
    </div>
  )
}

function ReminderNote({ title, text }: { title: string; text: string }) {
  return (
    <section className="border-slate-800 border-t py-3">
      <h3 className="font-semibold text-slate-400 text-xs uppercase">
        {title}
      </h3>
      <p className="mt-1 whitespace-pre-wrap text-slate-100 text-sm">{text}</p>
    </section>
  )
}

function hours(minutes: number): string {
  return `${(minutes / 60).toFixed(1)} h`
}

export default App
