'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

type SessionAction = 'end-session' | 'delete-data';

const actions = [
  {
    id: 'end-session', label: 'End guest session', confirm: 'End session now',
    explanation: 'This closes your chats and permanently removes access to saved matches from this guest session. Use Delete my data first if you also want to remove your profile and messages.',
    success: 'Guest session ended.',
  },
  {
    id: 'delete-data', label: 'Delete my data', confirm: 'Confirm deletion',
    explanation: 'This ends your session, closes your chats, and removes your profile details, photo, messages you sent, meetup invites, and Say Hi records. Reports, messages needed for a pending report, and limited safety records may be kept for moderation.',
    success: 'Your data deletion request was processed.',
  },
] as const;

export function GuestPrivacy({ canManage, busy, submit }: {
  canManage: boolean;
  busy: boolean;
  submit: (action: SessionAction, onError: (message: string) => void) => Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState<SessionAction>();
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const cancelButton = useRef<HTMLButtonElement>(null);
  const summary = useRef<HTMLElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (confirming) cancelButton.current?.focus(); }, [confirming]);

  function cancel() {
    setConfirming(undefined);
    setError('');
    opener.current?.focus();
  }

  return <details className="faq-row guest-privacy">
    <summary ref={summary}>Privacy &amp; guest session<ChevronDown className="faq-toggle" size={17} aria-hidden="true" /></summary>
    <div className="guest-privacy-content">
      <section aria-labelledby="privacy-visible">
        <h3 id="privacy-visible">What people see</h3>
        <p>Your nickname is visible to people you chat with. Quick Chat shares your optional gender, round, and spot with your chat partner. Matching picks can become an icebreaker.</p>
        <p>Your Across the Bar card shows your nickname, favorite hangout, prompt answer, and optional photo to eligible guests. Age and preferences are used privately to find eligible cards. Your photo appears in Quick Chat only if you turn on sharing.</p>
      </section>
      <details className="faq-row privacy-retention">
        <summary>How long is my data kept?<ChevronDown className="faq-toggle" size={17} aria-hidden="true" /></summary>
        <div className="privacy-retention-copy">
          <p>The policy calls for removing closed-chat messages and meetup invites after 30 days. Messages needed for a pending report and reports themselves may be kept for up to 90 days. Basic closed-chat records may be kept for safety.</p>
          <p>Open saved matches can be accessed while your guest session is still valid in this browser. The operator needs to schedule the daily cleanup job for these time limits to take effect.</p>
        </div>
      </details>
      <section aria-labelledby="privacy-manage">
        <h3 id="privacy-manage">Manage your session</h3>
        <p>Browser suspensions stay in effect after ending a guest session or deleting its data.</p>
        {status && <p className="notice" role="status">{status}</p>}
        {canManage ? <div className="privacy-action-list">
          {actions.map(action => <div key={action.id} className={action.id === 'delete-data' ? 'privacy-destructive' : undefined}>
            <button type="button" className="secondary privacy-action" disabled={busy}
              aria-expanded={confirming === action.id} aria-controls={`privacy-${action.id}`}
              onClick={event => {
                opener.current = event.currentTarget;
                setError('');
                setStatus('');
                setConfirming(action.id);
              }}>{action.label}</button>
            <div id={`privacy-${action.id}`} hidden={confirming !== action.id} className="privacy-confirm" role="group"
              aria-label={`Confirm ${action.label.toLowerCase()}`} onKeyDown={event => {
                if (event.key === 'Escape' && !busy) { event.preventDefault(); cancel(); }
              }}>
              <p id={`privacy-explain-${action.id}`}>{action.explanation}</p>
              {confirming === action.id && error && <p className="error" role="alert">{error}</p>}
              <div className="privacy-confirm-buttons">
                <button ref={confirming === action.id ? cancelButton : null} type="button" className="secondary" disabled={busy} onClick={cancel}>Cancel</button>
                <button type="button" className="secondary privacy-commit" disabled={busy} aria-describedby={`privacy-explain-${action.id}`}
                  onClick={async () => {
                    setError('');
                    if (await submit(action.id, setError)) {
                      setConfirming(undefined);
                      setStatus(action.success);
                      summary.current?.focus();
                    }
                  }}>{busy ? 'Working…' : action.confirm}</button>
              </div>
            </div>
          </div>)}
        </div> : !status && <p>Session actions are available to signed-in guests.</p>}
      </section>
    </div>
  </details>;
}
