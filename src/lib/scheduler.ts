export type ProjectPriority = 'P1' | 'P2' | 'P3'
export type EventStatus = 'TODO' | 'IN_PROGRESS' | 'DONE'

/** Tipi di slot a calendario, in ordine di priorità decrescente. */
export type EventType =
	| 'VACATION'
	| 'LEAVE'
	| 'FIXED'
	| 'MEETING'
	| 'EMERGENCY'
	| 'PROJECT_P1'
	| 'PROJECT_P2'
	| 'PROJECT_P3'
	| 'CUSTOM'
	| 'BREAK'
	| 'SETUP'
	| 'HOLIDAY'

export type EventSource = 'manual' | 'auto'

export interface CalendarEvent {
	id: string
	title: string
	start: string
	end: string
	type: EventType
	/** manual = orario forzato dall'utente, auto = posizionato dal piano */
	source: EventSource
	projectId?: string
	declined?: boolean
	display?: 'background'
}

export interface Project {
	id: string
	name: string
	description: string
	priority: ProjectPriority
	/** Budget settimanale in minuti (P1/P2) */
	budgetMinutes?: number
	/** Durata dello slot P3 in minuti (15-120) */
	durationMinutes?: number
}

export interface FixedBlock {
	id: string
	day: number
	start: string
	end: string
	title: string
}

export interface Settings {
	/** 0 = lunedì … 5 = sabato. La domenica non è mai lavorativa. */
	workDays: number[]
	workStart: string
	workEnd: string
	/** Orario di fine ridotto per giorni specifici (indice giorno → HH:MM) */
	shortDays: Record<string, string>
	lunchStart: string
	lunchEnd: string
	/** Minuti bloccati a inizio giornata per preparare la postazione */
	setupMinutes: number
	weeklyHours: number
	minBudgets: { P1: number; P2: number }
	holidays: string[]
	fixedBlocks: FixedBlock[]
}

export const DAY_NAMES = [
	'Lunedì',
	'Martedì',
	'Mercoledì',
	'Giovedì',
	'Venerdì',
	'Sabato',
]

export const DURATION_OPTIONS = [15, 30, 45, 60, 75, 90, 105, 120]

export const PRIORITY: Record<EventType, number> = {
	VACATION: 1,
	LEAVE: 1,
	HOLIDAY: 1,
	FIXED: 2,
	MEETING: 2,
	EMERGENCY: 3,
	PROJECT_P1: 4,
	PROJECT_P2: 5,
	PROJECT_P3: 6,
	CUSTOM: 7,
	BREAK: 0,
	SETUP: 0,
}

export const TYPE_LABELS: Record<EventType, string> = {
	VACATION: 'Ferie',
	LEAVE: 'Permesso',
	HOLIDAY: 'Festivo',
	FIXED: 'Obbligatorio',
	MEETING: 'Meeting',
	EMERGENCY: 'Emergenza',
	PROJECT_P1: 'P1',
	PROJECT_P2: 'P2',
	PROJECT_P3: 'P3',
	CUSTOM: 'Altro',
	BREAK: 'Pausa',
	SETUP: 'Preparazione',
}

export const DAILY_CAPS: Partial<Record<EventType, number>> = {
	PROJECT_P1: 240,
	PROJECT_P2: 120,
	PROJECT_P3: 120,
	EMERGENCY: 120,
}

export const WEEKLY_MAX: { P1: number; P2: number } = { P1: 1200, P2: 600 }

