import { Check, Copy, Pencil, Plus, Trash2 } from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'
import type { Retrospective } from '../lib/plannerStorage'
import {
	type CalendarEvent,
	DAY_NAMES,
	DURATION_OPTIONS,
	dayIndex,
	type FixedBlock,
	type Project,
	type ProjectPriority,
	type Settings,
	TYPE_LABELS,
	WEEKLY_MAX,
} from '../lib/scheduler'

export const fieldClass =
	'w-full border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-emerald-400 disabled:opacity-40'
export const primaryButtonClass =
	'inline-flex items-center justify-center gap-2 bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-300 disabled:opacity-40'
export const secondaryButtonClass =
	'inline-flex items-center gap-2 border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500 hover:text-white disabled:opacity-40'

const newId = () => crypto.randomUUID()

export interface SlotRequest {
	day: number
	start: string
	end: string
}

function slotLabel(event: CalendarEvent) {
	return `${DAY_NAMES[dayIndex(new Date(event.start))]} ${event.start.slice(8, 10)}/${event.start.slice(5, 7)} · ${event.start.slice(11, 16)}–${event.end.slice(11, 16)}`
}

function ViewHeader({
	title,
	text,
	children,
}: {
	title: string
	text: string
	children?: ReactNode
}) {
	return (
		<div className="flex flex-wrap items-end justify-between gap-3 border-slate-800 border-b pb-4">
			<div>
				<h3 className="font-semibold text-lg">{title}</h3>
				<p className="mt-1 text-slate-400 text-sm">{text}</p>
			</div>
			{children}
		</div>
	)
}

function EventRow({
	event,
	label,
	readOnly,
	onEdit,
	onDelete,
}: {
	event: CalendarEvent
	label?: string
	readOnly: boolean
	onEdit: (event: CalendarEvent) => void
	onDelete: (event: CalendarEvent) => void
}) {
	return (
		<div className="flex items-center justify-between gap-4 py-3">
			<div className="min-w-0">
				<p
					className={`truncate font-medium text-sm ${event.declined ? 'line-through opacity-50' : ''}`}
				>
					{event.title}
					{label && (
						<span className="ml-2 text-slate-500 text-xs">{label}</span>
					)}
				</p>
				<p className="mt-1 text-slate-500 text-xs">
					{event.type === 'VACATION'
						? `${slotLabel(event).split(' · ')[0]} · intera giornata`
						: slotLabel(event)}
				</p>
			</div>
			{!readOnly && (
				<div className="flex gap-1">
					<button
						type="button"
						title="Modifica"
						aria-label={`Modifica ${event.title}`}
						onClick={() => onEdit(event)}
						className="rounded p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
					>
						<Pencil size={15} />
					</button>
					<button
						type="button"
						title="Elimina"
						aria-label={`Elimina ${event.title}`}
						onClick={() => onDelete(event)}
						className="rounded p-2 text-slate-500 hover:bg-red-950/40 hover:text-red-300"
					>
						<Trash2 size={15} />
					</button>
				</div>
			)}
		</div>
	)
}

function SlotFields({
	days,
	value,
	onChange,
	disabled,
	withTimes = true,
}: {
	days: number[]
	value: SlotRequest
	onChange: (value: SlotRequest) => void
	disabled?: boolean
	withTimes?: boolean
}) {
	return (
		<>
			<select
				className={fieldClass}
				value={value.day}
				disabled={disabled}
				onChange={(event) =>
					onChange({ ...value, day: Number(event.target.value) })
				}
				aria-label="Giorno"
			>
				{days.map((day) => (
					<option key={day} value={day}>
						{DAY_NAMES[day]}
					</option>
				))}
			</select>
			{withTimes && (
				<>
					<input
						className={fieldClass}
						type="time"
						step="900"
						value={value.start}
						disabled={disabled}
						onChange={(event) =>
							onChange({ ...value, start: event.target.value })
						}
						aria-label="Dalle"
					/>
					<input
						className={fieldClass}
						type="time"
						step="900"
						value={value.end}
						disabled={disabled}
						onChange={(event) =>
							onChange({ ...value, end: event.target.value })
						}
						aria-label="Alle"
					/>
				</>
			)}
		</>
	)
}

/* ------------------------------------------------------------------ Progetti */

