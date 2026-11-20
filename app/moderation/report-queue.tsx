'use client';

import { useCallback, useEffect, useState } from 'react';

function PhotoEvidence({ report, pending }: { report: string; pending: boolean }) {
  const [unavailable, setUnavailable] = useState(false);
  return <div className="admin-photo-evidence">
    <h3>Reported photo</h3>
    {pending && !unavailable
      ? <img src={`/api/moderation/photo?report=${encodeURIComponent(report)}`} alt="Photo shown when this guest was reported"
        onError={() => setUnavailable(true)} />
      : <p>Photo evidence unavailable</p>}
  </div>;
}

const filters = { pending: 'Pending', reviewed: 'Reviewed', dismissed: 'Dismissed' } as const;
type Status = keyof typeof filters;
type Report = {
  id: string;
  reason: string;
  createdAt: string;
  reviewedAt: string | null;
  hasConversation: boolean;
  nickname: string;
  suspended: boolean;
  sessionEnded: boolean;
};
type Queue = {
  reports: Report[];
  evidence: { id: string; reportedGuest: boolean; body: string }[];
  counts: Record<Status, number>;
  page: number;
  pages: number;
};
type Review = { id: string; status: Status; suspend: boolean };

const localTime = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila',
});

export function ReportQueue() {
  const [status, setStatus] = useState<Status>('pending');
  const [queue, setQueue] = useState<Queue>();
  const [selected, setSelected] = useState('');
  const [confirmSuspension, setConfirmSuspension] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(true);
  const page = queue?.page ?? 1;

  const load = useCallback(async (filter: Status, pageNumber = 1, report = '', change?: Review) => {
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      const params = new URLSearchParams({ status: filter, page: String(pageNumber) });
      if (report) params.set('case', report);
      const response = await fetch('/api/moderation?' + params, {
        method: change ? 'POST' : 'GET',
        headers: change ? { 'Content-Type': 'application/json' } : undefined,
        body: change ? JSON.stringify(change) : undefined,
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 401) {
        window.location.replace('/admin');
        return;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Couldn’t load reports.');
      const result = data as Queue;
      setStatus(filter);
      setQueue(result);
      setSelected(result.reports.some(item => item.id === report) ? report : '');
      setConfirmSuspension(false);
      if (change?.suspend) setFeedback('Guest suspended. The report is still pending.');
      else if (change) setFeedback({
        pending: 'Report reopened and moved to Pending.',
        reviewed: 'Report marked as reviewed and moved to Reviewed.',
        dismissed: 'Report moved to Dismissed.',
      }[change.status]);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load('pending'); }, [load]);

  function resolve(id: string, next: Status) {
    void load(status, page, '', { id, status: next, suspend: false });
  }

  return <>
    <header className="admin-heading"><h1>Reports</h1><p>Review guest reports and manage access from the same screen.</p></header>
    <details className="admin-card admin-report-help">
      <summary>How to review a report</summary>
      <ol>
        <li>Start in Pending. Underage reports appear first.</li>
        <li>Open a report and read the available conversation before deciding.</li>
        <li>Suspend the guest if access needs to stop while you review. The report stays pending.</li>
        <li>Mark reviewed when you finish, or dismiss the report if it needs no further action. Reopen it if new information comes in.</li>
      </ol>
    </details>
    {error && <p className="error" role="alert">{error}</p>}
    {feedback && <p className="notice" role="status">{feedback}</p>}
    <section className="admin-card admin-report-list" aria-label="Report queue">
      <div className="admin-report-toolbar">
        <div className="pills" role="group" aria-label="Report status">
          {(Object.keys(filters) as Status[]).map(filter => <button key={filter} aria-pressed={filter === status}
            disabled={busy} onClick={() => void load(filter)}>{filters[filter]}{queue && ` (${queue.counts[filter]})`}</button>)}
        </div>
        <button className="secondary" disabled={busy} onClick={() => void load(status, page)}>Refresh reports</button>
      </div>
      {!queue && busy && <p role="status">Loading reports…</p>}
      {queue?.reports.length === 0 && <p role="status">No {status} reports.</p>}
      <div aria-busy={busy}>
        {queue?.reports.map(report => {
          const open = selected === report.id;
          return <article className="admin-report-case" key={report.id}>
            <header className="admin-report-row">
              <div>
                <h2>{report.reason} <span>· Report #{report.id}</span></h2>
                <p>Reported guest <strong>{report.nickname}</strong></p>
                <p><time dateTime={report.createdAt}>{localTime.format(new Date(report.createdAt))}</time> · Bacolod time</p>
              </div>
              <div className="admin-row-actions">
                {status === 'pending' && report.reason === 'Underage user' && <span className="admin-report-priority">Priority</span>}
                {(report.sessionEnded || report.suspended) && <span className="admin-state">{report.sessionEnded ? 'Session ended' : 'Suspended'}</span>}
                <button className="secondary" disabled={busy} aria-expanded={open} aria-controls={`report-${report.id}`}
                  aria-label={`${open ? 'Close' : 'Open'} report #${report.id}`}
                  onClick={() => {
                    if (open) { setSelected(''); setConfirmSuspension(false); }
                    else void load(status, page, report.id);
                  }}>{open ? 'Close details' : 'Open report'}</button>
              </div>
            </header>
            <div className="admin-report-detail" id={`report-${report.id}`} hidden={!open}>
              {open && <>
                <h3>Conversation evidence</h3>
                {queue.evidence.length > 0 ? <>
                  <p>Up to the last 20 messages available when the report was sent.</p>
                  <ul className="admin-evidence">
                    {queue.evidence.map(message => <li key={message.id}>
                      <strong>{message.reportedGuest ? 'Reported guest' : 'Guest who reported'}</strong>
                      <p>{message.body}</p>
                    </li>)}
                  </ul>
                </> : <p>{report.hasConversation ? 'No messages are available for this report.' : 'This report was sent from a profile, so it has no conversation attached.'}</p>}
                {report.reason === 'Fake or stolen photo' && <PhotoEvidence key={report.id} report={report.id} pending={status === 'pending'} />}
                <h3>Review outcome</h3>
                {report.reviewedAt && <p>{filters[status]} on <time dateTime={report.reviewedAt}>{localTime.format(new Date(report.reviewedAt))}</time> · Bacolod time</p>}
                <p>{status === 'pending'
                  ? 'Mark reviewed when you finish checking the case. Dismiss it if it needs no further action.'
                  : 'Reopen this report to put it back in Pending. Guest access can be managed in Guests.'}</p>
                <div className="admin-row-actions">
                  {status === 'pending' ? <>
                    <button className="primary" disabled={busy} onClick={() => resolve(report.id, 'reviewed')}>Mark reviewed</button>
                    <button className="secondary" disabled={busy} onClick={() => resolve(report.id, 'dismissed')}>Dismiss report</button>
                    {!report.suspended && !report.sessionEnded && !confirmSuspension && <button className="secondary" disabled={busy}
                      onClick={() => setConfirmSuspension(true)}>Suspend guest</button>}
                  </> : <button className="secondary" disabled={busy} onClick={() => resolve(report.id, 'pending')}>Reopen report</button>}
                </div>
                {confirmSuspension && <div className="admin-report-confirm">
                  <p>Suspending this guest ends their active Quick Chats and pauses their saved matches. The report stays in Pending.</p>
                  <div className="admin-row-actions">
                    <button className="primary" disabled={busy} onClick={() => void load(status, page, report.id, { id: report.id, status, suspend: true })}>Confirm suspension</button>
                    <button className="secondary" disabled={busy} onClick={() => setConfirmSuspension(false)}>Cancel</button>
                  </div>
                </div>}
              </>}
            </div>
          </article>;
        })}
      </div>
      {queue && queue.pages > 1 && <div className="admin-report-page">
        <button className="secondary" disabled={busy || page === 1} onClick={() => void load(status, page - 1)}>Previous</button>
        <span>Page {page} of {queue.pages}</span>
        <button className="secondary" disabled={busy || page === queue.pages} onClick={() => void load(status, page + 1)}>Next</button>
      </div>}
    </section>
  </>;
}