export const DEFAULT_SETTINGS: Settings = {
	workDays: [0, 1, 2, 3, 4],
	workStart: '09:00',
	workEnd: '18:00',
	shortDays: { '4': '16:00' },
	lunchStart: '13:00',
	lunchEnd: '14:00',
	setupMinutes: 15,
	weeklyHours: 38,
	minBudgets: { P1: 600, P2: 360 },
	holidays: [],
	fixedBlocks: [
		{
			id: 'fb-1',
			day: 0,
			start: '09:15',
			end: '10:00',
			title: 'Planning settimanale',
		},
		{ id: 'fb-2', day: 0, start: '10:00', end: '10:30', title: 'Stand-up' },
		{
			id: 'fb-3',
			day: 1,
			start: '09:15',
			end: '10:00',
			title: 'Allineamento team',
		},
		{
			id: 'fb-4',
			day: 2,
			start: '09:15',
			end: '10:00',
			title: 'Allineamento team',
		},
		{
			id: 'fb-5',
			day: 3,
			start: '09:15',
			end: '10:00',
			title: 'Allineamento team',
		},
		{
			id: 'fb-6',
			day: 4,
			start: '15:30',
			end: '16:00',
			title: 'Review & retrospettiva',
		},
	],
}

export function getMonday(date = new Date()): Date {
	const monday = new Date(date)
	monday.setHours(0, 0, 0, 0)
	monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
	return monday
}

export function dateKey(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, '0')
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export const weekKey = dateKey

export function localDateTime(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, '0')
	return `${dateKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`
}

export function toMinutes(time: string): number {
	const [hours, minutes = 0] = time.split(':').map(Number)
	return hours * 60 + minutes
}

export function fromMinutes(value: number): string {
	const pad = (part: number) => String(part).padStart(2, '0')
	return `${pad(Math.floor(value / 60))}:${pad(value % 60)}`
}

export function atTime(day: Date, time: string | number): Date {
	const total = typeof time === 'number' ? time : toMinutes(time)
	const result = new Date(day)
	result.setHours(Math.floor(total / 60), total % 60, 0, 0)
	return result
}

export function addDays(date: Date, days: number): Date {
	const result = new Date(date)
	result.setDate(result.getDate() + days)
	return result
}

export function dayIndex(date: Date): number {
	return (date.getDay() + 6) % 7
}

export function durationOf(
	event: Pick<CalendarEvent, 'start' | 'end'>,
): number {
	return (
		(new Date(event.end).getTime() - new Date(event.start).getTime()) / 60_000
	)
}

export function overlaps(
	left: Pick<CalendarEvent, 'start' | 'end'>,
	right: Pick<CalendarEvent, 'start' | 'end'>,
): boolean {
	return (
		new Date(left.start) < new Date(right.end) &&
		new Date(left.end) > new Date(right.start)
	)
}

export function projectType(priority: ProjectPriority): EventType {
	return `PROJECT_${priority}` as EventType
}

export function dayEnd(settings: Settings, index: number): string {
	return settings.shortDays[String(index)] ?? settings.workEnd
}

export function isWorkingDay(settings: Settings, date: Date): boolean {
	const index = dayIndex(date)
	return (
		index < 6 &&
		settings.workDays.includes(index) &&
		!settings.holidays.includes(dateKey(date))
	)
}

/** Giorni lavorativi configurati (anche festivi) della settimana. */
export function weekDays(settings: Settings, weekStart: Date) {
	return [...settings.workDays]
		.filter((index) => index >= 0 && index < 6)
		.sort((a, b) => a - b)
		.map((index) => {
			const date = addDays(weekStart, index)
			return {
				index,
				name: DAY_NAMES[index],
				date,
				key: dateKey(date),
				holiday: settings.holidays.includes(dateKey(date)),
			}
		})
}

/** Fine dell'ultimo giorno lavorativo: dopo questo orario la settimana è in sola lettura. */
export function weekLockTime(settings: Settings, weekStart: Date): Date {
	const days = weekDays(settings, weekStart)
	const last = days.at(-1)
	if (!last) return addDays(weekStart, 5)
	return atTime(last.date, dayEnd(settings, last.index))
}

/** Martedì alle 10:00 della settimana successiva. */
export function previousWeekCutoff(weekStart: Date): Date {
	return atTime(addDays(weekStart, 8), '10:00')
}