export function ProjectsView({
	projects,
	events,
	settings,
	readOnly,
	onSaveProject,
	onRemoveProject,
	onAddProjectMeeting,
	onEdit,
	onDelete,
}: {
	projects: Project[]
	events: CalendarEvent[]
	settings: Settings
	readOnly: boolean
	onSaveProject: (project: Project) => void
	onRemoveProject: (project: Project) => void
	onAddProjectMeeting: (project: Project, slot: SlotRequest) => boolean
	onEdit: (event: CalendarEvent) => void
	onDelete: (event: CalendarEvent) => void
}) {
	const p1 = projects.find((project) => project.priority === 'P1')
	const p2 = projects.find((project) => project.priority === 'P2')
	const p3Projects = projects.filter((project) => project.priority === 'P3')
	const [p3Name, setP3Name] = useState('')
	const [p3Description, setP3Description] = useState('')
	const [p3Duration, setP3Duration] = useState(60)

	const addP3 = (event: FormEvent) => {
		event.preventDefault()
		if (!p3Name.trim()) return
		onSaveProject({
			id: newId(),
			name: p3Name.trim(),
			description: p3Description.trim(),
			priority: 'P3',
			durationMinutes: p3Duration,
		})
		setP3Name('')
		setP3Description('')
	}
	const meetingsOf = (project: Project) =>
		events.filter(
			(event) => event.type === 'MEETING' && event.projectId === project.id,
		)

	return (
		<div className="space-y-6">
			<ViewHeader
				title="Progetti della settimana"
				text="Inserisci prima il progetto P1, poi P2 e infine i P3. Gli slot P1/P2 vengono distribuiti con «Rigenera piano»."
			/>
			<div className="grid gap-5 lg:grid-cols-2">
				<PriorityProjectForm
					key={p1?.id ?? 'p1-new'}
					priority="P1"
					project={p1}
					settings={settings}
					disabled={readOnly}
					meetings={p1 ? meetingsOf(p1) : []}
					onSave={onSaveProject}
					onRemove={onRemoveProject}
					onAddMeeting={onAddProjectMeeting}
					onEdit={onEdit}
					onDelete={onDelete}
				/>
				<PriorityProjectForm
					key={p2?.id ?? 'p2-new'}
					priority="P2"
					project={p2}
					settings={settings}
					disabled={readOnly || !p1}
					disabledReason={!p1 ? 'Inserisci prima il progetto P1.' : undefined}
					meetings={p2 ? meetingsOf(p2) : []}
					onSave={onSaveProject}
					onRemove={onRemoveProject}
					onAddMeeting={onAddProjectMeeting}
					onEdit={onEdit}
					onDelete={onDelete}
				/>
			</div>
			<section className="border-slate-800 border-t pt-5">
				<div className="mb-4">
					<h4 className="font-semibold text-emerald-300">Progetti P3</h4>
					<p className="mt-1 text-slate-400 text-sm">
						Attività minori: lo slot viene inserito automaticamente nel primo
						spazio libero (max 2 h al giorno).
						{!p2 && ' Inserisci prima i progetti P1 e P2.'}
					</p>
				</div>
				<form
					onSubmit={addP3}
					className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_140px_auto]"
				>
					<input
						className={fieldClass}
						value={p3Name}
						disabled={readOnly || !p2}
						onChange={(event) => setP3Name(event.target.value)}
						placeholder="Nome attività"
						aria-label="Nome attività P3"
					/>
					<input
						className={fieldClass}
						value={p3Description}
						disabled={readOnly || !p2}
						onChange={(event) => setP3Description(event.target.value)}
						placeholder="Note / descrizione"
						aria-label="Note attività P3"
					/>
					<DurationSelect
						value={p3Duration}
						onChange={setP3Duration}
						disabled={readOnly || !p2}
					/>
					<button
						className={secondaryButtonClass}
						type="submit"
						disabled={readOnly || !p2}
					>
						<Plus size={16} /> Aggiungi P3
					</button>
				</form>
				<div className="mt-4 divide-y divide-slate-800 border-slate-800 border-y">
					{p3Projects.length === 0 && (
						<p className="py-5 text-slate-500 text-sm">Nessuna attività P3.</p>
					)}
					{p3Projects.map((project) => {
						const slots = events.filter(
							(event) =>
								event.projectId === project.id && event.type === 'PROJECT_P3',
						)
						return (
							<div key={project.id} className="py-3">
								<div className="flex items-center justify-between gap-4">
									<div className="min-w-0">
										<p className="truncate font-medium text-sm">
											{project.name}
											<span className="ml-2 text-slate-500 text-xs">
												{project.durationMinutes ?? 60} min
											</span>
										</p>
										{project.description && (
											<p className="mt-0.5 truncate text-slate-500 text-xs">
												{project.description}
											</p>
										)}
										<p className="mt-1 text-emerald-300 text-xs">
											{slots.length
												? slots.map(slotLabel).join(' · ')
												: 'Non ancora a calendario'}
										</p>
									</div>
									{!readOnly && (
										<button
											type="button"
											aria-label={`Elimina ${project.name}`}
											onClick={() => onRemoveProject(project)}
											className="rounded p-2 text-slate-500 hover:bg-red-950/40 hover:text-red-300"
										>
											<Trash2 size={16} />
										</button>
									)}
								</div>
								<ProjectMeetings
									project={project}
									settings={settings}
									disabled={readOnly}
									meetings={meetingsOf(project)}
									onAddMeeting={onAddProjectMeeting}
									onEdit={onEdit}
									onDelete={onDelete}
								/>
							</div>
						)
					})}
				</div>
			</section>
		</div>
	)
}

