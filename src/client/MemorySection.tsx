import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  BindProjectRequest,
  CandidateReviewRequest,
  DeleteProjectRequest,
  ExportProjectRequest,
  ExportProjectResult,
  MemorySnapshot,
  UpdateSettingsRequest,
} from '../remote-contract.js'
import type { MemoryLocaleKey } from './locales.js'
import css from './MemorySection.module.css'

export interface MemorySectionProps {
  load: () => Promise<MemorySnapshot>
  bindProject: (request: BindProjectRequest) => Promise<MemorySnapshot>
  updateSettings: (request: UpdateSettingsRequest) => Promise<MemorySnapshot>
  reviewCandidate: (request: CandidateReviewRequest) => Promise<MemorySnapshot>
  deleteProject: (request: DeleteProjectRequest) => Promise<MemorySnapshot>
  exportProject: (request: ExportProjectRequest) => Promise<ExportProjectResult>
  t: (key: MemoryLocaleKey) => string
}

type Candidate = MemorySnapshot['candidates'][number]

/** Stable geometry painted before the first Host snapshot arrives. */
function Skeleton(): ReactNode {
  return (
    <section className={`${css.section} ${css.skeleton}`} data-memory-skeleton aria-busy="true">
      <div className={css.skeletonHeader}><i /><i /></div>
      {Array.from({ length: 4 }, (_, index) => <div className={css.skeletonCard} key={index}><i /><i /><i /></div>)}
    </section>
  )
}

/** Harness-native settings page for binding, controls, source status, and candidate review. */
export function MemorySection(props: Partial<MemorySectionProps>): ReactNode {
  const { load, bindProject, updateSettings, reviewCandidate, deleteProject, exportProject, t } = props
  if (!load || !bindProject || !updateSettings || !reviewCandidate || !deleteProject || !exportProject || !t) return null
  return <Loaded {...{ load, bindProject, updateSettings, reviewCandidate, deleteProject, exportProject, t }} />
}

