import {
	Ban,
	ChevronLeft,
	ChevronRight,
	GripVertical,
	Lock,
	Plus,
} from 'lucide-react'
import { useState } from 'react'
import {
	addDays,
	type CalendarEvent,
	dateKey,
	dayEnd,
	type EventType,
	localDateTime,
	type Settings,
	TYPE_LABELS,
	toMinutes,
	weekDays,
} from '../lib/scheduler'

interface CalendarViewProps {
	weekStart: Date
	settings: Settings
	events: CalendarEvent[]
	now: Date
	readOnly: boolean
	readOnlyReason?: string
	canGoPrevious: boolean
	canGoNext: boolean
	conflictIds: Set<string>
	onWeekChange: (date: Date) => void
	onSelect: (start: Date) => void
	onEventClick: (event: CalendarEvent) => void
	onEventMove: (event: CalendarEvent) => void
}

const SLOT_MINUTES = 15
const SLOT_HEIGHT = 30

export const eventClasses: Record<EventType, string> = {
	VACATION: 'schedule-event--vacation',
	LEAVE: 'schedule-event--leave',
	HOLIDAY: 'schedule-event--holiday',
	FIXED: 'schedule-event--fixed',
	MEETING: 'schedule-event--meeting',
	EMERGENCY: 'schedule-event--emergency',
	PROJECT_P1: 'schedule-event--p1',
	PROJECT_P2: 'schedule-event--p2',
	PROJECT_P3: 'schedule-event--p3',
	CUSTOM: 'schedule-event--custom',
	BREAK: 'schedule-event--break',
	SETUP: 'schedule-event--gap',
}

function minutesIntoDay(value: string): number {
	const date = new Date(value)
	return date.getHours() * 60 + date.getMinutes()
}

function timeLabel(date: Date): string {
	return date.toLocaleTimeString('it-IT', {
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	})
}

/** Assegna una colonna a ogni evento sovrapposto, così i conflitti restano visibili. */
function layoutLanes(events: CalendarEvent[]) {
	const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start))
	const lanes: string[] = []
	const result = new Map<string, { lane: number; lanes: number }>()
	let group: CalendarEvent[] = []
	let groupEnd = ''
	const flush = () => {
		const count = Math.max(
			1,
			...group.map((event) => (result.get(event.id)?.lane ?? 0) + 1),
		)
		for (const event of group) {
			const entry = result.get(event.id)
			if (entry) entry.lanes = count
		}
		group = []
		lanes.length = 0
	}
	for (const event of sorted) {
		if (group.length && event.start >= groupEnd) flush()
		let lane = lanes.findIndex((end) => end <= event.start)
		if (lane < 0) {
			lane = lanes.length
			lanes.push(event.end)
		} else lanes[lane] = event.end
		result.set(event.id, { lane, lanes: 1 })
		group.push(event)
		groupEnd = group.length === 1 || event.end > groupEnd ? event.end : groupEnd
	}
	flush()
	return result
}