export function DurationSelect({
	value,
	onChange,
	disabled,
}: {
	value: number
	onChange: (value: number) => void
	disabled?: boolean
}) {
	return (
		<select
			className={fieldClass}
			value={value}
			disabled={disabled}
			onChange={(event) => onChange(Number(event.target.value))}
			aria-label="Durata"
		>
			{DURATION_OPTIONS.map((minutes) => (
				<option key={minutes} value={minutes}>
					{minutes} min
				</option>
			))}
		</select>
	)
}

function ProjectMeetings({
	project,
	settings,
	disabled,
	meetings,
	onAddMeeting,
	onEdit,
	onDelete,
}: {
	project: Project
	settings: Settings
	disabled: boolean
	meetings: CalendarEvent[]
	onAddMeeting: (project: Project, slot: SlotRequest) => boolean
	onEdit: (event: CalendarEvent) => void
	onDelete: (event: CalendarEvent) => void
}) {
	const [slot, setSlot] = useState<SlotRequest>({
		day: settings.workDays[0] ?? 0,
		start: '11:00',
		end: '12:00',
	})
	return (
		<div className="mt-3 border-slate-800 border-l pl-3">
			<p className="font-semibold text-[11px] text-cyan-300 uppercase">
				Meeting del progetto (facoltativi, non spostabili)
			</p>
			<div className="mt-2 grid grid-cols-[1fr_100px_100px_auto] gap-2">
				<SlotFields
					days={settings.workDays}
					value={slot}
					onChange={setSlot}
					disabled={disabled}
				/>
				<button
					type="button"
					disabled={disabled || slot.end <= slot.start}
					onClick={() => onAddMeeting(project, slot)}
					className={secondaryButtonClass}
				>
					<Plus size={14} />
				</button>
			</div>
			<div className="divide-y divide-slate-800">
				{meetings.map((meeting) => (
					<EventRow
						key={meeting.id}
						event={meeting}
						readOnly={disabled}
						onEdit={onEdit}
						onDelete={onDelete}
					/>
				))}
			</div>
		</div>
	)
}

function PriorityProjectForm({
	priority,
	project,
	settings,
	disabled,
	disabledReason,
	meetings,
	onSave,
	onRemove,
	onAddMeeting,
	onEdit,
	onDelete,
}: {
	priority: 'P1' | 'P2'
	project?: Project
	settings: Settings
	disabled: boolean
	disabledReason?: string
	meetings: CalendarEvent[]
	onSave: (project: Project) => void
	onRemove: (project: Project) => void
	onAddMeeting: (project: Project, slot: SlotRequest) => boolean
	onEdit: (event: CalendarEvent) => void
	onDelete: (event: CalendarEvent) => void
}) {
	const isP1 = priority === 'P1'
	const min = settings.minBudgets[priority]
	const max = WEEKLY_MAX[priority]
	const [name, setName] = useState(project?.name ?? '')
	const [description, setDescription] = useState(project?.description ?? '')
	const [hours, setHours] = useState(
		String((project?.budgetMinutes ?? min) / 60),
	)
	const submit = (event: FormEvent) => {
		event.preventDefault()
		if (!name.trim()) return
		onSave({
			id: project?.id ?? newId(),
			name: name.trim(),
			description: description.trim(),
			priority,
			budgetMinutes: Math.min(
				max,
				Math.max(min, Math.round(Number(hours) * 60)),
			),
		})
	}
	return (
		<section
			className={`border-l-2 ${isP1 ? 'border-rose-400' : 'border-amber-400'} bg-[#0c1319] p-4`}
		>
			<form onSubmit={submit}>
				<div className="flex items-center justify-between">
					<h4
						className={`font-semibold ${isP1 ? 'text-rose-300' : 'text-amber-300'}`}
					>
						Progetto {priority}
					</h4>
					<span className="text-slate-500 text-xs">
						{min / 60}-{max / 60} h/settimana · max {isP1 ? 4 : 2} h/giorno
					</span>
				</div>
				{disabledReason && (
					<p className="mt-2 text-amber-300 text-xs">{disabledReason}</p>
				)}
				<label className="mt-4 mb-3 block font-medium text-slate-400 text-xs">
					Nome progetto
					<input
						className={`${fieldClass} mt-1.5`}
						value={name}
						disabled={disabled}
						onChange={(event) => setName(event.target.value)}
					/>
				</label>
				<label className="mb-3 block font-medium text-slate-400 text-xs">
					Ore complessive settimanali
					<input
						className={`${fieldClass} mt-1.5 max-w-40`}
						type="number"
						min={min / 60}
						max={max / 60}
						step="0.25"
						value={hours}
						disabled={disabled}
						onChange={(event) => setHours(event.target.value)}
					/>
				</label>
				<label className="block font-medium text-slate-400 text-xs">
					Descrizione / note
					<textarea
						className={`${fieldClass} mt-1.5 resize-y`}
						rows={2}
						value={description}
						disabled={disabled}
						onChange={(event) => setDescription(event.target.value)}
					/>
				</label>
				<div className="mt-3 flex justify-between">
					<button
						type="submit"
						className={primaryButtonClass}
						disabled={disabled || !name.trim()}
					>
						<Check size={15} /> Salva {priority}
					</button>
					{project && !disabled && (
						<button
							type="button"
							onClick={() => onRemove(project)}
							className={secondaryButtonClass}
						>
							<Trash2 size={14} /> Elimina
						</button>
					)}
				</div>
			</form>
			{project && (
				<ProjectMeetings
					project={project}
					settings={settings}
					disabled={disabled}
					meetings={meetings}
					onAddMeeting={onAddMeeting}
					onEdit={onEdit}
					onDelete={onDelete}
				/>
			)}
		</section>
	)
}

