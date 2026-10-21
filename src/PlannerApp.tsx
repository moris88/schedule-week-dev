import { useAtom } from 'jotai'
import {
	Activity,
	AlertTriangle,
	CalendarDays,
	ClipboardCheck,
	Layers3,
	Plane,
	RefreshCw,
	Settings as SettingsIcon,
	ShieldAlert,
	X,
} from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { CustomCalendarView } from './components/CustomCalendarView'
import {
	AbsencesView,
	DurationSelect,
	EmergenciesView,
	fieldClass,
	MeetingsView,
	ProjectSelect,
	ProjectsView,
	RetrospectiveView,
	SettingsView,
	type SlotRequest,
} from './components/ManagementViews'
import {
	EMPTY_WEEK_DATA,
	expireOldWeeks,
	plannerDataAtom,
	savePlannerData,
	type WeekPlannerData,
} from './lib/plannerStorage'
import {
	displaceCustom,
	findConflicts,
	frameEvents,
	minutesByType,
	placeEmergency,
	placeP3,
	regeneratePlan,
	vacationInterval,
	validateManual,
} from './lib/scheduleEngine'
import {
	addDays,
	atTime,
	type CalendarEvent,
	DAY_NAMES,
	DURATION_OPTIONS,
	durationOf,
	type EventType,
	getMonday,
	localDateTime,
	type Project,
	previousWeekCutoff,
	projectType,
	type Settings,
	TYPE_LABELS,
	weekDays,
	weekKey,
	weekLockTime,
} from './lib/scheduler'

type View =
	| 'calendar'
	| 'projects'
	| 'absences'
	| 'emergencies'
	| 'meetings'
	| 'retrospective'
	| 'settings'
const tabs: { id: View; label: string; icon: typeof CalendarDays }[] = [
	{ id: 'calendar', label: 'Calendario', icon: CalendarDays },
	{ id: 'projects', label: 'Progetti', icon: Layers3 },
	{ id: 'absences', label: 'Permessi e ferie', icon: Plane },
	{ id: 'emergencies', label: 'Emergenze', icon: ShieldAlert },
	{ id: 'meetings', label: 'Meeting', icon: Activity },
	{ id: 'retrospective', label: 'Retrospettiva', icon: ClipboardCheck },
	{ id: 'settings', label: 'Impostazioni', icon: SettingsIcon },
]

const EDITABLE_TYPES: EventType[] = [
	'LEAVE',
	'VACATION',
	'MEETING',
	'EMERGENCY',
	'PROJECT_P1',
	'PROJECT_P2',
	'PROJECT_P3',
	'CUSTOM',
]

const isUserEvent = (event: CalendarEvent) =>
	EDITABLE_TYPES.includes(event.type)

