import {
	addDays,
	atTime,
	type CalendarEvent,
	DAILY_CAPS,
	dateKey,
	dayEnd,
	dayIndex,
	durationOf,
	type EventType,
	isWorkingDay,
	localDateTime,
	overlaps,
	PRIORITY,
	type Project,
	type ProjectPriority,
	projectType,
	type Settings,
	TYPE_LABELS,
	toMinutes,
	WEEKLY_MAX,
	weekDays,
} from './scheduler'

interface Interval {
	start: Date
	end: Date
}

export interface WeekInput {
	events: CalendarEvent[]
	projects: Project[]
	declinedFixed: string[]
}

export interface Conflict {
	id: string
	higher: CalendarEvent
	lower: CalendarEvent
}

const QUARTER = 15
const minutesOf = (interval: Interval) =>
	(interval.end.getTime() - interval.start.getTime()) / 60_000

function subtract(intervals: Interval[], blocked: Interval): Interval[] {
	return intervals.flatMap((interval) => {
		if (blocked.end <= interval.start || blocked.start >= interval.end)
			return [interval]
		const result: Interval[] = []
		if (blocked.start > interval.start)
			result.push({ start: interval.start, end: blocked.start })
		if (blocked.end < interval.end)
			result.push({ start: blocked.end, end: interval.end })
		return result
	})
}

function roundUpToQuarter(date: Date): Date {
	const result = new Date(date)
	result.setSeconds(0, 0)
	const minute = result.getMinutes()
	const rounded = Math.ceil(minute / QUARTER) * QUARTER
	result.setMinutes(rounded)
	return result
}

function makeEvent(
	id: string,
	title: string,
	interval: Interval,
	type: EventType,
	extra: Partial<CalendarEvent> = {},
): CalendarEvent {
	return {
		id,
		title,
		start: localDateTime(interval.start),
		end: localDateTime(interval.end),
		type,
		source: 'auto',
		...extra,
	}
}

export const isBackground = (event: CalendarEvent) =>
	event.display === 'background'

/** Eventi generati dalle impostazioni: pause, preparazione, festivi e blocchi obbligatori. */
export function frameEvents(
	weekStart: Date,
	settings: Settings,
	declinedFixed: string[],
): CalendarEvent[] {
	const events: CalendarEvent[] = []
	for (const day of weekDays(settings, weekStart)) {
		const end = dayEnd(settings, day.index)
		if (day.holiday) {
			events.push(
				makeEvent(
					`holiday-${day.key}`,
					'Festivo',
					{
						start: atTime(day.date, settings.workStart),
						end: atTime(day.date, end),
					},
					'HOLIDAY',
					{ display: 'background' },
				),
			)
			continue
		}
		if (toMinutes(settings.lunchEnd) > toMinutes(settings.lunchStart))
			events.push(
				makeEvent(
					`lunch-${day.key}`,
					'Pausa pranzo',
					{
						start: atTime(day.date, settings.lunchStart),
						end: atTime(day.date, settings.lunchEnd),
					},
					'BREAK',
					{ display: 'background' },
				),
			)
		if (settings.setupMinutes > 0) {
			const start = atTime(day.date, settings.workStart)
			events.push(
				makeEvent(
					`setup-${day.key}`,
					'Preparazione postazione',
					{
						start,
						end: new Date(start.getTime() + settings.setupMinutes * 60_000),
					},
					'SETUP',
					{ display: 'background' },
				),
			)
		}
		for (const block of settings.fixedBlocks.filter(
			(item) => item.day === day.index,
		)) {
			const id = `fixed-${block.id}-${day.key}`
			events.push(
				makeEvent(
					id,
					block.title,
					{
						start: atTime(day.date, block.start),
						end: atTime(day.date, block.end),
					},
					'FIXED',
					{ declined: declinedFixed.includes(id) },
				),
			)
		}
	}
	return events
}

/** Un evento occupa il calendario se non è di sfondo e non è stato rifiutato. */
export const occupies = (event: CalendarEvent) =>
	!isBackground(event) && !event.declined

