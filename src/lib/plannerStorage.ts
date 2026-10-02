import { atom } from 'jotai'
import {
	type CalendarEvent,
	type Emergency,
	getMonday,
	type Project,
	weekKey,
} from './scheduler'

const STORAGE_KEY = 'devplanner:planner:v1'

export interface Retrospective {
	notes: string
	completedTasks: string
	nextWeek: string
}

export interface WeekPlannerData {
	projects: Project[]
	emergencies: Emergency[]
	meetings: CalendarEvent[]
	weeklyBudgets: { P1: number; P2: number }
	customEvents: CalendarEvent[]
	eventOverrides: Record<string, CalendarEvent>
	deletedEventIds: string[]
	retrospective: Retrospective
}

export interface PlannerData {
	weeks: Record<string, WeekPlannerData>
	meetingCleanupWeek: string
	retrospectiveAlertWeek: string
}

export const EMPTY_WEEK_DATA: WeekPlannerData = {
	projects: [],
	emergencies: [],
	meetings: [],
	weeklyBudgets: { P1: 600, P2: 360 },
	customEvents: [],
	eventOverrides: {},
	deletedEventIds: [],
	retrospective: { notes: '', completedTasks: '', nextWeek: '' },
}

function isWeekPlannerData(
	value: unknown,
): value is Partial<WeekPlannerData> &
	Pick<
		WeekPlannerData,
		| 'projects'
		| 'emergencies'
		| 'customEvents'
		| 'deletedEventIds'
		| 'eventOverrides'
		| 'retrospective'
	> {
	if (!value || typeof value !== 'object') return false
	const candidate = value as Partial<WeekPlannerData>
	return (
		Array.isArray(candidate.projects) &&
		Array.isArray(candidate.emergencies) &&
		Array.isArray(candidate.customEvents) &&
		Array.isArray(candidate.deletedEventIds) &&
		Boolean(
			candidate.eventOverrides && typeof candidate.eventOverrides === 'object',
		) &&
		Boolean(
			candidate.retrospective && typeof candidate.retrospective === 'object',
		)
	)
}

function normalizeWeek(value: Partial<WeekPlannerData>): WeekPlannerData {
	return {
		...EMPTY_WEEK_DATA,
		...value,
		emergencies: (value.emergencies ?? []).map(normalizeEmergency),
		meetings: value.meetings ?? [],
		weeklyBudgets: value.weeklyBudgets ?? { P1: 600, P2: 360 },
	}
}

function normalizeEmergency(emergency: Emergency): Emergency {
	const withStatus = {
		...emergency,
		status: emergency.status ?? ('TODO' as const),
	}
	if (!emergency.startTime) return withStatus
	const [startHours, startMinutes = 0] = emergency.startTime
		.split(':')
		.map(Number)
	const startHour = Math.floor((startHours * 60 + startMinutes) / 60)
	const endMinutes = emergency.endTime
		? emergency.endTime
				.split(':')
				.map(Number)
				.reduce(
					(hour, minute, index) => hour + minute * (index === 0 ? 60 : 1),
					0,
				)
		: startHours * 60 + startMinutes + emergency.durationMinutes
	const endHour = Math.ceil(endMinutes / 60)
	const format = (hour: number) => `${String(hour).padStart(2, '0')}:00`
	return {
		...withStatus,
		startTime: format(startHour),
		endTime: format(endHour),
		durationMinutes: Math.max(60, (endHour - startHour) * 60),
	}
}

export function expireWeeklyMeetings(
	data: PlannerData,
	now = new Date(),
): PlannerData {
	const monday = getMonday(now)
	const cutoff = new Date(monday)
	cutoff.setHours(14, 0, 0, 0)
	const currentWeek = weekKey(monday)
	if (now < cutoff || data.meetingCleanupWeek === currentWeek) return data
	return {
		...data,
		meetingCleanupWeek: currentWeek,
		weeks: Object.fromEntries(
			Object.entries(data.weeks).map(([key, week]) => [
				key,
				{ ...week, meetings: [] },
			]),
		),
	}
}

export function loadPlannerData(now = new Date()): PlannerData {
	if (typeof window === 'undefined')
		return { weeks: {}, meetingCleanupWeek: '', retrospectiveAlertWeek: '' }

	try {
		const stored = window.localStorage.getItem(STORAGE_KEY)
		const parsed: unknown = stored ? JSON.parse(stored) : { weeks: {} }
		if (!parsed || typeof parsed !== 'object' || !('weeks' in parsed))
			return { weeks: {}, meetingCleanupWeek: '', retrospectiveAlertWeek: '' }

		const parsedData = parsed as {
			weeks: Record<string, unknown>
			meetingCleanupWeek?: string
			retrospectiveAlertWeek?: string
		}
		const weeks = parsedData.weeks
		if (!weeks || typeof weeks !== 'object')
			return { weeks: {}, meetingCleanupWeek: '', retrospectiveAlertWeek: '' }

		const currentWeekKey = weekKey(getMonday(now))
		let changed = false
		const validWeeks = Object.fromEntries(
			Object.entries(weeks).flatMap(([key, value]) => {
				if (!isWeekPlannerData(value)) {
					changed = true
					return []
				}

				const week = normalizeWeek(value)
				if (
					value.emergencies.some(
						(emergency) => emergency.startTime && !emergency.endTime,
					)
				)
					changed = true
				if (
					key < currentWeekKey &&
					(week.customEvents.length > 0 ||
						Object.keys(week.eventOverrides).length > 0 ||
						week.deletedEventIds.length > 0)
				) {
					changed = true
					return [
						[
							key,
							{
								...week,
								customEvents: [],
								eventOverrides: {},
								deletedEventIds: [],
							},
						],
					]
				}

				return [[key, week]]
			}),
		)

		const previousCleanupWeek = parsedData.meetingCleanupWeek ?? ''
		const data = expireWeeklyMeetings(
			{
				weeks: validWeeks,
				meetingCleanupWeek: previousCleanupWeek,
				retrospectiveAlertWeek: parsedData.retrospectiveAlertWeek ?? '',
			},
			now,
		)
		if (changed || data.meetingCleanupWeek !== previousCleanupWeek)
			savePlannerData(data)
		return data
	} catch {
		return { weeks: {}, meetingCleanupWeek: '', retrospectiveAlertWeek: '' }
	}
}

export function savePlannerData(data: PlannerData): void {
	if (typeof window === 'undefined') return
	window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export const plannerDataAtom = atom<PlannerData>(loadPlannerData())