/* ---------------------------------------------------------------- Emergenze */

export function EmergenciesView({
	events,
	readOnly,
	onAdd,
	onEdit,
	onDelete,
}: {
	events: CalendarEvent[]
	readOnly: boolean
	onAdd: (title: string, duration: number) => void
	onEdit: (event: CalendarEvent) => void
	onDelete: (event: CalendarEvent) => void
}) {
	const [title, setTitle] = useState('')
	const [duration, setDuration] = useState(60)
	const emergencies = events.filter((event) => event.type === 'EMERGENCY')
	const submit = (event: FormEvent) => {
		event.preventDefault()
		if (!title.trim()) return
		onAdd(title.trim(), duration)
		setTitle('')
	}
	return (
		<div className="max-w-4xl space-y-6">
			<ViewHeader
				title="Emergenze"
				text="Una sola emergenza al giorno (max 2 h). Viene inserita nel primo slot libero da permessi, ferie e meeting, spostando gli slot di priorità inferiore."
			/>
			<form
				onSubmit={submit}
				className="grid gap-3 sm:grid-cols-[1fr_150px_auto]"
			>
				<input
					className={fieldClass}
					value={title}
					disabled={readOnly}
					onChange={(event) => setTitle(event.target.value)}
					placeholder="Descrizione breve"
					aria-label="Descrizione emergenza"
				/>
				<DurationSelect
					value={duration}
					onChange={setDuration}
					disabled={readOnly}
				/>
				<button
					className={primaryButtonClass}
					type="submit"
					disabled={readOnly}
				>
					<Plus size={16} /> Registra
				</button>
			</form>
			<div className="divide-y divide-slate-800 border-slate-800 border-y">
				{emergencies.length === 0 && (
					<p className="py-6 text-slate-500 text-sm">
						Nessuna emergenza questa settimana.
					</p>
				)}
				{emergencies.map((event) => (
					<EventRow
						key={event.id}
						event={event}
						readOnly={readOnly}
						onEdit={onEdit}
						onDelete={onDelete}
					/>
				))}
			</div>
		</div>
	)
}

/* ------------------------------------------------------------ Permessi/Ferie */