function workWindow(settings: Settings, date: Date): Interval[] {
	if (!isWorkingDay(settings, date)) return []
	const index = dayIndex(date)
	let free: Interval[] = [
		{
			start: atTime(date, settings.workStart),
			end: atTime(date, dayEnd(settings, index)),
		},
	]
	free = subtract(free, {
		start: atTime(date, settings.lunchStart),
		end: atTime(date, settings.lunchEnd),
	})
	if (settings.setupMinutes > 0) {
		const start = atTime(date, settings.workStart)
		free = subtract(free, {
			start,
			end: new Date(start.getTime() + settings.setupMinutes * 60_000),
		})
	}
	return free
}

/** Intervalli liberi di un giorno, escludendo gli eventi indicati e il passato. */
export function freeIntervals(
	settings: Settings,
	date: Date,
	blockers: CalendarEvent[],
	from?: Date,
): Interval[] {
	let free = workWindow(settings, date)
	for (const event of blockers.filter(occupies))
		free = subtract(free, {
			start: new Date(event.start),
			end: new Date(event.end),
		})
	if (from) {
		const earliest = roundUpToQuarter(from)
		free = subtract(free, { start: atTime(date, 0), end: earliest })
	}
	return free.filter((interval) => minutesOf(interval) > 0)
}

/** Controlla che lo slot rispetti orari lavorativi, pausa e preparazione. */
export function withinWorkingHours(
	settings: Settings,
	event: CalendarEvent,
): boolean {
	const start = new Date(event.start)
	const end = new Date(event.end)
	if (!(start < end) || dateKey(start) !== dateKey(end)) return false
	return workWindow(settings, start).some(
		(interval) => interval.start <= start && interval.end >= end,
	)
}

/** Coppie di slot sovrapposti che l'utente deve risolvere. */
export function findConflicts(events: CalendarEvent[]): Conflict[] {
	const active = events
		.filter(occupies)
		.sort((a, b) => a.start.localeCompare(b.start))
	const conflicts: Conflict[] = []
	for (let left = 0; left < active.length; left += 1)
		for (let right = left + 1; right < active.length; right += 1) {
			const a = active[left]
			const b = active[right]
			if (b.start >= a.end) break
			if (!overlaps(a, b)) continue
			const [higher, lower] =
				PRIORITY[a.type] <= PRIORITY[b.type] ? [a, b] : [b, a]
			conflicts.push({ id: `${higher.id}|${lower.id}`, higher, lower })
		}
	return conflicts
}

function dailyMinutes(
	events: CalendarEvent[],
	type: EventType,
	date: Date,
	exceptId?: string,
) {
	return events
		.filter(
			(event) =>
				event.type === type &&
				event.id !== exceptId &&
				!event.declined &&
				dateKey(new Date(event.start)) === dateKey(date),
		)
		.reduce((total, event) => total + durationOf(event), 0)
}

/**
 * Valida uno slot inserito/spostato manualmente. L'orario non viene mai modificato:
 * se esiste già uno slot di priorità superiore l'inserimento è rifiutato.
 */
export function validateManual(
	candidate: CalendarEvent,
	events: CalendarEvent[],
	settings: Settings,
): string | undefined {
	if (candidate.type === 'VACATION') {
		if (!isWorkingDay(settings, new Date(candidate.start)))
			return 'Il giorno selezionato non è lavorativo o è festivo.'
		return undefined
	}
	if (!withinWorkingHours(settings, candidate))
		return 'Lo slot deve rientrare negli orari lavorativi, fuori da pausa pranzo, preparazione postazione e festivi.'
	const others = events.filter(
		(event) => event.id !== candidate.id && occupies(event),
	)
	const higher = others.find(
		(event) =>
			overlaps(event, candidate) &&
			PRIORITY[event.type] < PRIORITY[candidate.type],
	)
	if (higher)
		return `Lo slot si sovrappone a "${higher.title}" (${TYPE_LABELS[higher.type]}), che ha priorità superiore.`
	const cap = DAILY_CAPS[candidate.type]
	if (cap !== undefined) {
		const used = dailyMinutes(
			events,
			candidate.type,
			new Date(candidate.start),
			candidate.id,
		)
		if (used + durationOf(candidate) > cap)
			return `Limite giornaliero di ${cap / 60} h per ${TYPE_LABELS[candidate.type]} superato.`
	}
	if (candidate.type === 'EMERGENCY') {
		const sameDay = events.some(
			(event) =>
				event.type === 'EMERGENCY' &&
				event.id !== candidate.id &&
				dateKey(new Date(event.start)) === dateKey(new Date(candidate.start)),
		)
		if (sameDay) return 'È consentito un solo slot di emergenza al giorno.'
	}
	return undefined
}