function EventEditor({
	event,
	isNew,
	projects,
	settings,
	weekStart,
	readOnly,
	onClose,
	onSave,
	onDelete,
	onToggleDecline,
}: {
	event: CalendarEvent
	isNew: boolean
	projects: Project[]
	settings: Settings
	weekStart: Date
	readOnly: boolean
	onClose: () => void
	onSave: (event: CalendarEvent) => void
	onDelete: (event: CalendarEvent) => void
	onToggleDecline: (event: CalendarEvent) => void
}) {
	const [title, setTitle] = useState(event.title)
	const [type, setType] = useState<EventType>(event.type)
	const [projectId, setProjectId] = useState(event.projectId ?? '')
	const [day, setDay] = useState(event.start.slice(0, 10))
	const [start, setStart] = useState(event.start.slice(11, 16))
	const [end, setEnd] = useState(event.end.slice(11, 16))
	const [duration, setDuration] = useState(() => {
		const value = durationOf(event)
		return DURATION_OPTIONS.includes(value) ? value : 60
	})
	const fixed = event.type === 'FIXED'
	const days = weekDays(settings, weekStart).filter((item) => !item.holiday)
	const priority =
		type === 'PROJECT_P1'
			? 'P1'
			: type === 'PROJECT_P2'
				? 'P2'
				: type === 'PROJECT_P3'
					? 'P3'
					: undefined
	const options = priority
		? projects.filter((project) => project.priority === priority)
		: []
	const selectedProject = projects.find((project) => project.id === projectId)
	const usesDuration = type === 'EMERGENCY' || type === 'PROJECT_P3'
	const endTime = usesDuration
		? localDateTime(
				new Date(new Date(`${day}T${start}:00`).getTime() + duration * 60_000),
			).slice(11, 16)
		: end
	const canSave =
		!readOnly &&
		(type === 'VACATION' || endTime > start) &&
		(priority
			? Boolean(options.find((item) => item.id === projectId))
			: title.trim().length > 0 || type === 'LEAVE')

	const submit = (formEvent: FormEvent) => {
		formEvent.preventDefault()
		if (!canSave) return
		const date = new Date(`${day}T00:00:00`)
		const interval =
			type === 'VACATION'
				? vacationInterval(settings, date)
				: { start: atTime(date, start), end: atTime(date, endTime) }
		onSave({
			...event,
			title: priority
				? (selectedProject?.name ?? title)
				: title.trim() || TYPE_LABELS[type],
			type,
			projectId:
				priority || type === 'MEETING' ? selectedProject?.id : undefined,
			source: 'manual',
			declined: type === 'MEETING' ? event.declined : undefined,
			start: localDateTime(interval.start),
			end: localDateTime(interval.end),
		})
	}

	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
			<section
				role="dialog"
				aria-modal="true"
				aria-labelledby="event-editor-title"
				className="w-full max-w-md border border-slate-700 bg-slate-900 p-5 shadow-2xl"
			>
				<div className="mb-5 flex items-center justify-between">
					<h2 id="event-editor-title" className="font-semibold text-lg">
						{fixed
							? 'Evento obbligatorio'
							: readOnly
								? 'Dettaglio slot'
								: isNew
									? 'Nuovo slot'
									: 'Modifica slot'}
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
				{fixed ? (
					<div className="space-y-4 text-sm">
						<p>
							<b>{event.title}</b>
							<br />
							<span className="text-slate-400">
								{new Date(event.start).toLocaleDateString('it-IT')} ·{' '}
								{event.start.slice(11, 16)}–{event.end.slice(11, 16)}
							</span>
						</p>
						<p className="text-slate-400 text-xs">
							Gli eventi obbligatori non si cancellano. Rifiutandolo lo slot
							resta a calendario (barrato), viene escluso dal report e puoi
							inserire al suo posto un permesso, un giorno di ferie o un meeting
							importante.
						</p>
						{!readOnly && (
							<button
								type="button"
								onClick={() => onToggleDecline(event)}
								className="bg-amber-400 px-4 py-2 font-semibold text-slate-950 text-sm"
							>
								{event.declined
									? 'Annulla rifiuto (partecipo)'
									: 'Rifiuta (non partecipo)'}
							</button>
						)}
					</div>
				) : (
					<form onSubmit={submit} className="space-y-4">
						<fieldset disabled={readOnly} className="space-y-4">
							<label className="block text-slate-300 text-sm">
								Tipo di slot
								<select
									value={type}
									onChange={(inputEvent) => {
										setType(inputEvent.target.value as EventType)
										setProjectId('')
									}}
									className={`${fieldClass} mt-1`}
								>
									{EDITABLE_TYPES.map((item) => (
										<option key={item} value={item}>
											{item === 'VACATION'
												? 'Ferie (giornata intera)'
												: item === 'CUSTOM'
													? 'Altro'
													: item.startsWith('PROJECT')
														? `Progetto ${TYPE_LABELS[item]}`
														: TYPE_LABELS[item]}
										</option>
									))}
								</select>
							</label>
							{priority ? (
								<label className="block text-slate-300 text-sm">
									Progetto
									<select
										value={projectId}
										onChange={(inputEvent) =>
											setProjectId(inputEvent.target.value)
										}
										className={`${fieldClass} mt-1`}
									>
										<option value="">Seleziona progetto</option>
										{options.map((project) => (
											<option key={project.id} value={project.id}>
												{project.name}
											</option>
										))}
									</select>
									{options.length === 0 && (
										<span className="mt-1 block text-amber-300 text-xs">
											Nessun progetto {priority}: crealo dalla vista Progetti.
										</span>
									)}
								</label>
							) : (
								<>
									<label className="block text-slate-300 text-sm">
										Titolo
										<input
											value={title}
											onChange={(inputEvent) =>
												setTitle(inputEvent.target.value)
											}
											className={`${fieldClass} mt-1`}
										/>
									</label>
									{type === 'MEETING' && (
										<div className="block text-slate-300 text-sm">
											Meeting relativo a
											<ProjectSelect
												projects={projects}
												value={projectId}
												onChange={setProjectId}
											/>
										</div>
									)}
								</>
							)}
							<label className="block text-slate-300 text-sm">
								Giorno
								<select
									value={day}
									onChange={(inputEvent) => setDay(inputEvent.target.value)}
									className={`${fieldClass} mt-1`}
								>
									{days.map((item) => (
										<option key={item.key} value={item.key}>
											{item.name}{' '}
											{item.date.toLocaleDateString('it-IT', {
												day: '2-digit',
												month: 'short',
											})}
										</option>
									))}
								</select>
							</label>
							{type !== 'VACATION' && (
								<div className="grid grid-cols-2 gap-3">
									<label className="block text-slate-300 text-sm">
										Dalle
										<input
											type="time"
											step={900}
											value={start}
											onChange={(inputEvent) =>
												setStart(inputEvent.target.value)
											}
											className={`${fieldClass} mt-1`}
										/>
									</label>
									{usesDuration ? (
										<div className="block text-slate-300 text-sm">
											Durata (max 2 h)
											<DurationSelect value={duration} onChange={setDuration} />
										</div>
									) : (
										<label className="block text-slate-300 text-sm">
											Alle
											<input
												type="time"
												step={900}
												value={end}
												onChange={(inputEvent) =>
													setEnd(inputEvent.target.value)
												}
												className={`${fieldClass} mt-1`}
											/>
										</label>
									)}
								</div>
							)}
						</fieldset>
						<div className="flex items-center justify-between border-slate-800 border-t pt-4">
							<div className="flex gap-3">
								{!isNew && !readOnly && (
									<button
										type="button"
										onClick={() => onDelete(event)}
										className="text-red-300 text-sm hover:text-red-200"
									>
										Elimina
									</button>
								)}
								{!isNew && !readOnly && event.type === 'MEETING' && (
									<button
										type="button"
										onClick={() => onToggleDecline(event)}
										className="text-amber-300 text-sm hover:text-amber-200"
									>
										{event.declined ? 'Partecipo' : 'Rifiuta'}
									</button>
								)}
							</div>
							<div className="flex gap-2">
								<button
									type="button"
									onClick={onClose}
									className="px-3 py-2 text-slate-300 text-sm hover:bg-slate-800"
								>
									Chiudi
								</button>
								{!readOnly && (
									<button
										type="submit"
										disabled={!canSave}
										className="bg-emerald-500 px-4 py-2 font-semibold text-slate-950 text-sm disabled:opacity-40"
									>
										Salva
									</button>
								)}
							</div>
						</div>
					</form>
				)}
			</section>
		</div>
	)
}

