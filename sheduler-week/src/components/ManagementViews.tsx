import { Check, Copy, Plus, Trash2 } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import type { Retrospective } from '../lib/plannerStorage'
import {
  type CalendarEvent,
  DAYS,
  type Emergency,
  getMonday,
  type Project,
  type Weekday,
  weekKey,
} from '../lib/scheduler'

const fieldClass =
  'w-full border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-emerald-400'
const primaryButtonClass =
  'inline-flex items-center justify-center gap-2 bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-300'
const secondaryButtonClass =
  'inline-flex items-center gap-2 border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500 hover:text-white'

function newId() {
  return crypto.randomUUID()
}

export function ProjectsView({
  projects,
  budgets,
  onChange,
}: {
  projects: Project[]
  budgets: { P1: number; P2: number }
  onChange: (
    projects: Project[],
    budgets?: { P1: number; P2: number },
  ) => boolean | undefined
}) {
  const p1 = projects.find((project) => project.priority === 'P1')
  const p2 = projects.find((project) => project.priority === 'P2')
  const [p1Name, setP1Name] = useState(p1?.name ?? '')
  const [p1Description, setP1Description] = useState(p1?.description ?? '')
  const [p2Name, setP2Name] = useState(p2?.name ?? '')
  const [p2Description, setP2Description] = useState(p2?.description ?? '')
  const [p1Hours, setP1Hours] = useState(String(budgets.P1 / 60))
  const [p2Hours, setP2Hours] = useState(String(budgets.P2 / 60))
  const [p3Name, setP3Name] = useState('')
  const [p3Description, setP3Description] = useState('')

  const savePriorities = (event: FormEvent) => {
    event.preventDefault()
    const p3Projects = projects.filter((project) => project.priority === 'P3')
    const next: Project[] = [...p3Projects]
    if (p1Name.trim())
      next.unshift({
        id: p1?.id ?? newId(),
        name: p1Name.trim(),
        description: p1Description.trim(),
        priority: 'P1',
      })
    if (p2Name.trim())
      next.unshift({
        id: p2?.id ?? newId(),
        name: p2Name.trim(),
        description: p2Description.trim(),
        priority: 'P2',
      })
    onChange(next, {
      P1: p1Name.trim()
        ? Math.min(1200, Math.max(600, Math.round(Number(p1Hours) * 60)))
        : 0,
      P2: p2Name.trim()
        ? Math.min(600, Math.max(360, Math.round(Number(p2Hours) * 60)))
        : 0,
    })
  }

  const addP3 = (event: FormEvent) => {
    event.preventDefault()
    if (!p3Name.trim()) return
    const saved = onChange(
      [
        ...projects,
        {
          id: newId(),
          name: p3Name.trim(),
          description: p3Description.trim(),
          priority: 'P3',
        },
      ],
      budgets,
    )
    if (saved === false) return
    setP3Name('')
    setP3Description('')
  }

  const removeP3 = (id: string) =>
    onChange(
      projects.filter((project) => project.id !== id),
      budgets,
    )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 border-slate-800 border-b pb-4">
        <div>
          <h3 className="font-semibold text-lg">Progetti della settimana</h3>
          <p className="mt-1 text-slate-400 text-sm">
            Il budget residuo viene assegnato a P3 dopo P1 e P2.
          </p>
        </div>
        <button
          type="submit"
          form="priority-projects"
          className={primaryButtonClass}
        >
          <Check size={16} /> Salva budget
        </button>
      </div>
      <form
        id="priority-projects"
        onSubmit={savePriorities}
        className="grid gap-5 lg:grid-cols-2"
      >
        <PriorityProjectForm
          priority="P1"
          name={p1Name}
          description={p1Description}
          hours={p1Hours}
          onName={setP1Name}
          onDescription={setP1Description}
          onHours={setP1Hours}
        />
        <PriorityProjectForm
          priority="P2"
          name={p2Name}
          description={p2Description}
          hours={p2Hours}
          onName={setP2Name}
          onDescription={setP2Description}
          onHours={setP2Hours}
        />
      </form>
      <section className="border-slate-800 border-t pt-5">
        <div className="mb-4 flex items-baseline justify-between">
          <div>
            <h4 className="font-semibold text-emerald-300">Progetti P3</h4>
            <p className="mt-1 text-slate-400 text-sm">
              Progetti minori (senza scadenza), piccole attività o compiti
              secondari, refactoring o review di codice oppure formazione o
              esami.
            </p>
          </div>
          <span className="text-slate-500 text-xs">
            {projects.filter((project) => project.priority === 'P3').length}{' '}
            attività
          </span>
        </div>
        <form
          onSubmit={addP3}
          className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_auto_auto]"
        >
          <input
            className={fieldClass}
            value={p3Name}
            onChange={(event) => setP3Name(event.target.value)}
            placeholder="Nome attività"
            aria-label="Nome attività P3"
          />
          <input
            className={fieldClass}
            value={p3Description}
            onChange={(event) => setP3Description(event.target.value)}
            placeholder="Note facoltative"
            aria-label="Note attività P3"
          />
          <span className="self-center text-slate-400 text-sm">
            Durata iniziale: 1 ora
          </span>
          <button className={secondaryButtonClass} type="submit">
            <Plus size={16} /> Aggiungi P3
          </button>
        </form>
        <div className="mt-4 divide-y divide-slate-800 border-slate-800 border-y">
          {projects.filter((project) => project.priority === 'P3').length ===
            0 && (
              <p className="py-5 text-slate-500 text-sm">
                Nessuna attività P3: il residuo sarà assegnato a sviluppo e
                formazione.
              </p>
            )}
          {projects
            .filter((project) => project.priority === 'P3')
            .map((project) => (
              <div
                key={project.id}
                className="flex items-center justify-between gap-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-sm">{project.name}</p>
                  {project.day && project.startTime && project.endTime && (
                    <p className="mt-1 text-emerald-300 text-xs">
                      {project.day} · {project.startTime}–{project.endTime}
                    </p>
                  )}
                  {project.description && (
                    <p className="mt-0.5 truncate text-slate-500 text-xs">
                      {project.description}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  title={`Elimina ${project.name}`}
                  aria-label={`Elimina ${project.name}`}
                  onClick={() => removeP3(project.id)}
                  className="rounded p-2 text-slate-500 hover:bg-red-950/40 hover:text-red-300"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
        </div>
      </section>
    </div>
  )
}

function PriorityProjectForm({
  priority,
  name,
  description,
  hours,
  onName,
  onDescription,
  onHours,
}: {
  priority: 'P1' | 'P2'
  name: string
  description: string
  hours: string
  onName: (value: string) => void
  onDescription: (value: string) => void
  onHours: (value: string) => void
}) {
  const isP1 = priority === 'P1'
  return (
    <section
      className={`border-l-2 ${isP1 ? 'border-rose-400' : 'border-amber-400'} bg-[#0c1319] p-4`}
    >
      <div className="flex items-center justify-between">
        <h4
          className={`font-semibold ${isP1 ? 'text-rose-300' : 'text-amber-300'}`}
        >
          Progetto {priority}
        </h4>
        <span className="text-slate-500 text-xs">
          {isP1
            ? '10-20 h/settimana · max 4 h/giorno'
            : '6-10 h/settimana · max 2 h/giorno'}
        </span>
      </div>
      <small className="my-4 block text-slate-500 text-xs">
        {isP1
          ? 'Progetto prioritario con scadenza imminente.'
          : 'Progetto meno urgente con scadenza settimanale.'}
      </small>
      <label className="mb-3 block font-medium text-slate-400 text-xs">
        Nome progetto
        <input
          className={`${fieldClass} mt-1.5`}
          value={name}
          onChange={(event) => onName(event.target.value)}
          placeholder={isP1 ? 'Es. Integrazione API' : 'Es. Refactor analytics'}
        />
      </label>
      <label className="mb-3 block font-medium text-slate-400 text-xs">
        Budget settimanale (ore)
        <input
          className={`${fieldClass} mt-1.5 max-w-40`}
          type="number"
          min={name.trim() ? (isP1 ? 10 : 6) : 0}
          max={isP1 ? 20 : 10}
          step="0.5"
          value={hours}
          onChange={(event) => onHours(event.target.value)}
        />
      </label>
      <label className="block font-medium text-slate-400 text-xs">
        Descrizione / note
        <textarea
          className={`${fieldClass} mt-1.5 resize-y`}
          rows={3}
          value={description}
          onChange={(event) => onDescription(event.target.value)}
          placeholder="Contesto e scadenze"
        />
      </label>
    </section>
  )
}

export function EmergenciesView({
  emergencies,
  onChange,
}: {
  emergencies: Emergency[]
  onChange: (emergencies: Emergency[]) => void
}) {
  const [title, setTitle] = useState('')
  const [durationHours, setDurationHours] = useState('1')

  const addEmergency = (event: FormEvent) => {
    event.preventDefault()
    const durationMinutes = Number(durationHours) * 60
    if (!title.trim() || durationMinutes <= 0) return
    onChange([
      ...emergencies,
      {
        id: newId(),
        title: title.trim(),
        durationMinutes,
        status: 'TODO',
      },
    ])
    setTitle('')
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h3 className="font-semibold text-lg">Emergenze e fix</h3>
        <p className="mt-1 text-slate-400 text-sm">
          L'app assegna l'emergenza al primo buffer libero; se non basta, sposta
          il primo slot progetto compatibile.
        </p>
      </div>
      <form
        onSubmit={addEmergency}
        className="grid gap-3 border-slate-800 border-y py-5 sm:grid-cols-[1fr_150px_auto]"
      >
        <input
          className={fieldClass}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Descrizione breve"
          aria-label="Descrizione emergenza"
        />
        <label className="relative">
          <input
            className={`${fieldClass} pr-14`}
            type="number"
            min="1"
            max="7"
            step="1"
            value={durationHours}
            onChange={(event) => setDurationHours(event.target.value)}
            aria-label="Durata emergenza in ore"
          />
          <span className="pointer-events-none absolute top-2.5 right-3 text-slate-500 text-xs">
            ore
          </span>
        </label>
        <button className={primaryButtonClass} type="submit">
          <Plus size={16} /> Registra
        </button>
      </form>
      <div className="divide-y divide-slate-800 border-slate-800 border-b">
        {emergencies.length === 0 && (
          <p className="py-6 text-slate-500 text-sm">
            Nessuna emergenza registrata per questa settimana.
          </p>
        )}
        {emergencies.map((emergency) => (
          <div
            key={emergency.id}
            className="flex items-center justify-between gap-4 py-3"
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-sm">{emergency.title}</p>
              <p className="mt-1 text-slate-500 text-xs">
                {emergency.startTime && emergency.endTime
                  ? `${emergency.startTime.slice(0, 5)}–${emergency.endTime.slice(0, 5)}`
                  : `${emergency.durationMinutes / 60} h · in attesa slot`}
              </p>
            </div>
            <div className="flex justify-center gap-2">
              {emergency.status === 'DONE' ? (
                <span className="border border-emerald-700 bg-emerald-950/40 px-2 py-1 font-semibold text-emerald-300 text-xs">
                  DONE
                </span>
              ) : (
                <button
                  type="button"
                  title="Segna emergenza come completata"
                  aria-label={`Segna done ${emergency.title}`}
                  onClick={() =>
                    onChange(
                      emergencies.map((item) =>
                        item.id === emergency.id
                          ? { ...item, status: 'DONE' }
                          : item,
                      ),
                    )
                  }
                  className="rounded p-2 text-emerald-300 hover:bg-emerald-950/40"
                >
                  <Check size={17} />
                </button>
              )}
              <button
                type="button"
                title={`Elimina ${emergency.title}`}
                aria-label={`Elimina ${emergency.title}`}
                onClick={() =>
                  onChange(
                    emergencies.filter((item) => item.id !== emergency.id),
                  )
                }
                className="rounded p-2 text-slate-500 hover:bg-red-950/40 hover:text-red-300"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function MeetingsView({
  events,
  meetings,
  weekStart,
  onChange,
}: {
  events: CalendarEvent[]
  meetings: CalendarEvent[]
  weekStart: Date
  onChange: (meetings: CalendarEvent[]) => void
}) {
  const [title, setTitle] = useState('')
  const [day, setDay] = useState<Weekday>('Lunedì')
  const [startTime, setStartTime] = useState('11:00')
  const [endTime, setEndTime] = useState('12:00')
  const fixedEvents = events.filter(
    (event) =>
      event.type === 'MEETING' ||
      event.type === 'REVIEW' ||
      event.type === 'FOCUS' ||
      event.type === 'BREAK',
  )
  const addMeeting = (formEvent: FormEvent) => {
    formEvent.preventDefault()
    if (!title.trim() || endTime <= startTime) return
    const meetingDate = new Date(weekStart)
    meetingDate.setDate(meetingDate.getDate() + DAYS.indexOf(day))
    const dateTime = (time: string) =>
      `${meetingDate.getFullYear()}-${String(meetingDate.getMonth() + 1).padStart(2, '0')}-${String(meetingDate.getDate()).padStart(2, '0')}T${time}:00`
    onChange([
      ...meetings,
      {
        id: newId(),
        title: title.trim(),
        start: dateTime(startTime),
        end: dateTime(endTime),
        type: 'MEETING',
        fixed: false,
        editable: true,
      },
    ])
    setTitle('')
  }
  return (
    <div className="max-w-4xl">
      <div className="mb-4">
        <h3 className="font-semibold text-lg">Meeting e blocchi ricorrenti</h3>
        <p className="mt-1 text-slate-400 text-sm">
          I meeting aggiunti qui hanno priorità su emergenze e progetti.
        </p>
      </div>
      <form
        onSubmit={addMeeting}
        className="grid gap-3 border-slate-800 border-y py-5 sm:grid-cols-[1fr_140px_120px_120px_auto]"
      >
        <input
          className={fieldClass}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Titolo meeting"
          aria-label="Titolo meeting"
        />
        <select
          className={fieldClass}
          value={day}
          onChange={(event) => setDay(event.target.value as Weekday)}
          aria-label="Giorno meeting"
        >
          {DAYS.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <input
          className={fieldClass}
          type="time"
          step="900"
          value={startTime}
          onChange={(event) => setStartTime(event.target.value)}
          aria-label="Ora inizio meeting"
        />
        <input
          className={fieldClass}
          type="time"
          step="900"
          value={endTime}
          onChange={(event) => setEndTime(event.target.value)}
          aria-label="Ora fine meeting"
        />
        <button className={primaryButtonClass} type="submit">
          <Plus size={16} /> Aggiungi
        </button>
      </form>
      {meetings.length > 0 && (
        <div className="divide-y divide-slate-800 border-slate-800 border-b">
          <p className="py-3 font-semibold text-cyan-300 text-xs uppercase">
            Meeting inseriti
          </p>
          {meetings.map((meeting) => (
            <div
              key={meeting.id}
              className="flex items-center justify-between gap-3 py-2"
            >
              <p className="text-sm">
                {meeting.title}
                <span className="ml-2 text-slate-500 text-xs">
                  {DAYS[(new Date(meeting.start).getDay() + 6) % 7]} ·{' '}
                  {meeting.start.slice(11, 16)}–{meeting.end.slice(11, 16)}
                </span>
              </p>
              <button
                type="button"
                className="text-slate-500 text-xs hover:text-rose-300"
                onClick={() =>
                  onChange(meetings.filter((item) => item.id !== meeting.id))
                }
              >
                Rimuovi
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="divide-y divide-slate-800 border-slate-800 border-y">
        {fixedEvents.map((event) => (
          <div
            key={event.id}
            className="grid grid-cols-[130px_1fr] gap-4 py-3 sm:grid-cols-[170px_1fr_120px]"
          >
            <span className="font-mono text-slate-400 text-xs">
              {DAYS[(new Date(event.start).getDay() + 6) % 7]} ·{' '}
              {event.start.slice(11, 16)}–{event.end.slice(11, 16)}
            </span>
            <span className="text-sm">{event.title}</span>
            <span className="hidden text-right text-slate-500 text-xs sm:block">
              {event.type === 'FOCUS'
                ? 'No call'
                : event.type === 'BREAK'
                  ? 'Pausa'
                  : 'Fisso'}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-6 grid gap-4 text-slate-400 text-sm sm:grid-cols-2">
        <p>
          Orario lavorativo: lunedì–giovedì 09:00–18:00, venerdì 09:00–16:00.
        </p>
        <p>
          Pausa pranzo: tutti i giorni 13:00–14:00. Buffer: 90 min
          lunedì–giovedì, 60 min venerdì.
        </p>
      </div>
    </div>
  )
}

export function RetrospectiveView({
  value,
  onChange,
  events,
  weekStart,
  now,
}: {
  value: Retrospective
  onChange: (value: Retrospective) => void
  events: CalendarEvent[]
  weekStart: Date
  now: Date
}) {
  const [copied, setCopied] = useState(false)
  const retroStart = new Date(weekStart)
  retroStart.setDate(retroStart.getDate() + 4)
  retroStart.setHours(15, 30, 0, 0)
  const showReport =
    weekKey(getMonday(weekStart)) === weekKey(getMonday(now)) &&
    now >= retroStart
  const completed = events
    .filter(
      (event) =>
        (event.status === 'DONE' || new Date(event.end) <= now) &&
        [
          'MEETING',
          'REVIEW',
          'PROJECT_P1',
          'PROJECT_P2',
          'PROJECT_P3',
          'EMERGENCY',
          'CUSTOM',
        ].includes(event.type),
    )
    .sort((left, right) => left.start.localeCompare(right.start))
  const reportLine = (event: CalendarEvent) => {
    const start = new Date(event.start)
    const weekday = DAYS[(start.getDay() + 6) % 7]
    const date = start.toLocaleDateString('it-IT', {
      day: '2-digit',
      month: '2-digit',
    })
    return `${weekday} ${date} ${event.start.slice(11, 16)}-${event.end.slice(11, 16)} | ${event.title}`
  }
  const meetings = completed.filter(
    (event) => event.type === 'MEETING' || event.type === 'REVIEW',
  )
  const tasks = completed.filter(
    (event) => event.type !== 'MEETING' && event.type !== 'REVIEW',
  )
  const reportText = [
    'MEETING E CALL',
    ...meetings.map(reportLine),
    '',
    'TASK COMPLETATI',
    ...tasks.map(reportLine),
  ].join('\n')
  const copyReport = async () => {
    await navigator.clipboard.writeText(reportText)
    setCopied(true)
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h3 className="font-semibold text-lg">Retrospettiva settimanale</h3>
        <p className="mt-1 text-slate-400 text-sm">
          La nota viene salvata in locale e richiamata il lunedì mattina.
        </p>
      </div>
      <RetrospectiveField
        label="Nota per la prossima settimana"
        value={value.nextWeek}
        onChange={(nextWeek) => onChange({ ...value, nextWeek })}
        placeholder="Priorità e promemoria per lunedì"
      />
      {showReport && (
        <section
          aria-label="Report attività settimana"
          className="border-slate-800 border-y py-5"
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="font-semibold">Report settimanale</h4>
              <p className="mt-1 text-slate-500 text-xs">
                Eventi conclusi con orari · aggiornato alle{' '}
                {now.toLocaleTimeString('it-IT', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
            <button
              type="button"
              onClick={copyReport}
              className={secondaryButtonClass}
            >
              <Copy size={15} />
              {copied ? 'Copiato' : 'Copia report'}
            </button>
          </div>
          <h5 className="mb-2 font-semibold text-cyan-300 text-xs uppercase">
            Meeting e call
          </h5>
          {meetings.length ? (
            <ul className="mb-5 space-y-1">
              {meetings.map((event) => (
                <li key={event.id} className="font-mono text-slate-300 text-xs">
                  {reportLine(event)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-5 text-slate-500 text-xs">
              Nessun meeting concluso.
            </p>
          )}
          <h5 className="mb-2 font-semibold text-emerald-300 text-xs uppercase">
            Task completati
          </h5>
          {tasks.length ? (
            <ul className="space-y-1">
              {tasks.map((event) => (
                <li key={event.id} className="font-mono text-slate-300 text-xs">
                  {reportLine(event)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-slate-500 text-xs">Nessun task concluso.</p>
          )}
        </section>
      )}
    </div>
  )
}

function RetrospectiveField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <label className="block font-medium text-slate-300 text-sm">
      {label}
      <textarea
        className={`${fieldClass} mt-1.5 resize-y`}
        rows={4}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  )
}