/** Dove inserire per primo nel giorno lo slot, rispetto agli eventi che lo bloccano. */
function firstFit(
	intervals: Interval[],
	duration: number,
): Interval | undefined {
	const slot = intervals.find((interval) => minutesOf(interval) >= duration)
	if (!slot) return undefined
	return {
		start: slot.start,
		end: new Date(slot.start.getTime() + duration * 60_000),
	}
}

function remainingDays(
	settings: Settings,
	weekStart: Date,
	now: Date,
	fromDate?: Date,
) {
	return weekDays(settings, weekStart).filter(
		(day) =>
			!day.holiday &&
			atTime(day.date, dayEnd(settings, day.index)) > now &&
			(!fromDate || day.key >= dateKey(fromDate)),
	)
}

/** Sposta uno slot di bassa priorità nel primo spazio completamente libero. */
function relocate(
	event: CalendarEvent,
	events: CalendarEvent[],
	settings: Settings,
	weekStart: Date,
	now: Date,
): CalendarEvent | undefined {
	const duration = durationOf(event)
	const blockers = events.filter((item) => item.id !== event.id)
	const original = new Date(event.start)
	const days = remainingDays(settings, weekStart, now)
	const ordered = [
		...days.filter((day) => day.key >= dateKey(original)),
		...days.filter((day) => day.key < dateKey(original)),
	]
	for (const day of ordered) {
		const free = freeIntervals(settings, day.date, blockers, now)
		const cap = DAILY_CAPS[event.type]
		if (
			cap !== undefined &&
			dailyMinutes(blockers, event.type, day.date) + duration > cap
		)
			continue
		const fit = firstFit(free, duration)
		if (fit)
			return {
				...event,
				start: localDateTime(fit.start),
				end: localDateTime(fit.end),
			}
	}
	return undefined
}

/** Come `relocate`, ma uno slot progetto può essere diviso su più giorni rispettando i limiti giornalieri. */
function relocateSplit(
	event: CalendarEvent,
	events: CalendarEvent[],
	settings: Settings,
	weekStart: Date,
	now: Date,
): { pieces: CalendarEvent[]; unplaced: number } {
	const whole = relocate(event, events, settings, weekStart, now)
	if (whole || !event.type.startsWith('PROJECT'))
		return {
			pieces: whole ? [whole] : [],
			unplaced: whole ? 0 : durationOf(event),
		}
	const blockers = events.filter((item) => item.id !== event.id)
	const cap = DAILY_CAPS[event.type] ?? 120
	const pieces: CalendarEvent[] = []
	let left = durationOf(event)
	for (const day of remainingDays(settings, weekStart, now)) {
		if (left <= 0) break
		const room =
			cap - dailyMinutes([...blockers, ...pieces], event.type, day.date)
		if (room <= 0) continue
		const free = freeIntervals(
			settings,
			day.date,
			[...blockers, ...pieces],
			now,
		)
		takeFromStart(free, Math.min(room, left)).forEach((interval, part) => {
			pieces.push({
				...event,
				id: `${event.id}-${day.key}-${part}`,
				start: localDateTime(interval.start),
				end: localDateTime(interval.end),
			})
			left -= minutesOf(interval)
		})
	}
	return { pieces, unplaced: left }
}

