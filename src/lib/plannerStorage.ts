import { atom } from 'jotai'
import {
	addDays,
	type CalendarEvent,
	DEFAULT_SETTINGS,
	getMonday,
	type Project,
	previousWeekCutoff,
	type Settings,
	weekKey,
} from './scheduler'

const STORAGE_KEY = 'devplanner:planner:v2'
const LEGACY_KEY = 'devplanner:planner:v1'

export interface Retrospective {
	nextWeek: string
}

export interface WeekPlannerData {
	projects: Project[]
	events: CalendarEvent[]
	declinedFixed: string[]
	/** Slot rimasti fuori dal calendario dopo "Rigenera piano" */
	planAlerts: string[]
	retrospective: Retrospective
}

export interface PlannerData {
	settings: Settings
	weeks: Record<string, WeekPlannerData>
	retrospectiveAlertWeek: string
}

export const EMPTY_WEEK_DATA: WeekPlannerData = {
	projects: [],
	events: [],
	declinedFixed: [],
	planAlerts: [],
	retrospective: { nextWeek: '' },
}

const EMPTY_DATA: PlannerData = {
	settings: DEFAULT_SETTINGS,
	weeks: {},
	retrospectiveAlertWeek: '',
}

function normalizeWeek(value: Partial<WeekPlannerData>): WeekPlannerData {
	return {
		projects: Array.isArray(value.projects) ? value.projects : [],
		events: Array.isArray(value.events) ? value.events : [],
		declinedFixed: Array.isArray(value.declinedFixed)
			? value.declinedFixed
			: [],
		planAlerts: Array.isArray(value.planAlerts) ? value.planAlerts : [],
		retrospective: { nextWeek: value.retrospective?.nextWeek ?? '' },
	}
}

/** Recupera progetti e note dalla versione precedente del salvataggio. */
function migrateLegacy(): PlannerData | undefined {
	const stored = window.localStorage.getItem(LEGACY_KEY)
	if (!stored) return undefined
	const legacy = JSON.parse(stored) as {
		weeks?: Record<
			string,
			{
				projects?: Project[]
				weeklyBudgets?: { P1: number; P2: number }
				retrospective?: Retrospective
			}
		>
	}
	const weeks = Object.fromEntries(
		Object.entries(legacy.weeks ?? {}).map(([key, week]) => [
			key,
			normalizeWeek({
				projects: (week.projects ?? []).map((project) => ({
					id: project.id,
					name: project.name,
					description: project.description ?? '',
					priority: project.priority,
					budgetMinutes:
						project.priority === 'P3'
							? undefined
							: week.weeklyBudgets?.[project.priority],
					durationMinutes: project.priority === 'P3' ? 60 : undefined,
				})),
				retrospective: { nextWeek: week.retrospective?.nextWeek ?? '' },
			}),
		]),
	)
	return { ...EMPTY_DATA, weeks }
}

/**
 * Dal martedì alle 10:00 gli eventi delle settimane precedenti vengono eliminati.
 * La nota retrospettiva della settimana appena chiusa resta per il promemoria.
 */
export function expireOldWeeks(
	data: PlannerData,
	now = new Date(),
): PlannerData {
	const current = getMonday(now)
	const previous = addDays(current, -7)
	const currentKey = weekKey(current)
	const previousKey = weekKey(previous)
	const afterCutoff = now >= previousWeekCutoff(previous)
	let changed = false
	const weeks = Object.fromEntries(
		Object.entries(data.weeks).flatMap(([key, week]) => {
			if (key >= currentKey) return [[key, week]]
			if (key === previousKey && !afterCutoff) return [[key, week]]
			const empty = week.events.length === 0 && week.projects.length === 0
			if (key === previousKey && week.retrospective.nextWeek.trim()) {
				if (empty) return [[key, week]]
				changed = true
				return [
					[key, { ...EMPTY_WEEK_DATA, retrospective: week.retrospective }],
				]
			}
			changed = true
			return []
		}),
	)
	return changed ? { ...data, weeks } : data
}

export function loadPlannerData(now = new Date()): PlannerData {
	if (typeof window === 'undefined') return EMPTY_DATA
	try {
		const stored = window.localStorage.getItem(STORAGE_KEY)
		const parsed = stored
			? (JSON.parse(stored) as Partial<PlannerData>)
			: (migrateLegacy() ?? EMPTY_DATA)
		const data: PlannerData = {
			settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
			weeks: Object.fromEntries(
				Object.entries(parsed.weeks ?? {}).map(([key, week]) => [
					key,
					normalizeWeek(week),
				]),
			),
			retrospectiveAlertWeek: parsed.retrospectiveAlertWeek ?? '',
		}
		return expireOldWeeks(data, now)
	} catch {
		return EMPTY_DATA
	}
}

export function savePlannerData(data: PlannerData): void {
	if (typeof window === 'undefined') return
	window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export const plannerDataAtom = atom<PlannerData>(loadPlannerData())