export function AbsencesView({
	events,
	settings,
	readOnly,
	onAdd,
	onEdit,
	onDelete,
}: {
	events: CalendarEvent[]
	settings: Settings
	readOnly: boolean
	onAdd: (
		type: 'LEAVE' | 'VACATION',
		title: string,
		slot: SlotRequest,
	) => boolean
	onEdit: (event: CalendarEvent) => void
	onDelete: (event: CalendarEvent) => void
}) {
	const [type, setType] = useState<'LEAVE' | 'VACATION'>('LEAVE')
	const [title, setTitle] = useState('')
	const [slot, setSlot] = useState<SlotRequest>({
		day: settings.workDays[0] ?? 0,
		start: '09:15',
		end: '11:00',
	})
	const absences = events.filter(
		(event) => event.type === 'LEAVE' || event.type === 'VACATION',
	)
	const submit = (event: FormEvent) => {
		event.preventDefault()
		if (type === 'LEAVE' && slot.end <= slot.start) return
		if (onAdd(type, title.trim() || TYPE_LABELS[type], slot)) setTitle('')
	}
	return (
		<div className="max-w-4xl space-y-6">
			<ViewHeader
				title="Permessi e ferie"
				text="Priorità massima. Se si sovrappongono a slot già presenti comparirà il pannello dei conflitti: nessuno slot viene modificato automaticamente."
			/>
			<form
				onSubmit={submit}
				className="grid gap-3 sm:grid-cols-[140px_1fr_140px_110px_110px_auto]"
			>
				<select
					className={fieldClass}
					value={type}
					disabled={readOnly}
					onChange={(event) =>
						setType(event.target.value as 'LEAVE' | 'VACATION')
					}
					aria-label="Tipo assenza"
				>
					<option value="LEAVE">Permesso</option>
					<option value="VACATION">Ferie (giornata)</option>
				</select>
				<input
					className={fieldClass}
					value={title}
					disabled={readOnly}
					onChange={(event) => setTitle(event.target.value)}
					placeholder="Motivo (facoltativo)"
					aria-label="Motivo"
				/>
				<SlotFields
					days={settings.workDays}
					value={slot}
					onChange={setSlot}
					disabled={readOnly}
					withTimes={type === 'LEAVE'}
				/>
				<button
					className={primaryButtonClass}
					type="submit"
					disabled={readOnly}
				>
					<Plus size={16} /> Aggiungi
				</button>
			</form>
			<div className="divide-y divide-slate-800 border-slate-800 border-y">
				{absences.length === 0 && (
					<p className="py-6 text-slate-500 text-sm">
						Nessun permesso o giorno di ferie.
					</p>
				)}
				{absences.map((event) => (
					<EventRow
						key={event.id}
						event={event}
						label={TYPE_LABELS[event.type]}
						readOnly={readOnly}
						onEdit={onEdit}
						onDelete={onDelete}
					/>
				))}
			</div>
		</div>
	)
}

/* ------------------------------------------------------------------ Meeting */

export function MeetingsView({
	events,
	projects,
	settings,
	readOnly,
	onAdd,
	onEdit,
	onDelete,
}: {
	events: CalendarEvent[]
	projects: Project[]
	settings: Settings
	readOnly: boolean
	onAdd: (
		title: string,
		projectId: string | undefined,
		slot: SlotRequest,
	) => boolean
	onEdit: (event: CalendarEvent) => void
	onDelete: (event: CalendarEvent) => void
}) {
	const [title, setTitle] = useState('')
	const [projectId, setProjectId] = useState('')
	const [slot, setSlot] = useState<SlotRequest>({
		day: settings.workDays[0] ?? 0,
		start: '11:00',
		end: '12:00',
	})
	const meetings = events.filter((event) => event.type === 'MEETING')
	const fixed = events.filter((event) => event.type === 'FIXED')
	const projectName = (id?: string) =>
		projects.find((project) => project.id === id)
	const submit = (event: FormEvent) => {
		event.preventDefault()
		const project = projectName(projectId)
		const name = title.trim() || (project ? `Meeting ${project.name}` : '')
		if (!name || slot.end <= slot.start) return
		if (onAdd(name, project?.id, slot)) setTitle('')
	}
	return (
		<div className="max-w-4xl space-y-6">
			<ViewHeader
				title="Meeting"
				text="I meeting hanno priorità su emergenze e progetti e non vengono mai spostati automaticamente."
			/>
			<form
				onSubmit={submit}
				className="grid gap-3 sm:grid-cols-[1fr_170px_130px_100px_100px_auto]"
			>
				<input
					className={fieldClass}
					value={title}
					disabled={readOnly}
					onChange={(event) => setTitle(event.target.value)}
					placeholder="Titolo meeting"
					aria-label="Titolo meeting"
				/>
				<ProjectSelect
					projects={projects}
					value={projectId}
					onChange={setProjectId}
					disabled={readOnly}
				/>
				<SlotFields
					days={settings.workDays}
					value={slot}
					onChange={setSlot}
					disabled={readOnly}
				/>
				<button
					className={primaryButtonClass}
					type="submit"
					disabled={readOnly}
				>
					<Plus size={16} /> Aggiungi
				</button>
			</form>
			<div className="divide-y divide-slate-800 border-slate-800 border-y">
				{meetings.length === 0 && (
					<p className="py-6 text-slate-500 text-sm">
						Nessun meeting inserito.
					</p>
				)}
				{meetings.map((event) => {
					const project = projectName(event.projectId)
					return (
						<EventRow
							key={event.id}
							event={event}
							label={
								project ? `${project.priority} · ${project.name}` : 'Generico'
							}
							readOnly={readOnly}
							onEdit={onEdit}
							onDelete={onDelete}
						/>
					)
				})}
			</div>
			<section>
				<h4 className="mb-2 font-semibold text-slate-300 text-sm">
					Eventi obbligatori/bloccati (da Impostazioni)
				</h4>
				<div className="divide-y divide-slate-800 border-slate-800 border-y">
					{fixed.map((event) => (
						<div key={event.id} className="flex justify-between py-2 text-sm">
							<span className={event.declined ? 'line-through opacity-50' : ''}>
								{event.title}
							</span>
							<span className="font-mono text-slate-400 text-xs">
								{slotLabel(event)}
							</span>
						</div>
					))}
				</div>
			</section>
		</div>
	)
}

