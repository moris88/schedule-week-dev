import {
	ChevronLeft,
	ChevronRight,
	GripVertical,
	Lock,
	Plus,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { CalendarEvent } from '../lib/scheduler'

interface CalendarViewProps {
	events: CalendarEvent[]
	blockedIntervals: CalendarEvent[]
	initialDate: Date
	onWeekChange: (date: Date) => void
	onSelect: (start: Date, end: Date) => void
	onEventClick: (event: CalendarEvent) => void
	onEventChange: (event: CalendarEvent) => void
}

const DAY_NAMES = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì']
const START_MINUTES = 9 * 60
const SLOT_MINUTES = 15
const SLOT_HEIGHT = 30
const TOTAL_SLOTS = 36

const eventClasses: Record<CalendarEvent['type'], string> = {
	MEETING: 'schedule-event--meeting',
	FOCUS: 'schedule-event--focus',
	BREAK: 'schedule-event--break',
	REVIEW: 'schedule-event--review',
	FIX_BUFFER: 'schedule-event--buffer',
	EMERGENCY_SLOT: 'schedule-event--emergency-slot',
	GAP: 'schedule-event--gap',
	EMERGENCY: 'schedule-event--emergency',
	PROJECT_P1: 'schedule-event--p1',
	PROJECT_P2: 'schedule-event--p2',
	PROJECT_P3: 'schedule-event--p3',
	CUSTOM: 'schedule-event--custom',
}

function dateKey(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, '0')
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function startOfDay(date: Date): Date {
	const result = new Date(date)
	result.setHours(0, 0, 0, 0)
	return result
}

function minutesIntoDay(value: string): number {
	const date = new Date(value)
	return date.getHours() * 60 + date.getMinutes()
}

function addMinutes(date: Date, minutes: number): Date {
	return new Date(date.getTime() + minutes * 60_000)
}

function timeLabel(date: Date): string {
	return date.toLocaleTimeString('it-IT', {
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	})
}

function isComplete(event: CalendarEvent, now: Date): boolean {
	return (
		event.status === 'DONE' || new Date(event.end).getTime() <= now.getTime()
	)
}

function localDateTime(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, '0')
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`
}

export function CustomCalendarView({
	events,
	blockedIntervals,
	initialDate,
	onWeekChange,
	onSelect,
	onEventClick,
	onEventChange,
}: CalendarViewProps) {
	const [now, setNow] = useState(() => new Date())
	const [draggedId, setDraggedId] = useState<string | null>(null)

	useEffect(() => {
		const timer = window.setInterval(() => setNow(new Date()), 30_000)
		return () => window.clearInterval(timer)
	}, [])

	const days = DAY_NAMES.map((name, index) => {
		const date = startOfDay(initialDate)
		date.setDate(date.getDate() + index)
		return { name, date, key: dateKey(date) }
	})
	const visibleEvents = events.filter((event) =>
		days.some((day) => dateKey(new Date(event.start)) === day.key),
	)
	const moveWeek = (amount: number) => {
		const next = new Date(initialDate)
		next.setDate(next.getDate() + amount * 7)
		onWeekChange(next)
	}

	const moveEventTo = (
		event: CalendarEvent,
		day: Date,
		minuteOfDay: number,
	) => {
		if (!event.editable || event.fixed || isComplete(event, now)) return
		const duration =
			new Date(event.end).getTime() - new Date(event.start).getTime()
		const nextStart = new Date(day)
		nextStart.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0)
		const nextEnd = new Date(nextStart.getTime() + duration)
		onEventChange({
			...event,
			start: localDateTime(nextStart),
			end: localDateTime(nextEnd),
		})
	}

	return (
		<section
			aria-label="Calendario settimanale"
			className="min-w-0 border border-slate-800 bg-[#0c1319]"
		>
			<header className="flex flex-wrap items-center justify-between gap-3 border-slate-800 border-b px-3 py-3 sm:px-5">
				<div className="flex items-center gap-1">
					<button
						type="button"
						aria-label="Settimana precedente"
						title="Settimana precedente"
						onClick={() => moveWeek(-1)}
						className="schedule-nav-button"
					>
						<ChevronLeft size={18} />
					</button>
					<button
						type="button"
						onClick={() => onWeekChange(getMonday(new Date()))}
						className="schedule-today-button"
					>
						Oggi
					</button>
					<button
						type="button"
						aria-label="Settimana successiva"
						title="Settimana successiva"
						onClick={() => moveWeek(1)}
						className="schedule-nav-button"
					>
						<ChevronRight size={18} />
					</button>
					<h3 className="ml-3 font-semibold text-slate-200 text-sm">
						{new Intl.DateTimeFormat('it-IT', {
							month: 'long',
							year: 'numeric',
						}).format(initialDate)}
					</h3>
				</div>
				<p className="text-slate-500 text-xs">
					<span className="hidden sm:inline">
						Seleziona uno spazio libero per aggiungere uno slot.{' '}
					</span>
					Trascina gli eventi futuri per spostarli.
				</p>
			</header>

			<div className="overflow-x-auto overflow-y-hidden">
				<div
					className="schedule-grid"
					style={{ gridTemplateColumns: '64px repeat(5, minmax(142px, 1fr))' }}
				>
					<div className="schedule-corner" />
					{days.map(({ name, date, key }) => (
						<div
							key={key}
							className={`schedule-day-heading ${key === dateKey(now) ? 'schedule-day-heading--today' : ''}`}
						>
							<span>{name}</span>
							<time dateTime={key}>
								{date.toLocaleDateString('it-IT', {
									day: '2-digit',
									month: 'short',
								})}
							</time>
						</div>
					))}
					<div
						className="schedule-time-axis"
						style={{ height: TOTAL_SLOTS * SLOT_HEIGHT }}
					>
						{Array.from({ length: TOTAL_SLOTS / 2 + 1 }, (_, index) => (
							<span key={index} style={{ top: index * SLOT_HEIGHT * 2 - 8 }}>
								{timeLabel(
									new Date(2000, 0, 1, 9 + index / 2, (index % 2) * 30),
								)}
							</span>
						))}
					</div>
					{days.map(({ name, date, key }) => {
						const dayEvents = visibleEvents.filter(
							(event) => dateKey(new Date(event.start)) === key,
						)
						const dayBlockedIntervals = blockedIntervals.filter(
							(event) => dateKey(new Date(event.start)) === key,
						)
						const closeMinutes = name === 'Venerdì' ? 16 * 60 : 18 * 60
						return (
							<button
								type="button"
								key={key}
								aria-label={`Calendario ${name}`}
								className="schedule-day-column"
								style={{ height: TOTAL_SLOTS * SLOT_HEIGHT }}
								onDragOver={(event) => event.preventDefault()}
								onDrop={(event) => {
									event.preventDefault()
									const id =
										event.dataTransfer.getData('text/plain') || draggedId
									const moving = visibleEvents.find((item) => item.id === id)
									if (!moving) return
									const bounds = event.currentTarget.getBoundingClientRect()
									const index = Math.max(
										0,
										Math.min(
											TOTAL_SLOTS - 1,
											Math.floor((event.clientY - bounds.top) / SLOT_HEIGHT),
										),
									)
									moveEventTo(
										moving,
										date,
										START_MINUTES + index * SLOT_MINUTES,
									)
									setDraggedId(null)
								}}
							>
								{Array.from({ length: TOTAL_SLOTS }, (_, index) => {
									const minute = START_MINUTES + index * SLOT_MINUTES
									const startsAt = new Date(date)
									startsAt.setHours(Math.floor(minute / 60), minute % 60, 0, 0)
									const endsAt = addMinutes(startsAt, SLOT_MINUTES)
									const unavailable =
										minute >= closeMinutes ||
										(minute < 14 * 60 && minute + SLOT_MINUTES > 13 * 60) ||
										dayBlockedIntervals.some(
											(event) =>
												event.type !== 'EMERGENCY_SLOT' &&
												new Date(event.start) < endsAt &&
												new Date(event.end) > startsAt,
										) ||
										dayEvents.some(
											(item) =>
												(item.type === 'GAP' ||
													(item.fixed && item.display !== 'background')) &&
												new Date(item.start) < endsAt &&
												new Date(item.end) > startsAt,
										)
									return (
										<button
											key={minute}
											type="button"
											disabled={unavailable || startsAt < now}
											aria-label={`${name} ${timeLabel(startsAt)}: ${unavailable ? 'non disponibile' : 'aggiungi slot'}`}
											className={`schedule-cell ${minute % 60 === 0 ? 'schedule-cell--hour' : ''} ${unavailable ? 'schedule-cell--blocked' : ''}`}
											style={{ top: index * SLOT_HEIGHT, height: SLOT_HEIGHT }}
											onClick={() =>
												onSelect(startsAt, addMinutes(startsAt, 30))
											}
										>
											{!unavailable && startsAt >= now && (
												<Plus className="schedule-cell-plus" size={13} />
											)}
										</button>
									)
								})}
								{dayEvents.map((event) => {
									const startMinute = minutesIntoDay(event.start)
									const endMinute = minutesIntoDay(event.end)
									const top = Math.max(
										0,
										((startMinute - START_MINUTES) / SLOT_MINUTES) *
											SLOT_HEIGHT,
									)
									const height = Math.max(
										SLOT_HEIGHT,
										((endMinute - startMinute) / SLOT_MINUTES) * SLOT_HEIGHT,
									)
									const complete = isComplete(event, now)
									const inProgress =
										!complete &&
										(event.status === 'IN_PROGRESS' ||
											new Date(event.start).getTime() <= now.getTime())
									const blinking =
										!complete &&
										(event.type === 'EMERGENCY' ||
											event.type === 'EMERGENCY_SLOT')
									const background = event.display === 'background'
									const movable = event.editable && !event.fixed && !complete
									const locked = event.fixed || !event.editable
									return (
										<button
											type="button"
											key={event.id}
											className={`schedule-event ${eventClasses[event.type]} ${background ? 'schedule-event--background' : ''} ${complete ? 'schedule-event--complete' : ''} ${blinking ? 'schedule-event--urgent-blink' : ''} ${movable ? 'schedule-event--movable' : ''}`}
											style={{ top, height, zIndex: background ? 1 : 3 }}
											draggable={movable}
											onDragStart={(dragEvent) => {
												if (!movable) {
													dragEvent.preventDefault()
													return
												}
												setDraggedId(event.id)
												dragEvent.dataTransfer.setData('text/plain', event.id)
												dragEvent.dataTransfer.effectAllowed = 'move'
											}}
											onDragEnd={() => setDraggedId(null)}
											onClick={() => movable && onEventClick(event)}
											title={`${event.title} · ${timeLabel(new Date(event.start))}–${timeLabel(new Date(event.end))}${complete ? ' · Done' : inProgress ? ' · In corso' : ' · Todo'}`}
										>
											{!background && (
												<>
													<div className="schedule-event-topline">
														<span className="schedule-event-time">
															{timeLabel(new Date(event.start))}–
															{timeLabel(new Date(event.end))}
														</span>
														{locked ? (
															<Lock size={11} aria-label="Bloccato" />
														) : (
															<GripVertical
																size={12}
																aria-label="Trascina per spostare"
															/>
														)}
													</div>
													<span className="schedule-event-title">
														{event.title} ({event.type})
													</span>
													<span className="schedule-event-badge">
														{complete
															? 'DONE'
															: inProgress &&
																	(event.type === 'EMERGENCY' ||
																		event.type === 'EMERGENCY_SLOT')
																? 'IN CORSO'
																: 'TODO'}
													</span>
												</>
											)}
											{background && (
												<span className="schedule-background-label">
													{event.title}
												</span>
											)}
										</button>
									)
								})}
							</button>
						)
					})}
				</div>
			</div>
			<footer className="flex flex-wrap gap-x-5 gap-y-2 border-slate-800 border-t px-4 py-3 text-[11px] text-slate-400">
				<Legend color="event-color-p1" label="P1" />
				<Legend color="event-color-p2" label="P2" />
				<Legend color="event-color-p3" label="P3" />
				<Legend color="event-color-meeting" label="Meeting" />
				<Legend color="event-color-emergency" label="Emergenza" />
				<span className="ml-auto">
					Gli slot conclusi e i blocchi fissi sono bloccati.
				</span>
			</footer>
		</section>
	)
}

function getMonday(date: Date): Date {
	const monday = new Date(date)
	monday.setHours(0, 0, 0, 0)
	monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
	return monday
}

function Legend({ color, label }: { color: string; label: string }) {
	return (
		<span className="inline-flex items-center gap-2">
			<span className={`h-2.5 w-2.5 ${color}`} />
			{label}
		</span>
	)
}