export interface PlacementResult {
	events: CalendarEvent[]
	messages: string[]
	nextWeekAlert?: string
	placed?: CalendarEvent
}

/**
 * Inserisce un'emergenza nel primo slot non occupato da permessi, ferie, meeting
 * o blocchi obbligatori, spostando automaticamente gli slot di priorità inferiore.
 */
export function placeEmergency(
	title: string,
	duration: number,
	events: CalendarEvent[],
	settings: Settings,
	weekStart: Date,
	now: Date,
): PlacementResult {
	const messages: string[] = []
	const strong = events.filter(
		(event) => PRIORITY[event.type] <= PRIORITY.EMERGENCY,
	)
	const days = remainingDays(settings, weekStart, now)
	const todayKey = dateKey(now)
	for (const day of days) {
		const hasEmergency = events.some(
			(event) =>
				event.type === 'EMERGENCY' &&
				dateKey(new Date(event.start)) === day.key,
		)
		if (hasEmergency) {
			messages.push(
				`${day.name} ha già uno slot di emergenza: l'emergenza viene impostata al giorno successivo.`,
			)
			continue
		}
		const fit = firstFit(
			freeIntervals(settings, day.date, strong, now),
			duration,
		)
		if (!fit) continue
		const placed = makeEvent(
			`emergency-${crypto.randomUUID()}`,
			title,
			fit,
			'EMERGENCY',
		)
		let next = [...events, placed]
		const displaced = next.filter(
			(event) =>
				event.id !== placed.id &&
				occupies(event) &&
				PRIORITY[event.type] > PRIORITY.EMERGENCY &&
				overlaps(event, placed),
		)
		for (const item of displaced) {
			next = next.filter((event) => event.id !== item.id)
			const itemInterval = {
				start: new Date(item.start),
				end: new Date(item.end),
			}
			// Gli slot progetto restano dove non toccano l'emergenza: si sposta solo la parte sovrapposta.
			const kept = item.type.startsWith('PROJECT')
				? subtract([itemInterval], fit).map((interval, part) => ({
						...item,
						id: `${item.id}-k${part}`,
						start: localDateTime(interval.start),
						end: localDateTime(interval.end),
					}))
				: []
			next.push(...kept)
			const overlap = kept.length
				? {
						...item,
						start: localDateTime(
							new Date(
								Math.max(itemInterval.start.getTime(), fit.start.getTime()),
							),
						),
						end: localDateTime(
							new Date(Math.min(itemInterval.end.getTime(), fit.end.getTime())),
						),
					}
				: item
			const { pieces, unplaced } = relocateSplit(
				overlap,
				next,
				settings,
				weekStart,
				now,
			)
			next.push(...pieces)
			if (pieces.length)
				messages.push(
					`"${item.title}" (${TYPE_LABELS[item.type]}): ${durationOf(overlap) - unplaced} min spostati a ${pieces.map((piece) => `${piece.start.slice(5, 10)} ${piece.start.slice(11, 16)}`).join(', ')}.`,
				)
			if (unplaced > 0)
				messages.push(
					`"${item.title}" (${TYPE_LABELS[item.type]}): ${unplaced} min rimossi, nessuno spazio libero in settimana.`,
				)
		}
		if (
			day.key !== todayKey &&
			days[0]?.key === todayKey &&
			messages.length === 0
		)
			messages.push(
				`Oggi non c'è spazio libero: emergenza impostata a ${day.name}.`,
			)
		return { events: next, messages, placed }
	}
	const alert = `Emergenza "${title}" (${duration} min) non inseribile questa settimana: da pianificare la settimana prossima.`
	messages.push(alert)
	return { events, messages, nextWeekAlert: alert }
}