export function ProjectSelect({
	projects,
	value,
	onChange,
	disabled,
}: {
	projects: Project[]
	value: string
	onChange: (value: string) => void
	disabled?: boolean
}) {
	return (
		<select
			className={fieldClass}
			value={value}
			disabled={disabled}
			onChange={(event) => onChange(event.target.value)}
			aria-label="Progetto del meeting"
		>
			<option value="">Generico (nessun progetto)</option>
			{(['P1', 'P2', 'P3'] as ProjectPriority[]).flatMap((priority) =>
				projects
					.filter((project) => project.priority === priority)
					.map((project) => (
						<option key={project.id} value={project.id}>
							{priority} · {project.name}
						</option>
					)),
			)}
		</select>
	)
}

/* -------------------------------------------------------------- Impostazioni */

export function SettingsView({
	settings,
	onChange,
}: {
	settings: Settings
	onChange: (settings: Settings) => void
}) {
	const [draft, setDraft] = useState(settings)
	const [holiday, setHoliday] = useState('')
	const [block, setBlock] = useState<Omit<FixedBlock, 'id'>>({
		day: 0,
		start: '09:15',
		end: '10:00',
		title: '',
	})
	const update = (patch: Partial<Settings>) =>
		setDraft((current) => ({ ...current, ...patch }))
	const toggleDay = (day: number) =>
		update({
			workDays: draft.workDays.includes(day)
				? draft.workDays.filter((item) => item !== day)
				: [...draft.workDays, day].sort((a, b) => a - b),
		})
	const fixedMinutes = draft.fixedBlocks.reduce((total, item) => {
		const [sh, sm] = item.start.split(':').map(Number)
		const [eh, em] = item.end.split(':').map(Number)
		return total + eh * 60 + em - sh * 60 - sm
	}, 0)
	const label = 'block font-medium text-slate-400 text-xs'
	return (
		<div className="max-w-4xl space-y-6">
			<ViewHeader
				title="Impostazioni"
				text="Orari lavorativi, festivi, eventi obbligatori e budget minimi."
			>
				<button
					type="button"
					className={primaryButtonClass}
					onClick={() => onChange(draft)}
				>
					<Check size={16} /> Salva impostazioni
				</button>
			</ViewHeader>
			<section className="grid gap-4 sm:grid-cols-3">
				<label className={label}>
					Inizio giornata
					<input
						className={`${fieldClass} mt-1.5`}
						type="time"
						step="900"
						value={draft.workStart}
						onChange={(event) => update({ workStart: event.target.value })}
					/>
				</label>
				<label className={label}>
					Fine giornata
					<input
						className={`${fieldClass} mt-1.5`}
						type="time"
						step="900"
						value={draft.workEnd}
						onChange={(event) => update({ workEnd: event.target.value })}
					/>
				</label>
				<label className={label}>
					Preparazione postazione (min, bloccati a inizio giornata)
					<input
						className={`${fieldClass} mt-1.5`}
						type="number"
						min={0}
						step={15}
						value={draft.setupMinutes}
						onChange={(event) =>
							update({ setupMinutes: Math.max(0, Number(event.target.value)) })
						}
					/>
				</label>
				<label className={label}>
					Pausa pranzo dalle
					<input
						className={`${fieldClass} mt-1.5`}
						type="time"
						step="900"
						value={draft.lunchStart}
						onChange={(event) => update({ lunchStart: event.target.value })}
					/>
				</label>
				<label className={label}>
					Pausa pranzo alle
					<input
						className={`${fieldClass} mt-1.5`}
						type="time"
						step="900"
						value={draft.lunchEnd}
						onChange={(event) => update({ lunchEnd: event.target.value })}
					/>
				</label>
				<label className={label}>
					Ore totali settimanali
					<input
						className={`${fieldClass} mt-1.5`}
						type="number"
						min={1}
						step={0.5}
						value={draft.weeklyHours}
						onChange={(event) =>
							update({ weeklyHours: Number(event.target.value) })
						}
					/>
				</label>
				<label className={label}>
					Minimo ore P1 / settimana
					<input
						className={`${fieldClass} mt-1.5`}
						type="number"
						min={0}
						max={20}
						step={0.5}
						value={draft.minBudgets.P1 / 60}
						onChange={(event) =>
							update({
								minBudgets: {
									...draft.minBudgets,
									P1: Math.round(Number(event.target.value) * 60),
								},
							})
						}
					/>
				</label>
				<label className={label}>
					Minimo ore P2 / settimana
					<input
						className={`${fieldClass} mt-1.5`}
						type="number"
						min={0}
						max={10}
						step={0.5}
						value={draft.minBudgets.P2 / 60}
						onChange={(event) =>
							update({
								minBudgets: {
									...draft.minBudgets,
									P2: Math.round(Number(event.target.value) * 60),
								},
							})
						}
					/>
				</label>
			</section>
			<section>
				<h4 className="mb-2 font-semibold text-sm">
					Giorni lavorativi (la domenica è sempre festiva)
				</h4>
				<div className="grid gap-2 sm:grid-cols-3">
					{DAY_NAMES.map((name, day) => (
						<div
							key={name}
							className="flex items-center gap-2 border border-slate-800 px-3 py-2 text-sm"
						>
							<label className="flex flex-1 items-center gap-2">
								<input
									type="checkbox"
									checked={draft.workDays.includes(day)}
									onChange={() => toggleDay(day)}
								/>
								{name}
							</label>
							<input
								className="w-24 border border-slate-700 bg-slate-950 px-1 py-1 text-xs"
								type="time"
								step="900"
								title="Fine giornata ridotta (facoltativa)"
								aria-label={`Fine ridotta ${name}`}
								value={draft.shortDays[String(day)] ?? ''}
								onChange={(event) => {
									const shortDays = { ...draft.shortDays }
									if (event.target.value)
										shortDays[String(day)] = event.target.value
									else delete shortDays[String(day)]
									update({ shortDays })
								}}
							/>
						</div>
					))}
				</div>
				<p className="mt-1 text-slate-500 text-xs">
					L'orario a destra indica un'uscita anticipata per quel giorno.
				</p>
			</section>
			<section>
				<h4 className="mb-2 font-semibold text-sm">Festivi dell'anno</h4>
				<div className="flex gap-2">
					<input
						className={`${fieldClass} max-w-52`}
						type="date"
						value={holiday}
						onChange={(event) => setHoliday(event.target.value)}
					/>
					<button
						type="button"
						className={secondaryButtonClass}
						disabled={!holiday}
						onClick={() => {
							update({
								holidays: [...new Set([...draft.holidays, holiday])].sort(),
							})
							setHoliday('')
						}}
					>
						<Plus size={14} /> Aggiungi
					</button>
				</div>
				<div className="mt-2 flex flex-wrap gap-2">
					{draft.holidays.map((item) => (
						<button
							key={item}
							type="button"
							title="Rimuovi"
							onClick={() =>
								update({
									holidays: draft.holidays.filter((value) => value !== item),
								})
							}
							className="border border-slate-700 px-2 py-1 text-xs hover:border-red-400"
						>
							{new Date(`${item}T00:00`).toLocaleDateString('it-IT')} ✕
						</button>
					))}
				</div>
			</section>
			<section>
				<h4 className="mb-2 font-semibold text-sm">
					Eventi obbligatori/bloccati · {(fixedMinutes / 60).toFixed(2)} h
					settimanali
				</h4>
				<div className="grid gap-2 sm:grid-cols-[1fr_130px_100px_100px_auto]">
					<input
						className={fieldClass}
						placeholder="Titolo"
						value={block.title}
						onChange={(event) =>
							setBlock({ ...block, title: event.target.value })
						}
					/>
					<SlotFields
						days={draft.workDays}
						value={block}
						onChange={(value) => setBlock({ ...block, ...value })}
					/>
					<button
						type="button"
						className={secondaryButtonClass}
						disabled={!block.title.trim() || block.end <= block.start}
						onClick={() => {
							update({
								fixedBlocks: [
									...draft.fixedBlocks,
									{ ...block, title: block.title.trim(), id: newId() },
								],
							})
							setBlock({ ...block, title: '' })
						}}
					>
						<Plus size={14} />
					</button>
				</div>
				<div className="mt-2 divide-y divide-slate-800 border-slate-800 border-y">
					{[...draft.fixedBlocks]
						.sort((a, b) => a.day - b.day || a.start.localeCompare(b.start))
						.map((item) => (
							<div
								key={item.id}
								className="flex items-center justify-between py-2 text-sm"
							>
								<span>
									{item.title}
									<span className="ml-2 font-mono text-slate-500 text-xs">
										{DAY_NAMES[item.day]} · {item.start}–{item.end}
									</span>
								</span>
								<button
									type="button"
									aria-label={`Elimina ${item.title}`}
									onClick={() =>
										update({
											fixedBlocks: draft.fixedBlocks.filter(
												(value) => value.id !== item.id,
											),
										})
									}
									className="rounded p-1 text-slate-500 hover:text-red-300"
								>
									<Trash2 size={14} />
								</button>
							</div>
						))}
				</div>
			</section>
		</div>
	)
}