function Loaded(props: MemorySectionProps): ReactNode {
  const { t } = props
  const [view, setView] = useState<MemorySnapshot>()
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<MemoryLocaleKey>()
  const [selectedSources, setSelectedSources] = useState<Set<string>>(() => new Set())
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(() => new Set())
  const [existingProjectKey, setExistingProjectKey] = useState('')
  const [edits, setEdits] = useState<Record<string, { content: string; scope: Candidate['scope']; kind: Candidate['kind'] }>>({})
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const generation = useRef(0)

  const refresh = useCallback(async (): Promise<void> => {
    const current = generation.current + 1
    generation.current = current
    setFailed(false)
    const result = await props.load().catch(() => undefined)
    if (generation.current !== current) return
    if (result === undefined) setFailed(true)
    else setView(result)
  }, [props.load])

  useEffect(() => {
    void refresh()
    return () => { generation.current += 1 }
  }, [refresh])

  const mutate = (operation: () => Promise<MemorySnapshot>): void => {
    if (busy) return
    setBusy(true)
    setNotice(undefined)
    void operation().then((next) => {
      setView(next)
      setNotice('saved')
    }).catch(() => { setNotice('operationFailed') }).finally(() => { setBusy(false) })
  }

  if (view === undefined && !failed) return <Skeleton />
  if (view === undefined) return <div className={css.failure}><p role="alert">{t('loadFailed')}</p><button type="button" onClick={() => { void refresh() }}>{t('retry')}</button></div>
  const project = view.project
  const pendingCandidates = view.candidates.filter(candidate => candidate.status === 'pending')
  const visibleCandidates = view.candidates.filter(candidate => candidate.status !== 'forgotten')
  const databaseKey = databaseStatusKey(view.database.status)
  const candidateName = view.projectCandidate === null ? null : `${view.projectCandidate.basename}#${view.projectCandidate.shortHash}`

  const bind = (): void => {
    if (view.projectCandidate === null) return
    mutate(() => props.bindProject({
      candidateId: view.projectCandidate!.candidateId,
      sourceIds: [...selectedSources],
      ...(existingProjectKey === '' ? {} : { existingProjectKey }),
    }))
  }
  const setting = (patch: Omit<UpdateSettingsRequest, 'projectKey'>): void => {
    if (project === null) return
    mutate(() => props.updateSettings({ projectKey: project.projectKey, ...patch }))
  }
  const review = (request: CandidateReviewRequest): void => { mutate(() => props.reviewCandidate(request)) }
  const editFor = (candidate: Candidate) => edits[candidate.candidateId] ?? {
    content: candidate.content,
    scope: candidate.scope,
    kind: candidate.kind,
  }
  const updateEdit = (candidate: Candidate, patch: Partial<ReturnType<typeof editFor>>): void => {
    setEdits(current => ({ ...current, [candidate.candidateId]: { ...editFor(candidate), ...patch } }))
  }
  const merge = (): void => {
    const selected = pendingCandidates.filter(candidate => selectedCandidates.has(candidate.candidateId))
    const first = selected[0]
    if (first === undefined || selected.length < 2) return
    review({
      action: 'merge',
      candidateIds: selected.map(candidate => candidate.candidateId),
      content: selected.map(candidate => editFor(candidate).content).join('\n'),
      scope: editFor(first).scope,
      kind: editFor(first).kind,
    })
    setSelectedCandidates(new Set())
  }

  const download = (): void => {
    if (project === null || busy) return
    setBusy(true)
    void props.exportProject({ projectKey: project.projectKey }).then((result) => {
      const url = URL.createObjectURL(new Blob([result.content], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = result.fileName
      link.click()
      URL.revokeObjectURL(url)
    }).catch(() => { setNotice('operationFailed') }).finally(() => { setBusy(false) })
  }

  return (
    <section className={css.section} aria-busy={busy}>
      <header className={css.header}>
        <div><h2>{t('title')}</h2><p>{t('subtitle')}</p></div>
        <button type="button" className={css.secondary} onClick={() => { void refresh() }}>{t('refresh')}</button>
      </header>
      {notice === undefined ? null : <p className={css.notice} role="status">{t(notice)}</p>}

      <div className={css.statusGrid}>
        <article className={css.card}>
          <span className={css.eyebrow}>{t('managedMemory')}</span>
          <strong className={css.statusLine}><i data-status="ready" />{t('managedReady')}</strong>
          <small>{t('managedHint')}</small>
        </article>
        <article className={css.card}>
          <span className={css.eyebrow}>{t('database')}</span>
          <strong className={css.statusLine}><i data-status={view.database.status} />{t(databaseKey)}</strong>
          <small>{t('databaseHint')}</small>
        </article>
        <article className={css.card}>
          <span className={css.eyebrow}>{t('projectIdentity')}</span>
          <strong>{project === null ? candidateName ?? '—' : `${project.basename}#${project.shortHash}`}</strong>
          <small>{project === null ? t('currentCandidate') : `${t('approvedCount')}: ${view.approvedCount}`}</small>
        </article>
      </div>

      {project === null ? (
        <article className={css.panel}>
          <div className={css.panelTitle}><div><h3>{t('projectIdentity')}</h3><p>{t('bindHint')}</p></div></div>
          {view.projectCandidate === null ? <p className={css.empty}>{t('noCandidate')}</p> : (
            <>
              <strong>{candidateName}</strong>
              {view.projects.length === 0 ? null : (
                <label className={css.field}><span>{t('existingProject')}</span><select value={existingProjectKey} onChange={event => { setExistingProjectKey(event.currentTarget.value) }}>
                  <option value="">{t('newProject')}</option>
                  {view.projects.map(item => <option value={item.projectKey} key={item.projectKey}>{item.basename}#{item.shortHash}</option>)}
                </select></label>
              )}
              <fieldset className={css.sources}><legend>{t('sources')}</legend>
                {view.sources.length === 0 ? <p className={css.empty}>{t('sourceEmpty')}</p> : view.sources.map(source => (
                  <label key={source.sourceId}>
                    <input type="checkbox" aria-label={`source ${source.shortHash}`} checked={selectedSources.has(source.sourceId)} onChange={(event) => {
                      const checked = event.currentTarget.checked
                      setSelectedSources(current => {
                        const next = new Set(current)
                        if (checked) next.add(source.sourceId); else next.delete(source.sourceId)
                        return next
                      })
                    }} />
                    <span><strong>{t('source')} #{source.shortHash}</strong><small>{source.recordCount} {t('records')} · {source.lastAt ?? '—'}</small></span>
                  </label>
                ))}
              </fieldset>
              <button type="button" className={css.primary} disabled={busy} onClick={bind}>{t('bindAction')}</button>
            </>
          )}
        </article>
      ) : (
        <>
          <article className={css.panel}>
            <div className={css.panelTitle}><div><h3>{t('settings')}</h3></div></div>
            <div className={css.settingRows}>
              <Toggle label={t('captureToggle')} hint={t('captureHint')} checked={project.captureEnabled} disabled={busy} onChange={checked => { setting({ captureEnabled: checked }) }} />
              <Toggle label={t('recallToggle')} hint={t('recallHint')} checked={project.recallEnabled} disabled={busy} onChange={checked => { setting({ recallEnabled: checked }) }} />
            </div>
            <div className={css.budgetRow}>
              <label><span>{t('recallLimit')}</span><select value={project.recallLimit} disabled={busy} onChange={event => { setting({ recallLimit: Number(event.currentTarget.value) }) }}>{[1, 2, 3, 4, 5].map(value => <option key={value}>{value}</option>)}</select></label>
              <label><span>{t('recallBudget')}</span><select value={project.recallByteBudget} disabled={busy} onChange={event => { setting({ recallByteBudget: Number(event.currentTarget.value) }) }}>{[1000, 2000, 3000, 4000, 5000, 6000].map(value => <option key={value}>{value}</option>)}</select></label>
            </div>
          </article>

          <article className={css.panel}>
            <div className={css.panelTitle}><div><h3>{t('inbox')}</h3><p>{t('inboxCount')}: {pendingCandidates.length} · {t('approvedCount')}: {view.approvedCount}</p></div><button type="button" className={css.secondary} disabled={selectedCandidates.size < 2 || busy} onClick={merge}>{t('mergeAction')}</button></div>
            {visibleCandidates.length === 0 ? <p className={css.empty}>{t('inboxEmpty')}</p> : <div className={css.candidateList}>{visibleCandidates.map(candidate => {
              const edit = editFor(candidate)
              return <article className={css.candidate} key={candidate.candidateId}>
                <div className={css.candidateMeta}>
                  {candidate.status === 'pending' ? <label><input type="checkbox" aria-label={`${t('selectCandidate')} ${candidate.candidateId}`} checked={selectedCandidates.has(candidate.candidateId)} onChange={(event) => {
                    const checked = event.currentTarget.checked
                    setSelectedCandidates(current => {
                      const next = new Set(current)
                      if (checked) next.add(candidate.candidateId); else next.delete(candidate.candidateId)
                      return next
                    })
                  }} /></label> : null}
                  <span>{t(kindKey(candidate.kind))}</span><time>{candidate.createdAt}</time>
                </div>
                <textarea disabled={candidate.status !== 'pending'} value={edit.content} onChange={event => { updateEdit(candidate, { content: event.currentTarget.value }) }} />
                <div className={css.candidateControls}>
                  {candidate.status === 'pending' ? <><select value={edit.scope} onChange={event => { updateEdit(candidate, { scope: event.currentTarget.value as Candidate['scope'] }) }}><option value="project">{t('scopeProject')}</option><option value="personal">{t('scopePersonal')}</option></select>
                  <select value={edit.kind} onChange={event => { updateEdit(candidate, { kind: event.currentTarget.value as Candidate['kind'] }) }}>{kindOptions.map(kind => <option value={kind} key={kind}>{t(kindKey(kind))}</option>)}</select>
                  <button type="button" disabled={busy} onClick={() => { review({ action: 'edit', candidateId: candidate.candidateId, ...edit }) }}>{t('editAction')}</button>
                  <button type="button" className={css.primary} disabled={busy} onClick={() => { review({ action: 'approve', candidateId: candidate.candidateId }) }}>{t('approveAction')}</button></> : <span>{t('statusApproved')}</span>}
                  <button type="button" disabled={busy} onClick={() => { review({ action: 'pin', candidateId: candidate.candidateId, pinned: !candidate.pinned }) }}>{t(candidate.pinned ? 'unpinAction' : 'pinAction')}</button>
                  <button type="button" className={css.dangerText} disabled={busy} onClick={() => { review({ action: 'forget', candidateId: candidate.candidateId }) }}>{t('forgetAction')}</button>
                </div>
              </article>
            })}</div>}
          </article>

          <article className={css.panel}>
            <div className={css.panelTitle}><div><h3>{t('deleteTitle')}</h3><p>{t('deleteHint')}</p></div><button type="button" className={css.secondary} disabled={busy} onClick={download}>{t('exportAction')}</button></div>
            <div className={css.deleteRow}><input type="text" value={deleteConfirmation} placeholder={t('deleteInput')} onChange={event => { setDeleteConfirmation(event.currentTarget.value) }} /><button type="button" className={css.danger} disabled={busy || deleteConfirmation !== 'DELETE_PROJECT'} onClick={() => { mutate(() => props.deleteProject({ projectKey: project.projectKey, confirmation: 'DELETE_PROJECT' })); setDeleteConfirmation('') }}>{t('deleteAction')}</button></div>
          </article>
        </>
      )}
    </section>
  )
}

function Toggle({ label, hint, checked, disabled, onChange }: { label: string; hint: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }): ReactNode {
  return <label className={css.toggle}><span><strong>{label}</strong><small>{hint}</small></span><input type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={event => { onChange(event.currentTarget.checked) }} /></label>
}

const kindOptions: Candidate['kind'][] = ['architecture', 'decision', 'progress', 'failure', 'next', 'project-preference', 'personal-preference']
function kindKey(kind: Candidate['kind']): MemoryLocaleKey {
  return ({ architecture: 'kindArchitecture', decision: 'kindDecision', progress: 'kindProgress', failure: 'kindFailure', next: 'kindNext', 'project-preference': 'kindProjectPreference', 'personal-preference': 'kindPersonalPreference' })[kind] as MemoryLocaleKey
}
function databaseStatusKey(status: MemorySnapshot['database']['status']): MemoryLocaleKey {
  return ({ ready: 'databaseReady', 'not-configured': 'databaseNotConfigured', 'unsafe-path': 'databaseUnsafe', corrupt: 'databaseCorrupt', incompatible: 'databaseIncompatible', unavailable: 'databaseUnavailable' })[status] as MemoryLocaleKey
}