/** Inserisce automaticamente uno slot P3 nel primo spazio libero (max 2 h al giorno). */
export function placeP3(
	project: Project,
	events: CalendarEvent[],
	settings: Settings,
	weekStart: Date,
	now: Date,
): CalendarEvent | undefined {
	const duration = project.durationMinutes ?? 60
	const days = remainingDays(settings, weekStart, now)
	const sorted = [...days].sort(
		(a, b) =>
			dailyMinutes(events, 'PROJECT_P3', a.date) -
				dailyMinutes(events, 'PROJECT_P3', b.date) || a.index - b.index,
	)
	for (const day of sorted) {
		if (dailyMinutes(events, 'PROJECT_P3', day.date) + duration > 120) continue
		const fit = firstFit(
			freeIntervals(settings, day.date, events, now),
			duration,
		)
		if (fit)
			return makeEvent(
				`p3-${crypto.randomUUID()}`,
				project.name,
				fit,
				'PROJECT_P3',
				{
					projectId: project.id,
				},
			)
	}
	return undefined
}

export interface PlanResult {
	events: CalendarEvent[]
	alerts: string[]
}

/** Divide `total` minuti tra i giorni a blocchi da 15 min, in modo uniforme. */
function spreadEvenly(total: number, capacity: number[]): number[] {
	const quota = capacity.map(() => 0)
	let remaining = Math.floor(total / QUARTER) * QUARTER
	let progressed = true
	while (remaining > 0 && progressed) {
		progressed = false
		for (let index = 0; index < capacity.length && remaining > 0; index += 1) {
			if (quota[index] + QUARTER > capacity[index]) continue
			quota[index] += QUARTER
			remaining -= QUARTER
			progressed = true
		}
	}
	return quota
}

function takeFromStart(intervals: Interval[], requested: number): Interval[] {
	const selected: Interval[] = []
	let left = requested
	for (const interval of intervals) {
		if (left <= 0) break
		const length = Math.min(left, minutesOf(interval))
		if (length <= 0) continue
		selected.push({
			start: interval.start,
			end: new Date(interval.start.getTime() + length * 60_000),
		})
		left -= length
	}
	return selected
}

/**
 * "Rigenera piano": ridistribuisce solo gli slot automatici P1/P2/P3 futuri e
 * ricolloca gli slot "Altro" in conflitto. Permessi, ferie, meeting, emergenze e
 * slot forzati manualmente non vengono toccati.
 */