/* ------------------------------------------------------------ Retrospettiva */

const REPORT_TYPES = [
	'VACATION',
	'LEAVE',
	'FIXED',
	'MEETING',
	'EMERGENCY',
	'PROJECT_P1',
	'PROJECT_P2',
	'PROJECT_P3',
	'CUSTOM',
]

export function RetrospectiveView({
	value,
	onChange,
	events,
	planAlerts,
	showReport,
	readOnly,
	now,
}: {
	value: Retrospective
	onChange: (value: Retrospective) => void
	events: CalendarEvent[]
	planAlerts: string[]
	showReport: boolean
	readOnly: boolean
	now: Date
}) {
	const [copied, setCopied] = useState(false)
	const slots = events
		.filter((event) => REPORT_TYPES.includes(event.type))
		.sort((left, right) => left.start.localeCompare(right.start))
	const reported = slots.filter((event) => !event.declined)
	const reportLine = (event: CalendarEvent) =>
		`${event.title} | ${new Date(event.start).toLocaleDateString('it-IT')} | ${event.type === 'VACATION' ? 'giornata intera' : `${event.start.slice(11, 16)}-${event.end.slice(11, 16)}`} | ${TYPE_LABELS[event.type]}`
	const copyReport = async () => {
		await navigator.clipboard.writeText(
			['NOME | DATA | ORARIO | TIPOLOGIA', ...reported.map(reportLine)].join(
				'\n',
			),
		)
		setCopied(true)
	}

	return (
		<div className="max-w-4xl space-y-5">
			<ViewHeader
				title="Retrospettiva settimanale"
				text="La nota viene richiamata il lunedì mattina della settimana successiva."
			/>
			<label className="block font-medium text-slate-300 text-sm">
				Nota per la prossima settimana
				<textarea
					className={`${fieldClass} mt-1.5 resize-y`}
					rows={5}
					value={value.nextWeek}
					disabled={readOnly}
					onChange={(event) =>
						onChange({ ...value, nextWeek: event.target.value })
					}
					placeholder="Priorità e promemoria per lunedì"
				/>
			</label>
			{planAlerts.length > 0 && (
				<section className="border-amber-400 border-l-2 bg-amber-950/30 px-4 py-3">
					<h4 className="mb-1 font-semibold text-amber-200 text-sm">
						Slot rimasti fuori / spostati dal piano
					</h4>
					<ul className="list-disc pl-4 text-amber-100 text-xs">
						{planAlerts.map((alert) => (
							<li key={alert}>{alert}</li>
						))}
					</ul>
				</section>
			)}
			<section>
				<h4 className="mb-2 font-semibold text-sm">Slot della settimana</h4>
				<p className="mb-2 text-slate-500 text-xs">
					Gli slot rifiutati sono barrati e non vengono conteggiati nel report.
				</p>
				<ul className="divide-y divide-slate-800 border-slate-800 border-y">
					{slots.map((event) => (
						<li
							key={event.id}
							className={`py-1.5 font-mono text-xs ${event.declined ? 'text-slate-600 line-through' : 'text-slate-300'}`}
						>
							{reportLine(event)}
						</li>
					))}
				</ul>
			</section>
			{showReport ? (
				<section
					aria-label="Report attività settimana"
					className="border-slate-800 border-y py-5"
				>
					<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
						<div>
							<h4 className="font-semibold">Report settimanale</h4>
							<p className="mt-1 text-slate-500 text-xs">
								Aggiornato alle{' '}
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
					<table className="w-full text-left text-xs">
						<thead className="text-slate-500 uppercase">
							<tr>
								<th className="py-1">Nome</th>
								<th>Data</th>
								<th>Orario</th>
								<th>Tipologia</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-800 font-mono text-slate-300">
							{reported.map((event) => (
								<tr key={event.id}>
									<td className="py-1">{event.title}</td>
									<td>{new Date(event.start).toLocaleDateString('it-IT')}</td>
									<td>
										{event.type === 'VACATION'
											? 'giornata'
											: `${event.start.slice(11, 16)}–${event.end.slice(11, 16)}`}
									</td>
									<td>{TYPE_LABELS[event.type]}</td>
								</tr>
							))}
						</tbody>
					</table>
				</section>
			) : (
				<p className="text-slate-500 text-xs">
					Il report è disponibile dalle 09:00 dell'ultimo giorno lavorativo fino
					a martedì alle 10:00 della settimana successiva.
				</p>
			)}
		</div>
	)
}