export function CustomCalendarView({
	weekStart,
	settings,
	events,
	now,
	readOnly,
	readOnlyReason,
	canGoPrevious,
	canGoNext,
	conflictIds,
	onWeekChange,
	onSelect,
	onEventClick,
	onEventMove,
}: CalendarViewProps) {
	const [draggedId, setDraggedId] = useState<string | null>(null)
	const startMinutes = toMinutes(settings.workStart)
	const endMinutes = toMinutes(settings.workEnd)
	const totalSlots = Math.max(
		1,
		Math.ceil((endMinutes - startMinutes) / SLOT_MINUTES),
	)
	const days = weekDays(settings, weekStart)

	const isEditable = (event: CalendarEvent) =>
		!readOnly && !event.display && event.type !== 'FIXED'

	const moveEventTo = (
		event: CalendarEvent,
		day: Date,
		minuteOfDay: number,
	) => {
		if (!isEditable(event) || event.type === 'VACATION') return
		const duration =
			new Date(event.end).getTime() - new Date(event.start).getTime()
		const nextStart = new Date(day)
		nextStart.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0)
		onEventMove({
			...event,
			source: 'manual',
			start: localDateTime(nextStart),
			end: localDateTime(new Date(nextStart.getTime() + duration)),
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
						title={
							canGoPrevious
								? 'Settimana precedente (sola lettura)'
								: 'La settimana precedente non è più disponibile'
						}
						disabled={!canGoPrevious}
						onClick={() => onWeekChange(addDays(weekStart, -7))}
						className="schedule-nav-button disabled:opacity-30"
					>
						<ChevronLeft size={18} />
					</button>
					<button
						type="button"
						onClick={() => onWeekChange(now)}
						className="schedule-today-button"
					>
						Oggi
					</button>
					<button
						type="button"
						aria-label="Settimana successiva"
						title="Settimana successiva (sola lettura)"
						disabled={!canGoNext}
						onClick={() => onWeekChange(addDays(weekStart, 7))}
						className="schedule-nav-button disabled:opacity-30"
					>
						<ChevronRight size={18} />
					</button>
					<h3 className="ml-3 font-semibold text-slate-200 text-sm">
						{new Intl.DateTimeFormat('it-IT', {
							month: 'long',
							year: 'numeric',
						}).format(weekStart)}
					</h3>
				</div>
				<p className="text-slate-500 text-xs">
					{readOnly
						? (readOnlyReason ?? 'Sola lettura')
						: 'Clicca uno spazio libero per aggiungere uno slot · trascina per spostarlo.'}
				</p>
			</header>

			<div className="overflow-x-auto overflow-y-hidden">
				<div
					className="schedule-grid"
					style={{
						gridTemplateColumns: `64px repeat(${days.length}, minmax(142px, 1fr))`,
					}}
				>
					<div className="schedule-corner" />
					{days.map(({ name, date, key, holiday }) => (
						<div
							key={key}
							className={`schedule-day-heading ${key === dateKey(now) ? 'schedule-day-heading--today' : ''}`}
						>
							<span>
								{name}
								{holiday ? ' · festivo' : ''}
							</span>
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
						style={{ height: totalSlots * SLOT_HEIGHT }}
					>
						{Array.from(
							{ length: Math.floor(totalSlots / 2) + 1 },
							(_, index) => {
								const minute = startMinutes + index * 30
								return (
									<span
										key={index}
										style={{ top: index * SLOT_HEIGHT * 2 - 8 }}
									>
										{timeLabel(
											new Date(
												2000,
												0,
												1,
												Math.floor(minute / 60),
												minute % 60,
											),
										)}
									</span>
								)
							},
						)}
					</div>
					{days.map(({ index: weekday, name, date, key, holiday }) => {
						const dayEvents = events.filter(
							(event) => dateKey(new Date(event.start)) === key,
						)
						const foreground = dayEvents.filter((event) => !event.display)
						const lanes = layoutLanes(foreground)
						const closeMinutes = toMinutes(dayEnd(settings, weekday))
						const isToday = key === dateKey(now)
						const nowMinute = now.getHours() * 60 + now.getMinutes()
						return (
							// biome-ignore lint/a11y/noStaticElementInteractions: area di drop per il drag & drop
							<div
								key={key}
								title={`Calendario ${name}`}
								className={`schedule-day-column ${holiday ? 'schedule-day-column--holiday' : ''}`}
								style={{ height: totalSlots * SLOT_HEIGHT }}
								onDragOver={(event) => event.preventDefault()}
								onDrop={(event) => {
									event.preventDefault()
									const id =
										event.dataTransfer.getData('text/plain') || draggedId
									const moving = events.find((item) => item.id === id)
									if (!moving) return
									const bounds = event.currentTarget.getBoundingClientRect()
									const slot = Math.max(
										0,
										Math.min(
											totalSlots - 1,
											Math.floor((event.clientY - bounds.top) / SLOT_HEIGHT),
										),
									)
									moveEventTo(moving, date, startMinutes + slot * SLOT_MINUTES)
									setDraggedId(null)
								}}
							>
								{Array.from({ length: totalSlots }, (_, slot) => {
									const minute = startMinutes + slot * SLOT_MINUTES
									const startsAt = new Date(date)
									startsAt.setHours(Math.floor(minute / 60), minute % 60, 0, 0)
									const endsAt = new Date(
										startsAt.getTime() + SLOT_MINUTES * 60_000,
									)
									const unavailable =
										readOnly ||
										holiday ||
										minute >= closeMinutes ||
										dayEvents.some(
											(item) =>
												item.display === 'background' &&
												new Date(item.start) < endsAt &&
												new Date(item.end) > startsAt,
										)
									return (
										<button
											key={minute}
											type="button"
											disabled={unavailable}
											aria-label={`${name} ${timeLabel(startsAt)}: ${unavailable ? 'non disponibile' : 'aggiungi slot'}`}
											className={`schedule-cell ${minute % 60 === 0 ? 'schedule-cell--hour' : ''} ${minute >= closeMinutes ? 'schedule-cell--closed' : ''}`}
											style={{ top: slot * SLOT_HEIGHT, height: SLOT_HEIGHT }}
											onClick={() => onSelect(startsAt)}
										>
											{!unavailable && (
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
										((startMinute - startMinutes) / SLOT_MINUTES) * SLOT_HEIGHT,
									)
									const height = Math.max(
										SLOT_HEIGHT,
										((endMinute - startMinute) / SLOT_MINUTES) * SLOT_HEIGHT,
									)
									const background = event.display === 'background'
									if (background)
										return (
											<div
												key={event.id}
												className={`schedule-event schedule-event--background ${eventClasses[event.type]}`}
												style={{ top, height, zIndex: 1 }}
											>
												<span className="schedule-background-label">
													{event.title}
												</span>
											</div>
										)
									const past = new Date(event.end) <= now
									const inProgress = !past && new Date(event.start) <= now
									const editable = isEditable(event)
									const movable = editable && event.type !== 'VACATION'
									const lane = lanes.get(event.id) ?? { lane: 0, lanes: 1 }
									const width = 100 / lane.lanes
									const conflict = conflictIds.has(event.id)
									const badge = event.declined
										? 'RIFIUTATO'
										: past
											? 'DONE'
											: inProgress
												? 'IN PROGRESS'
												: 'TODO'
									return (
										<button
											type="button"
											key={event.id}
											className={`schedule-event ${eventClasses[event.type]} ${past ? 'schedule-event--past' : ''} ${inProgress ? 'schedule-event--in-progress' : ''} ${event.declined ? 'schedule-event--declined' : ''} ${conflict ? 'schedule-event--conflict' : ''} ${movable ? 'schedule-event--movable' : ''}`}
											style={{
												top,
												height,
												zIndex: event.type === 'VACATION' ? 2 : 3,
												left: `calc(${lane.lane * width}% + 3px)`,
												width: `calc(${width}% - 6px)`,
												right: 'auto',
											}}
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
											onClick={() => onEventClick(event)}
											title={`${event.title} · ${TYPE_LABELS[event.type]} · ${timeLabel(new Date(event.start))}–${timeLabel(new Date(event.end))} · ${badge}${conflict ? ' · IN CONFLITTO' : ''}`}
										>
											<div className="schedule-event-topline">
												<span className="schedule-event-time">
													{timeLabel(new Date(event.start))}–
													{timeLabel(new Date(event.end))}
												</span>
												{event.declined ? (
													<Ban size={11} aria-label="Rifiutato" />
												) : editable ? (
													<GripVertical size={12} aria-label="Modificabile" />
												) : (
													<Lock size={11} aria-label="Bloccato" />
												)}
											</div>
											<span className="schedule-event-title">
												{TYPE_LABELS[event.type]} · {event.title}
											</span>
											<span className="schedule-event-badge">{badge}</span>
										</button>
									)
								})}
								{isToday &&
									nowMinute >= startMinutes &&
									nowMinute <= endMinutes && (
										<div
											className="schedule-now-line"
											style={{
												top:
													((nowMinute - startMinutes) / SLOT_MINUTES) *
													SLOT_HEIGHT,
											}}
											title={`Ora attuale ${timeLabel(now)}`}
										/>
									)}
							</div>
						)
					})}
				</div>
			</div>
			<CalendarLegend />
		</section>
	)
}

function CalendarLegend() {
	const colors: { color: string; label: string }[] = [
		{
			color: 'event-color-vacation',
			label: 'Ferie (giornata intera) · priorità 1',
		},
		{ color: 'event-color-leave', label: 'Permesso · priorità 1' },
		{ color: 'event-color-fixed', label: 'Obbligatorio/bloccato · priorità 2' },
		{ color: 'event-color-meeting', label: 'Meeting · priorità 2' },
		{ color: 'event-color-emergency', label: 'Emergenza · priorità 3' },
		{ color: 'event-color-p1', label: 'P1 · priorità 4' },
		{ color: 'event-color-p2', label: 'P2 · priorità 5' },
		{ color: 'event-color-p3', label: 'P3 · priorità 6' },
		{ color: 'event-color-custom', label: 'Altro · priorità 7' },
		{ color: 'event-color-break', label: 'Pausa / preparazione / festivo' },
	]
	return (
		<footer className="space-y-3 border-slate-800 border-t px-4 py-3 text-[11px] text-slate-400">
			<div className="flex flex-wrap gap-x-5 gap-y-2">
				{colors.map(({ color, label }) => (
					<span key={label} className="inline-flex items-center gap-2">
						<span className={`h-2.5 w-2.5 ${color}`} />
						{label}
					</span>
				))}
			</div>
			<div className="flex flex-wrap gap-x-5 gap-y-1">
				<span>
					<b className="text-slate-200">TODO</b> slot futuro
				</span>
				<span>
					<b className="text-emerald-300">IN PROGRESS</b> slot in corso
				</span>
				<span>
					<b className="text-slate-300">DONE</b> slot passato (oscurato)
				</span>
				<span>
					<b className="text-slate-300">RIFIUTATO</b> non partecipi: escluso dal
					report
				</span>
				<span>
					<b className="text-red-300">Bordo rosso</b> conflitto da risolvere
				</span>
				<span>
					<b className="text-red-400">Linea rossa</b> ora attuale
				</span>
			</div>
			<ul className="list-disc space-y-0.5 pl-4">
				<li>
					Clicca uno spazio libero per creare uno slot; l'orario scelto viene
					sempre rispettato.
				</li>
				<li>
					Clicca uno slot per modificarlo, eliminarlo o (se
					obbligatorio/meeting) rifiutarlo; trascinalo per spostarlo.
				</li>
				<li>
					Non puoi inserire uno slot sopra uno di priorità superiore; i
					conflitti vanno risolti dal pannello dedicato.
				</li>
				<li>
					Le modifiche sono possibili fino alla fine dell'ultimo giorno
					lavorativo (anche sugli slot passati).
				</li>
				<li>
					La settimana successiva è in sola lettura; la precedente resta
					visibile fino a martedì alle 10:00.
				</li>
				<li>
					Pausa pranzo, preparazione postazione e festivi sono sempre bloccati.
				</li>
			</ul>
		</footer>
	)
}
