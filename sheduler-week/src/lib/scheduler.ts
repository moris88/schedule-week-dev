export type ProjectPriority = 'P1' | 'P2' | 'P3'
export type EmergencyStatus = 'TODO' | 'IN_PROGRESS' | 'DONE'
export type Weekday = 'Lunedì' | 'Martedì' | 'Mercoledì' | 'Giovedì' | 'Venerdì'
export type EventType =
	| 'MEETING'
	| 'FOCUS'
	| 'BREAK'
	| 'REVIEW'
	| 'FIX_BUFFER'
	| 'EMERGENCY_SLOT'
	| 'GAP'
	| 'EMERGENCY'
	| 'PROJECT_P1'
	| 'PROJECT_P2'
	| 'PROJECT_P3'
	| 'CUSTOM'

export interface Project {
	id: string
	name: string
	description: string
	priority: ProjectPriority
	day?: Weekday
	startTime?: string
	endTime?: string
}

export interface Emergency {
	id: string
	title: string
	day?: Weekday
	durationMinutes: number
	startTime?: string
	endTime?: string
	status?: EmergencyStatus
}

export interface CalendarEvent {
	id: string
	title: string
	start: string
	end: string
	type: EventType
	fixed: boolean
	editable: boolean
	display?: 'background'
	projectId?: string
	emergencyId?: string
	status?: EmergencyStatus
}

interface Interval {
	start: Date
	end: Date
}

interface FixedBlock {
	day: number
	start: string
	end: string
	title: string
	type: 'MEETING' | 'REVIEW'
}

export const DAYS: Weekday[] = [
	'Lunedì',
	'Martedì',
	'Mercoledì',
	'Giovedì',
	'Venerdì',
]
export const DAILY_BUFFER_MINUTES = [60, 60, 60, 60, 60]

export const FIXED_BLOCKS: FixedBlock[] = [
	{
		day: 0,
		start: '09:00',
		end: '10:00',
		title: 'Planning settimanale',
		type: 'MEETING',
	},
	{
		day: 0,
		start: '10:00',
		end: '10:30',
		title: 'Stand-up aziendale',
		type: 'MEETING',
	},
	{
		day: 0,
		start: '10:30',
		end: '11:00',
		title: 'Allineamento CloudSherpa',
		type: 'MEETING',
	},
	{
		day: 0,
		start: '14:15',
		end: '15:00',
		title: 'Allineamento Team Dev',
		type: 'MEETING',
	},
	{
		day: 1,
		start: '09:15',
		end: '10:00',
		title: 'Allineamento Team Dev',
		type: 'MEETING',
	},
	{
		day: 2,
		start: '09:15',
		end: '10:00',
		title: 'Allineamento Team Dev',
		type: 'MEETING',
	},
	{
		day: 3,
		start: '09:15',
		end: '10:00',
		title: 'Allineamento Team Dev',
		type: 'MEETING',
	},
	{
		day: 4,
		start: '15:30',
		end: '16:00',
		title: 'Review & retrospettiva',
		type: 'REVIEW',
	},
]