export function App() {
	const [plannerData, setPlannerData] = useAtom(plannerDataAtom)
	const [now, setNow] = useState(() => new Date())
	const [weekStart, setWeekStart] = useState(() => getMonday())
	const [activeView, setActiveView] = useState<View>('calendar')
	const [editing, setEditing] = useState<{
		event: CalendarEvent
		isNew: boolean
	} | null>(null)
	const [notices, setNotices] = useState<string[]>([])
	const [reminderWeek, setReminderWeek] = useState<string | null>(null)
	const settings = plannerData.settings
	const currentKey = weekKey(weekStart)
	const week = plannerData.weeks[currentKey] ?? EMPTY_WEEK_DATA

	const currentMonday = getMonday(now)
	const previousMonday = addDays(currentMonday, -7)
	const isCurrentWeek = currentKey === weekKey(currentMonday)
	const canGoPrevious =
		isCurrentWeek && now < previousWeekCutoff(previousMonday)
	const canGoNext = isCurrentWeek
	const lockTime = weekLockTime(settings, weekStart)
	const readOnly = !isCurrentWeek || now >= lockTime
	const readOnlyReason = !isCurrentWeek
		? weekStart > currentMonday
			? 'Settimana successiva: non è possibile pianificarla finché non inizia.'
			: 'Settimana precedente: sola lettura fino a martedì alle 10:00.'
		: now >= lockTime
			? 'Settimana chiusa: le modifiche erano consentite fino alla fine dell’ultimo giorno lavorativo.'
			: undefined

	useEffect(() => savePlannerData(plannerData), [plannerData])
	useEffect(() => {
		const timer = window.setInterval(() => setNow(new Date()), 30_000)
		return () => window.clearInterval(timer)
	}, [])
	useEffect(
		() => setPlannerData((current) => expireOldWeeks(current, now)),
		[now, setPlannerData],
	)
	useEffect(() => {
		const key = weekKey(weekStart)
		const allowed = [weekKey(currentMonday), weekKey(addDays(currentMonday, 7))]
		if (now < previousWeekCutoff(previousMonday))
			allowed.push(weekKey(previousMonday))
		if (!allowed.includes(key)) setWeekStart(currentMonday)
	}, [now, weekStart, currentMonday, previousMonday])
	useEffect(() => {
		if (now.getDay() !== 1 || now.getHours() >= 12) return
		const key = weekKey(previousMonday)
		const previous = plannerData.weeks[key]
		const hasNotes = Boolean(
			previous?.retrospective.nextWeek.trim() || previous?.planAlerts.length,
		)
		if (hasNotes && plannerData.retrospectiveAlertWeek !== key)
			setReminderWeek(key)
	}, [
		now,
		previousMonday,
		plannerData.weeks,
		plannerData.retrospectiveAlertWeek,
	])

	const frame = useMemo(
		() => frameEvents(weekStart, settings, week.declinedFixed),
		[weekStart, settings, week.declinedFixed],
	)
	const allEvents = useMemo(
		() => [...frame, ...week.events],
		[frame, week.events],
	)
	const conflicts = useMemo(() => findConflicts(allEvents), [allEvents])
	const conflictIds = useMemo(
		() =>
			new Set(
				conflicts.flatMap((conflict) => [
					conflict.higher.id,
					conflict.lower.id,
				]),
			),
		[conflicts],
	)

	const notify = (messages: string[]) => {
		if (messages.length) setNotices((current) => [...current, ...messages])
	}
	const updateWeek = (update: (current: WeekPlannerData) => WeekPlannerData) =>
		setPlannerData((current) => ({
			...current,
			weeks: {
				...current.weeks,
				[currentKey]: update(current.weeks[currentKey] ?? EMPTY_WEEK_DATA),
			},
		}))

	/** Salva uno slot rispettando l'orario indicato dall'utente. */
	const saveEvent = (event: CalendarEvent): boolean => {
		if (readOnly) return false
		const normalized =
			event.type === 'VACATION'
				? (() => {
						const interval = vacationInterval(settings, new Date(event.start))
						return {
							...event,
							start: localDateTime(interval.start),
							end: localDateTime(interval.end),
						}
					})()
				: event
		const error = validateManual(normalized, allEvents, settings)
		if (error) {
			window.alert(error)
			return false
		}
		const others = week.events.filter((item) => item.id !== normalized.id)
		const result = displaceCustom(
			normalized,
			[...others, normalized],
			frame,
			settings,
			weekStart,
			now,
		)
		updateWeek((current) => ({ ...current, events: result.events }))
		const newConflicts = findConflicts([...frame, ...result.events]).filter(
			(conflict) =>
				conflict.higher.id === normalized.id ||
				conflict.lower.id === normalized.id,
		)
		notify([
			...result.messages,
			...(newConflicts.length
				? [
						`"${normalized.title}" è in conflitto con ${newConflicts.length} slot: risolvi dal pannello conflitti.`,
					]
				: []),
		])
		setEditing(null)
		return true
	}

	const deleteEvent = (event: CalendarEvent) => {
		if (readOnly || !isUserEvent(event)) return
		updateWeek((current) => ({
			...current,
			events: current.events.filter((item) => item.id !== event.id),
		}))
		setEditing(null)
	}

	const toggleDecline = (event: CalendarEvent) => {
		if (readOnly) return
		if (event.type === 'FIXED')
			updateWeek((current) => ({
				...current,
				declinedFixed: current.declinedFixed.includes(event.id)
					? current.declinedFixed.filter((id) => id !== event.id)
					: [...current.declinedFixed, event.id],
			}))
		else
			updateWeek((current) => ({
				...current,
				events: current.events.map((item) =>
					item.id === event.id ? { ...item, declined: !item.declined } : item,
				),
			}))
		setEditing(null)
	}

	const slotEvent = (
		type: EventType,
		title: string,
		slot: SlotRequest,
		projectId?: string,
	): CalendarEvent => {
		const date = addDays(weekStart, slot.day)
		const interval =
			type === 'VACATION'
				? vacationInterval(settings, date)
				: { start: atTime(date, slot.start), end: atTime(date, slot.end) }
		return {
			id: `${type.toLowerCase()}-${crypto.randomUUID()}`,
			title,
			type,
			source: 'manual',
			projectId,
			start: localDateTime(interval.start),
			end: localDateTime(interval.end),
		}
	}

	const addEmergency = (title: string, duration: number) => {
		if (readOnly) return
		const result = placeEmergency(
			title,
			duration,
			[...frame, ...week.events],
			settings,
			weekStart,
			now,
		)
		updateWeek((current) => ({
			...current,
			events: result.events.filter(
				(event) =>
					!event.display && !frame.some((item) => item.id === event.id),
			),
			retrospective: result.nextWeekAlert
				? {
						nextWeek: [
							current.retrospective.nextWeek.trim(),
							`⚠ ${result.nextWeekAlert}`,
						]
							.filter(Boolean)
							.join('\n'),
					}
				: current.retrospective,
		}))
		if (result.placed)
			notify([
				`Emergenza "${title}" inserita ${DAY_NAMES[(new Date(result.placed.start).getDay() + 6) % 7]} ${result.placed.start.slice(11, 16)}–${result.placed.end.slice(11, 16)}.`,
				...result.messages,
			])
		else window.alert(result.messages.join('\n'))
	}

	const saveProject = (project: Project) => {
		if (readOnly) return
		const existing = week.projects.find((item) => item.id === project.id)
		let newSlot: CalendarEvent | undefined
		if (!existing && project.priority === 'P3') {
			newSlot = placeP3(project, allEvents, settings, weekStart, now)
			if (!newSlot)
				notify([
					`Nessuno spazio libero per lo slot P3 "${project.name}": rimane fuori dal calendario.`,
				])
		}
		updateWeek((current) => ({
			...current,
			projects: existing
				? current.projects.map((item) =>
						item.id === project.id ? project : item,
					)
				: [...current.projects, project],
			events: [
				...current.events.map((event) =>
					event.projectId === project.id &&
					event.type === projectType(project.priority)
						? { ...event, title: project.name }
						: event,
				),
				...(newSlot ? [newSlot] : []),
			],
		}))
		if (!existing && project.priority !== 'P3')
			notify([
				`Progetto ${project.priority} salvato: usa «Rigenera piano» per distribuire gli slot.`,
			])
	}

	const removeProject = (project: Project) => {
		if (readOnly) return
		const dependents = week.projects.filter(
			(item) =>
				(project.priority === 'P1' && item.priority !== 'P1') ||
				(project.priority === 'P2' && item.priority === 'P3'),
		)
		if (
			dependents.length &&
			!window.confirm(
				'Eliminando questo progetto i progetti di priorità inferiore restano attivi. Continuare?',
			)
		)
			return
		updateWeek((current) => ({
			...current,
			projects: current.projects.filter((item) => item.id !== project.id),
			events: current.events
				.filter(
					(event) =>
						!(
							event.projectId === project.id &&
							event.type !== 'MEETING' &&
							new Date(event.end) > now
						),
				)
				.map((event) =>
					event.projectId === project.id && event.type === 'MEETING'
						? { ...event, projectId: undefined }
						: event,
				),
		}))
	}

	const regenerate = () => {
		if (readOnly) return
		const result = regeneratePlan(week, frame, settings, weekStart, now)
		updateWeek((current) => ({
			...current,
			events: result.events,
			planAlerts: result.alerts,
		}))
		notify(
			result.alerts.length
				? result.alerts
				: ['Piano rigenerato: tutti gli slot sono stati inseriti.'],
		)
	}

	const openNew = (start: Date) => {
		const end = new Date(start.getTime() + 30 * 60_000)
		setEditing({
			isNew: true,
			event: {
				id: `custom-${crypto.randomUUID()}`,
				title: '',
				type: 'CUSTOM',
				source: 'manual',
				start: localDateTime(start),
				end: localDateTime(end),
			},
		})
	}
	const openEvent = (event: CalendarEvent) =>
		setEditing({ event, isNew: false })

	const totals = minutesByType(allEvents)
	const occupied = Object.entries(totals)
		.filter(([type]) => type !== 'HOLIDAY')
		.reduce((sum, [, value]) => sum + value, 0)
	const weeklyMinutes = settings.weeklyHours * 60
	const lastDay = weekDays(settings, weekStart).at(-1)
	const reportFrom = lastDay ? atTime(lastDay.date, '09:00') : lockTime
	const showReport = now >= reportFrom && now < previousWeekCutoff(weekStart)
	const reminder = reminderWeek ? plannerData.weeks[reminderWeek] : undefined
	const weekLabel = `${new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' }).format(weekStart)} – ${new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }).format(addDays(weekStart, lastDay?.index ?? 4))}`
	const userEvents = week.events

	return (
		<div className="flex min-h-screen flex-col bg-[#080d12] text-slate-100">
			<header className="border-slate-800 border-b bg-[#0c1319]">
				<div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
					<div className="flex items-center gap-3">
						<div className="grid h-10 w-10 place-items-center border border-emerald-400/50 bg-emerald-400/10 text-emerald-300">
							<CalendarDays size={20} />
						</div>
						<div>
							<h1 className="font-bold text-lg">Week Planner</h1>
							<p className="text-slate-400 text-xs">
								Pianificazione settimanale · {settings.weeklyHours} ore ·{' '}
								{settings.workStart}–{settings.workEnd}
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
							{id === 'calendar' && conflicts.length > 0 && (
								<span className="bg-red-500/30 px-1.5 text-red-200 text-xs">
									{conflicts.length}
								</span>
							)}
						</button>
					))}
				</nav>
			</header>
			<section
				aria-label="Riepilogo carico settimanale"
				className="border-slate-800 border-b bg-[#0b1218]"
			>
				<div className="mx-auto grid max-w-[1600px] grid-cols-2 divide-x divide-slate-800 sm:grid-cols-5 2xl:grid-cols-10">
					<Metric
						label="Totale"
						value={hours(weeklyMinutes)}
						tone="text-white"
					/>
					<Metric
						label="Occupate"
						value={hours(occupied)}
						tone="text-cyan-300"
					/>
					<Metric
						label="Libere"
						value={hours(Math.max(0, weeklyMinutes - occupied))}
						tone="text-slate-300"
					/>
					<Metric
						label="Permessi/Ferie"
						value={hours((totals.LEAVE ?? 0) + (totals.VACATION ?? 0))}
						tone="text-fuchsia-300"
					/>
					<Metric
						label="Meeting"
						value={hours((totals.MEETING ?? 0) + (totals.FIXED ?? 0))}
						tone="text-blue-300"
					/>
					<Metric
						label="Emergenze"
						value={hours(totals.EMERGENCY ?? 0)}
						tone="text-rose-300"
					/>
					<Metric
						label="P1"
						value={hours(totals.PROJECT_P1 ?? 0)}
						tone="text-rose-300"
					/>
					<Metric
						label="P2"
						value={hours(totals.PROJECT_P2 ?? 0)}
						tone="text-amber-300"
					/>
					<Metric
						label="P3"
						value={hours(totals.PROJECT_P3 ?? 0)}
						tone="text-emerald-300"
					/>
					<Metric
						label="Conflitti"
						value={String(conflicts.length)}
						tone={conflicts.length ? 'text-red-400' : 'text-slate-300'}
					/>
				</div>
			</section>
			<main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-4 py-5 sm:px-6">
				<div className="mb-5 flex flex-wrap items-end justify-between gap-3">
					<div>
						<p className="font-semibold text-emerald-300 text-xs uppercase">
							{isCurrentWeek
								? 'Settimana corrente'
								: weekStart > currentMonday
									? 'Settimana successiva'
									: 'Settimana precedente'}
						</p>
						<h2 className="mt-1 font-semibold text-xl">{weekLabel}</h2>
					</div>
					{activeView === 'calendar' && (
						<button
							type="button"
							title="Distribuisce solo gli slot P1, P2, P3 e Altro. Permessi, ferie, meeting ed emergenze non vengono toccati."
							disabled={readOnly}
							onClick={() => {
								if (
									window.confirm(
										'Ridistribuire gli slot automatici P1/P2/P3 e ricollocare gli slot "Altro" in conflitto?',
									)
								)
									regenerate()
							}}
							className="flex items-center gap-2 border border-slate-700 px-3 py-2 text-slate-200 text-sm hover:border-emerald-400 disabled:opacity-40"
						>
							<RefreshCw size={15} /> Rigenera piano
						</button>
					)}
				</div>
				{notices.length > 0 && (
					<div
						role="status"
						className="mb-4 border-sky-400 border-l-2 bg-sky-950/30 px-4 py-3 text-sky-100 text-sm"
					>
						<div className="flex items-start justify-between gap-3">
							<ul className="list-disc space-y-0.5 pl-4">
								{notices.map((notice, index) => (
									<li key={index}>{notice}</li>
								))}
							</ul>
							<button
								type="button"
								aria-label="Chiudi avvisi"
								onClick={() => setNotices([])}
								className="text-sky-300"
							>
								<X size={16} />
							</button>
						</div>
					</div>
				)}
				{conflicts.length > 0 &&
					(activeView === 'calendar' || activeView === 'absences') && (
						<section
							role="alert"
							className="mb-4 border-red-500 border-l-2 bg-red-950/30 px-4 py-3 text-sm"
						>
							<h3 className="mb-2 flex items-center gap-2 font-semibold text-red-200">
								<AlertTriangle size={16} /> {conflicts.length} conflitti da
								risolvere
							</h3>
							<p className="mb-2 text-red-100/70 text-xs">
								Nessuno slot viene modificato automaticamente: modifica, elimina
								o rifiuta uno dei due slot.
							</p>
							<ul className="divide-y divide-red-900/50">
								{conflicts.map((conflict) => (
									<li
										key={conflict.id}
										className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2"
									>
										{[conflict.higher, conflict.lower].map((event, index) => (
											<span key={event.id} className="flex items-center gap-2">
												{index === 1 && <span className="text-red-300">↔</span>}
												<span>
													<b>{TYPE_LABELS[event.type]}</b> {event.title}{' '}
													<span className="text-slate-400 text-xs">
														{new Date(event.start).toLocaleDateString('it-IT', {
															weekday: 'short',
														})}{' '}
														{event.start.slice(11, 16)}–
														{event.end.slice(11, 16)}
													</span>
												</span>
												{!readOnly && isUserEvent(event) && (
													<>
														<button
															type="button"
															className="text-sky-300 text-xs underline"
															onClick={() => openEvent(event)}
														>
															Modifica
														</button>
														<button
															type="button"
															className="text-red-300 text-xs underline"
															onClick={() => deleteEvent(event)}
														>
															Elimina
														</button>
													</>
												)}
												{!readOnly &&
													(event.type === 'FIXED' ||
														event.type === 'MEETING') && (
														<button
															type="button"
															className="text-amber-300 text-xs underline"
															onClick={() => toggleDecline(event)}
														>
															Rifiuta
														</button>
													)}
											</span>
										))}
									</li>
								))}
							</ul>
						</section>
					)}
				{activeView === 'calendar' && (
					<CustomCalendarView
						weekStart={weekStart}
						settings={settings}
						events={allEvents}
						now={now}
						readOnly={readOnly}
						readOnlyReason={readOnlyReason}
						canGoPrevious={canGoPrevious}
						canGoNext={canGoNext}
						conflictIds={conflictIds}
						onWeekChange={(date) => setWeekStart(getMonday(date))}
						onSelect={openNew}
						onEventClick={openEvent}
						onEventMove={saveEvent}
					/>
				)}
				{activeView === 'projects' && (
					<ProjectsView
						projects={week.projects}
						events={userEvents}
						settings={settings}
						readOnly={readOnly}
						onSaveProject={saveProject}
						onRemoveProject={removeProject}
						onAddProjectMeeting={(project, slot) =>
							saveEvent(
								slotEvent(
									'MEETING',
									`Meeting ${project.name}`,
									slot,
									project.id,
								),
							)
						}
						onEdit={openEvent}
						onDelete={deleteEvent}
					/>
				)}
				{activeView === 'absences' && (
					<AbsencesView
						events={userEvents}
						settings={settings}
						readOnly={readOnly}
						onAdd={(type, title, slot) =>
							saveEvent(slotEvent(type, title, slot))
						}
						onEdit={openEvent}
						onDelete={deleteEvent}
					/>
				)}
				{activeView === 'emergencies' && (
					<EmergenciesView
						events={userEvents}
						readOnly={readOnly}
						onAdd={addEmergency}
						onEdit={openEvent}
						onDelete={deleteEvent}
					/>
				)}
				{activeView === 'meetings' && (
					<MeetingsView
						events={allEvents}
						projects={week.projects}
						settings={settings}
						readOnly={readOnly}
						onAdd={(title, projectId, slot) =>
							saveEvent(slotEvent('MEETING', title, slot, projectId))
						}
						onEdit={openEvent}
						onDelete={deleteEvent}
					/>
				)}
				{activeView === 'retrospective' && (
					<RetrospectiveView
						value={week.retrospective}
						onChange={(retrospective) =>
							updateWeek((current) => ({ ...current, retrospective }))
						}
						events={allEvents}
						planAlerts={week.planAlerts}
						showReport={showReport}
						readOnly={!isCurrentWeek && weekStart > currentMonday}
						now={now}
					/>
				)}
				{activeView === 'settings' && (
					<SettingsView
						key={JSON.stringify(settings)}
						settings={settings}
						onChange={(next) => {
							setPlannerData((current) => ({ ...current, settings: next }))
							notify(['Impostazioni salvate.'])
						}}
					/>
				)}
			</main>
			{editing && (
				<EventEditor
					key={editing.event.id}
					event={editing.event}
					isNew={editing.isNew}
					projects={week.projects}
					settings={settings}
					weekStart={weekStart}
					readOnly={readOnly}
					onClose={() => setEditing(null)}
					onSave={saveEvent}
					onDelete={deleteEvent}
					onToggleDecline={toggleDecline}
				/>
			)}
			{reminder && reminderWeek && (
				<div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
					<section
						role="alertdialog"
						aria-modal="true"
						aria-labelledby="monday-reminder-title"
						className="w-full max-w-xl border border-emerald-400/50 bg-slate-900 p-6 shadow-2xl"
					>
						<p className="font-semibold text-emerald-300 text-xs uppercase">
							Promemoria del lunedì
						</p>
						<h2
							id="monday-reminder-title"
							className="mt-1 mb-4 font-semibold text-xl"
						>
							Note della retrospettiva
						</h2>
						{reminder.retrospective.nextWeek && (
							<p className="whitespace-pre-wrap border-slate-800 border-t py-3 text-sm">
								{reminder.retrospective.nextWeek}
							</p>
						)}
						{reminder.planAlerts.length > 0 && (
							<ul className="list-disc border-slate-800 border-t py-3 pl-4 text-amber-200 text-sm">
								{reminder.planAlerts.map((alert) => (
									<li key={alert}>{alert}</li>
								))}
							</ul>
						)}
						<button
							type="button"
							onClick={() => {
								setPlannerData((current) => ({
									...current,
									retrospectiveAlertWeek: reminderWeek,
								}))
								setReminderWeek(null)
							}}
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

function hours(minutes: number): string {
	return `${(minutes / 60).toFixed(1)} h`
}

export default App
