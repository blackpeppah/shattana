import { useState, type FormEvent } from 'react';
import { bacolodDate, formatMeetupDate } from './bacolod-time';

export type MeetupInvite = {
  version: string;
  venue: string;
  date: string;
  status: 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'expired' | 'canceled' | 'ended';
  time?: string | null;
  mine: boolean;
};

export type MeetupDraft = { kind: 'propose'; version: string | null } |
  { kind: 'counter'; version: string; venue: string; date: string; time?: string | null };

export function MeetupEditor({ draft, venues, extended, busy, cancel, submit }: {
  draft: MeetupDraft;
  venues: string[];
  busy: boolean;
  cancel: () => void;
  extended: boolean;
  submit: (fields: { venue: string; date: string; time?: string }) => void;
}) {
  const counter = draft.kind === 'counter';
  const today = bacolodDate();
  const choices = venues.filter(venue => draft.kind !== 'counter' || venue !== draft.venue);
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    submit({ venue: String(fields.get('venue')), date: String(fields.get('date')),
      ...(extended ? { time: String(fields.get('time') ?? '') } : {}) });
  }

  return <form className="meetup-editor fields" onSubmit={handleSubmit} aria-label={counter ? 'Suggest another spot' : 'Propose a meetup'}>
    <strong>{counter ? 'Suggest another spot' : 'G ta?'}</strong>
    <div className="field-pair meetup-fields">
      <label>Venue<select name="venue" defaultValue="" required>
        <option value="" disabled>Choose a venue</option>
        {choices.map(venue => <option key={venue}>{venue}</option>)}
      </select></label>
      <label>Date <span>(Bacolod time)</span><input name="date" type="date" min={today}
        required={!counter || draft.date < today} defaultValue={counter && draft.date >= today ? draft.date : ''} /></label>
    </div>
    {extended && <label>Time <span>(optional, Bacolod time)</span>
      <input name="time" type="time" defaultValue={counter ? draft.time ?? '' : ''} />
    </label>}
    <p className="meetup-safety">Meet in a public place and tell someone you trust about your plans.</p>
    <div className="meetup-buttons">
      <button className="secondary" type="button" disabled={busy} onClick={cancel}>Cancel</button>
      <button className="primary" disabled={busy || choices.length === 0}>{counter ? 'Send counteroffer' : 'Send invite'}</button>
    </div>
  </form>;
}

export function MeetupCard({ invite, nickname, busy, counter, respond, withdraw, cancelPlan }: {
  invite: MeetupInvite;
  nickname: string;
  busy: boolean;
  counter: () => void;
  respond: (response: 'accept' | 'decline') => void;
  withdraw?: () => void;
  cancelPlan?: () => Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState(false);
  return <aside className="meetup-card" aria-label="Meetup invite">
    <strong>G ta?</strong>
    <p>{invite.mine ? 'You suggested' : `${nickname} suggested`} {invite.venue}.</p>
    <p><time dateTime={invite.date}>{formatMeetupDate(invite.date)}</time>{invite.time && ` · ${invite.time}`} · Bacolod time</p>
    {invite.status === 'accepted' && <p className="meetup-status">Accepted</p>}
    {invite.status === 'declined' && <p className="meetup-status">Maybe later</p>}
    {invite.status === 'withdrawn' && <p className="meetup-status">Invite withdrawn</p>}
    {invite.status === 'expired' && <p className="meetup-status">Invite expired</p>}
    {invite.status === 'canceled' && <p className="meetup-status" role="status">Plan canceled</p>}
    {invite.status === 'ended' && <p className="meetup-status">Ended</p>}
    {invite.status === 'accepted' && cancelPlan && (confirming ? <div>
      <p>Cancel this plan for both of you?</p>
      <div className="meetup-buttons">
        <button className="secondary" disabled={busy} onClick={() => setConfirming(false)}>Keep plan</button>
        <button className="primary" disabled={busy} onClick={async () => { if (await cancelPlan()) setConfirming(false); }}>Confirm cancellation</button>
      </div>
    </div> : <div className="meetup-buttons"><button className="secondary" disabled={busy} onClick={() => setConfirming(true)}>Cancel plan</button></div>)}
    {invite.status === 'pending' && invite.mine && <>
      <p className="meetup-status">Waiting for a reply</p>
      {withdraw && <div className="meetup-buttons"><button className="secondary" disabled={busy} onClick={withdraw}>Withdraw invite</button></div>}
    </>}
    {invite.status === 'pending' && !invite.mine && <div className="meetup-buttons">
      <button className="primary" disabled={busy || invite.date < bacolodDate()} onClick={() => respond('accept')}>G!</button>
      <button className="secondary" disabled={busy} onClick={counter}>Suggest another spot</button>
      <button className="secondary" disabled={busy} onClick={() => respond('decline')}>Maybe later</button>
    </div>}
    {(invite.status === 'accepted' || (invite.status === 'pending' && !invite.mine)) &&
      <p className="meetup-safety">Meet in a public place and tell someone you trust about your plans.</p>}
  </aside>;
}