const minutes = (date: Date) => date.getTime() / 60_000
const localDateTime = (date: Date) => {
	const pad = (value: number) => String(value).padStart(2, '0')
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`
}

function atTime(day: Date, time: string): Date {
	const [hours, minute] = time.split(':').map(Number)
	const result = new Date(day)
	result.setHours(hours, minute, 0, 0)
	return result
}

function subtractBlock(intervals: Interval[], block: Interval): Interval[] {
	return intervals.flatMap((interval) => {
		if (block.end <= interval.start || block.start >= interval.end)
			return [interval]
		const result: Interval[] = []
		if (block.start > interval.start)
			result.push({ start: interval.start, end: block.start })
		if (block.end < interval.end)
			result.push({ start: block.end, end: interval.end })
		return result
	})
}

function takeFromEnd(intervals: Interval[], requestedMinutes: number) {
	let remaining = requestedMinutes
	const selected: Interval[] = []
	const available = intervals.map((interval) => ({ ...interval }))

	for (
		let index = available.length - 1;
		index >= 0 && remaining > 0;
		index -= 1
	) {
		const interval = available[index]
		const taken = Math.min(
			remaining,
			minutes(interval.end) - minutes(interval.start),
		)
		if (taken <= 0) continue
		const start = new Date(interval.end.getTime() - taken * 60_000)
		selected.push({ start, end: interval.end })
		interval.end = start
		remaining -= taken
		if (interval.start >= interval.end) available.splice(index, 1)
	}

	return {
		selected: selected.sort((a, b) => a.start.getTime() - b.start.getTime()),
		remaining: available.filter((interval) => interval.end > interval.start),
		unallocated: remaining,
	}
}

function makeEvent(
	id: string,
	title: string,
	interval: Interval,
	type: EventType,
	options: Partial<
		Pick<
			CalendarEvent,
			'fixed' | 'editable' | 'display' | 'projectId' | 'emergencyId'
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
	}
}

export interface ScheduleResult {
	events: CalendarEvent[]
	projectMinutes: Record<ProjectPriority, number>
	bufferMinutes: number
	emergencyMinutes: number
	unscheduledEmergencyMinutes: number
}

export function buildSchedule(
	weekStart: Date,
	projects: Project[],
	emergencies: Emergency[],
): ScheduleResult {
	const events: CalendarEvent[] = []
	const freeByDay: Interval[][] = []
	let bufferMinutes = 0
	let emergencyMinutes = 0
	let unscheduledEmergencyMinutes = 0

	DAYS.forEach((dayName, dayIndex) => {
		const day = new Date(weekStart)
		day.setDate(day.getDate() + dayIndex)
		const workEnd = dayIndex === 4 ? '16:00' : '18:00'
		let free: Interval[] = [
			{ start: atTime(day, '09:00'), end: atTime(day, '13:00') },
			{ start: atTime(day, '14:00'), end: atTime(day, workEnd) },
		]

		events.push(
			makeEvent(
				`lunch-${dayIndex}`,
				'Pausa pranzo',
				{ start: atTime(day, '13:00'), end: atTime(day, '14:00') },
				'BREAK',
				{ fixed: true, editable: false, display: 'background' },
			),
		)

		FIXED_BLOCKS.filter((block) => block.day === dayIndex).forEach((block) => {
			const interval = {
				start: atTime(day, block.start),
				end: atTime(day, block.end),
			}
			free = subtractBlock(free, interval)
			events.push(
				makeEvent(
					`fixed-${dayIndex}-${block.start}`,
					block.title,
					interval,
					block.type,
					{ fixed: true, editable: false },
				),
			)
		})

		if (dayIndex >= 1 && dayIndex <= 3) {
			const interval = {
				start: atTime(day, '09:15'),
				end: atTime(day, '10:00'),
			}
			free = subtractBlock(free, interval)
		}

		if (dayIndex === 2) {
			events.push(
				makeEvent(
					`focus-${dayIndex}`,
					'Focus break · no call',
					{ start: atTime(day, '14:00'), end: atTime(day, '18:00') },
					'FOCUS',
					{ fixed: true, editable: false, display: 'background' },
				),
			)
		}
		if (dayIndex === 4) {
			events.push(
				makeEvent(
					'focus-friday-am',
					'No call day · sviluppo e formazione',
					{ start: atTime(day, '09:00'), end: atTime(day, '13:00') },
					'FOCUS',
					{ fixed: true, editable: false, display: 'background' },
				),
			)
			events.push(
				makeEvent(
					'focus-friday-pm',
					'No call day · sviluppo e formazione',
					{ start: atTime(day, '14:00'), end: atTime(day, '15:30') },
					'FOCUS',
					{ fixed: true, editable: false, display: 'background' },
				),
			)
		}

		const dailyEmergencies = emergencies.filter(
			(emergency) => emergency.day === dayName,
		)
		const requestedMinutes = dailyEmergencies.reduce(
			(total, emergency) => total + Math.max(0, emergency.durationMinutes),
			0,
		)
		const availableMinutes = free.reduce(
			(total, interval) =>
				total + minutes(interval.end) - minutes(interval.start),
			0,
		)
		const reservation = Math.min(
			availableMinutes,
			Math.max(DAILY_BUFFER_MINUTES[dayIndex], requestedMinutes),
		)
		const reserved = takeFromEnd(free, reservation)
		free = reserved.remaining

		const emergenciesInBuffer = takeFromEnd(
			reserved.selected,
			Math.min(requestedMinutes, reservation),
		)
		const emergencyChunks = emergenciesInBuffer.selected
		const remainingEmergencies = dailyEmergencies.map((emergency) => ({
			...emergency,
			remaining: Math.max(0, emergency.durationMinutes),
		}))

		emergencyChunks.forEach((chunk) => {
			let chunkRemaining = minutes(chunk.end) - minutes(chunk.start)
			while (chunkRemaining > 0 && remainingEmergencies.length > 0) {
				const emergency = remainingEmergencies[0]
				const duration = Math.min(chunkRemaining, emergency.remaining)
				const start = new Date(chunk.end.getTime() - chunkRemaining * 60_000)
				const end = new Date(start.getTime() + duration * 60_000)
				events.push(
					makeEvent(
						`${emergency.id}-${localDateTime(start)}`,
						emergency.title,
						{ start, end },
						'EMERGENCY',
						{ emergencyId: emergency.id },
					),
				)
				emergency.remaining -= duration
				chunkRemaining -= duration
				if (emergency.remaining <= 0) remainingEmergencies.shift()
			}
		})

		const scheduledToday = Math.min(
			requestedMinutes,
			reservation - emergenciesInBuffer.unallocated,
		)
		emergencyMinutes += scheduledToday
		unscheduledEmergencyMinutes += requestedMinutes - scheduledToday

		emergenciesInBuffer.remaining.forEach((interval, index) => {
			bufferMinutes += minutes(interval.end) - minutes(interval.start)
			events.push(
				makeEvent(
					`buffer-${dayIndex}-${index}`,
					'Buffer fix / urgenti',
					interval,
					'FIX_BUFFER',
					{ fixed: true, editable: false },
				),
			)
		})

		freeByDay.push(free)
	})

	const projectSlots = freeByDay
		.flat()
		.sort((a, b) => a.start.getTime() - b.start.getTime())
	const availableProjectMinutes = projectSlots.reduce(
		(total, interval) =>
			total + minutes(interval.end) - minutes(interval.start),
		0,
	)
	const p1 = projects.find(
		(project) => project.priority === 'P1' && project.name.trim(),
	)
	const p2 = projects.find(
		(project) => project.priority === 'P2' && project.name.trim(),
	)
	const p3Projects = projects.filter(
		(project) => project.priority === 'P3' && project.name.trim(),
	)
	const activeP1 = p1 ?? (!p1 && p2 ? p2 : undefined)
	const activeP3: Project[] =
		p3Projects.length > 0
			? p3Projects
			: [
					{
						id: 'p3-general',
						name: 'Sviluppo e formazione',
						description: 'Attività residue',
						priority: 'P3',
					},
				]
	const projectMinutes: Record<ProjectPriority, number> = {
		P1: 0,
		P2: 0,
		P3: 0,
	}
	const remainingSlots = projectSlots

	const allocate = (
		project: Project,
		type: EventType,
		requested: number,
		category: ProjectPriority,
	) => {
		let remaining = requested
		while (remaining > 0 && remainingSlots.length > 0) {
			const slot = remainingSlots[0]
			const duration = Math.min(
				remaining,
				minutes(slot.end) - minutes(slot.start),
			)
			if (duration <= 0) {
				remainingSlots.shift()
				continue
			}
			const end = new Date(slot.start.getTime() + duration * 60_000)
			events.push(
				makeEvent(
					`${project.id}-${localDateTime(slot.start)}`,
					project.name,
					{ start: slot.start, end },
					type,
					{ projectId: project.id },
				),
			)
			projectMinutes[category] += duration
			remaining -= duration
			slot.start = end
			if (slot.start >= slot.end) remainingSlots.shift()
		}
	}

	if (activeP1)
		allocate(
			activeP1,
			'PROJECT_P1',
			Math.min(600, availableProjectMinutes),
			'P1',
		)
	if (p1 && p2)
		allocate(
			p2,
			'PROJECT_P2',
			Math.min(540, Math.max(0, availableProjectMinutes - projectMinutes.P1)),
			'P2',
		)

	const p3Total = remainingSlots.reduce(
		(total, interval) =>
			total + minutes(interval.end) - minutes(interval.start),
		0,
	)
	let p3Distributed = 0
	activeP3.forEach((project, index) => {
		const share =
			index === activeP3.length - 1
				? p3Total - p3Distributed
				: Math.floor(p3Total / activeP3.length)
		p3Distributed += share
		allocate(project, 'PROJECT_P3', share, 'P3')
	})

	return {
		events: events.sort((a, b) => a.start.localeCompare(b.start)),
		projectMinutes,
		bufferMinutes,
		emergencyMinutes,
		unscheduledEmergencyMinutes,
	}
}

export function getMonday(date = new Date()): Date {
	const monday = new Date(date)
	monday.setHours(0, 0, 0, 0)
	monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
	return monday
}

export function weekKey(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, '0')
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