export function regeneratePlan(
	week: WeekInput,
	frame: CalendarEvent[],
	settings: Settings,
	weekStart: Date,
	now: Date,
): PlanResult {
	const alerts: string[] = []
	const isFutureAuto = (event: CalendarEvent) =>
		event.source === 'auto' &&
		new Date(event.start) >= now &&
		['PROJECT_P1', 'PROJECT_P2', 'PROJECT_P3'].includes(event.type)
	let events = week.events.filter((event) => !isFutureAuto(event))
	const days = remainingDays(settings, weekStart, now)

	const allocateProject = (
		project: Project,
		total: number,
		dailyCap: number,
	) => {
		const type = projectType(project.priority)
		const blockers = () => [...frame, ...events]
		const capacity = days.map((day) => {
			const free = freeIntervals(settings, day.date, blockers(), now).reduce(
				(sum, interval) => sum + minutesOf(interval),
				0,
			)
			return Math.max(
				0,
				Math.min(free, dailyCap - dailyMinutes(events, type, day.date)),
			)
		})
		const quota = spreadEvenly(total, capacity)
		let placed = 0
		days.forEach((day, index) => {
			if (quota[index] <= 0) return
			const free = freeIntervals(settings, day.date, blockers(), now)
			takeFromStart(free, quota[index]).forEach((interval, part) => {
				events.push(
					makeEvent(
						`auto-${project.id}-${day.key}-${part}`,
						project.name,
						interval,
						type,
						{ projectId: project.id },
					),
				)
				placed += minutesOf(interval)
			})
		})
		return placed
	}

	for (const priority of ['P1', 'P2'] as const) {
		const type = projectType(priority)
		const dailyCap = DAILY_CAPS[type] ?? 120
		for (const project of week.projects.filter(
			(item) => item.priority === priority,
		)) {
			const target = Math.min(
				WEEKLY_MAX[priority],
				Math.max(settings.minBudgets[priority], project.budgetMinutes ?? 0),
			)
			const already = events
				.filter(
					(event) =>
						event.projectId === project.id &&
						event.type === type &&
						!event.declined,
				)
				.reduce((sum, event) => sum + durationOf(event), 0)
			const missing = Math.max(0, target - already)
			const placed =
				missing > 0 ? allocateProject(project, missing, dailyCap) : 0
			if (placed < missing)
				alerts.push(
					`${priority} "${project.name}": ${((missing - placed) / 60).toFixed(2)} h non pianificate (calendario pieno).`,
				)
		}
	}

	for (const project of week.projects.filter(
		(item) => item.priority === 'P3',
	)) {
		const exists = events.some((event) => event.projectId === project.id)
		if (exists) continue
		const slot = placeP3(
			project,
			[...frame, ...events],
			settings,
			weekStart,
			now,
		)
		if (slot) events.push(slot)
		else
			alerts.push(
				`P3 "${project.name}": slot da ${project.durationMinutes ?? 60} min rimasto fuori dal calendario.`,
			)
	}

	const customInConflict = events.filter(
		(event) =>
			event.type === 'CUSTOM' &&
			new Date(event.start) >= now &&
			[...frame, ...events].some(
				(other) =>
					other.id !== event.id &&
					occupies(other) &&
					PRIORITY[other.type] < PRIORITY.CUSTOM &&
					overlaps(other, event),
			),
	)
	for (const item of customInConflict) {
		const moved = relocate(
			item,
			[...frame, ...events],
			settings,
			weekStart,
			now,
		)
		events = events.filter((event) => event.id !== item.id)
		if (moved) {
			events.push(moved)
			alerts.push(
				`Altro "${item.title}" spostato a ${moved.start.slice(0, 10)} ${moved.start.slice(11, 16)}.`,
			)
		} else alerts.push(`Altro "${item.title}" rimasto fuori dal calendario.`)
	}

	return { events, alerts }
}

/**
 * Dopo l'inserimento di uno slot di priorità superiore, gli slot "Altro"
 * sovrapposti vengono spostati automaticamente (con segnalazione).
 */
export function displaceCustom(
	inserted: CalendarEvent,
	events: CalendarEvent[],
	frame: CalendarEvent[],
	settings: Settings,
	weekStart: Date,
	now: Date,
): { events: CalendarEvent[]; messages: string[] } {
	if (inserted.type === 'CUSTOM') return { events, messages: [] }
	let next = events
	const messages: string[] = []
	const hit = events.filter(
		(event) =>
			event.type === 'CUSTOM' &&
			event.id !== inserted.id &&
			(inserted.type === 'VACATION'
				? dateKey(new Date(event.start)) === dateKey(new Date(inserted.start))
				: overlaps(event, inserted)),
	)
	for (const item of hit) {
		const moved = relocate(item, [...frame, ...next], settings, weekStart, now)
		next = next.filter((event) => event.id !== item.id)
		if (moved) {
			next = [...next, moved]
			messages.push(
				`"${item.title}" (Altro) spostato a ${moved.start.slice(0, 10)} ${moved.start.slice(11, 16)}.`,
			)
		} else
			messages.push(
				`"${item.title}" (Altro) rimosso: nessuno spazio libero in settimana.`,
			)
	}
	return { events: next, messages }
}

export function vacationInterval(settings: Settings, date: Date): Interval {
	return {
		start: atTime(date, settings.workStart),
		end: atTime(date, dayEnd(settings, dayIndex(date))),
	}
}

export function minutesByType(events: CalendarEvent[]): Record<string, number> {
	const totals: Record<string, number> = {}
	for (const event of events.filter(occupies))
		totals[event.type] = (totals[event.type] ?? 0) + durationOf(event)
	return totals
}

export function projectMinutes(
	events: CalendarEvent[],
	priority: ProjectPriority,
) {
	return minutesByType(events)[projectType(priority)] ?? 0
}

export { addDays }
