import { useRef, type FormEvent } from 'react';
import { Flag, Heart, MapPin, Shuffle } from 'lucide-react';
import { genders, barInterests, barPrompt, barReportReasons } from './options';
import { PhotoAvatar, PhotoEditor, type PhotoSettings } from './profile-photo';

export type BarProfile = {
  age: number | null; gender: string | null; interest: string | null;
  minAge: number | null; maxAge: number | null; favorite: string | null; answer: string | null;
  photoId?: string | null; quickPhoto?: boolean;
};
export type BarCandidate = { id: string; nickname: string; favorite: string; answer: string; photoId?: string | null };

export function BarSetup({ profile, busy, save, photosReady, updatePhoto }: {
  profile: BarProfile & { nickname: string }; busy: boolean; save: (fields: Record<string, unknown>) => void;
  photosReady: boolean; updatePhoto: (photo: PhotoSettings) => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    save({
      age: Number(values.get('age')), gender: values.get('gender'), interest: values.get('interest'),
      minAge: Number(values.get('minAge')), maxAge: Number(values.get('maxAge')),
      favorite: values.get('favorite'), answer: values.get('answer'),
    });
  }

  return <form onSubmit={submit}>
    <div className="card-head"><h2>Across the Bar</h2><p>Your card shows your nickname, hangout, answer, and optional photo.</p></div>
    <fieldset className="fields">
      <legend>Your card</legend>
      {photosReady && <PhotoEditor nickname={profile.nickname} settings={{ photoId: profile.photoId ?? null, quickPhoto: Boolean(profile.quickPhoto) }} update={updatePhoto} />}
      <div className="field-pair">
        <label>Your age<input name="age" type="number" min={18} max={120} required defaultValue={profile.age ?? ''} /></label>
        <label>Your gender<select name="gender" required defaultValue={profile.gender ?? ''}>
          <option value="" disabled>Choose one</option>
          {genders.map(gender => <option key={gender}>{gender}</option>)}
        </select></label>
      </div>
      <label>Favorite hangout<input name="favorite" required maxLength={60} defaultValue={profile.favorite ?? ''} /></label>
      <label>{barPrompt}<input name="answer" required maxLength={140} defaultValue={profile.answer ?? ''} /></label>
    </fieldset>
    <fieldset className="fields">
      <legend>Who you’re here to meet</legend>
      <label>Interested in<select name="interest" defaultValue={profile.interest ?? 'Everyone'}>
        {barInterests.map(interest => <option key={interest}>{interest}</option>)}
      </select></label>
      <div className="field-pair">
        <label>Minimum age<input name="minAge" type="number" min={18} max={120} required defaultValue={profile.minAge ?? 18} /></label>
        <label>Maximum age<input name="maxAge" type="number" min={18} max={120} required defaultValue={profile.maxAge ?? 120} /></label>
      </div>
    </fieldset>
    <button className="primary" disabled={busy}>Save and browse</button>
  </form>;
}

export function BarCard({ candidate, animate, busy, report, setReport, act }: {
  candidate: BarCandidate; animate: boolean; busy: boolean; report: boolean; setReport: (open: boolean) => void;
  act: (action: string, fields?: Record<string, unknown>) => Promise<boolean>;
}) {
  const target = candidate.id;
  const shownPhoto = useRef<{ target: string; photoId: string }>(undefined);
  return <>
    <div className={`bar-card-profile${animate ? ' motion-rise' : ''}`} key={target}>
    <div className="chat-head">
      <PhotoAvatar nickname={candidate.nickname} scope="bar" target={target} photoId={candidate.photoId} large
        onPhotoShown={photoId => { shownPhoto.current = { target, photoId }; }} />
      <div className="peer"><h3>{candidate.nickname}</h3><p className="candidate-spot"><MapPin size={14} /> {candidate.favorite}</p></div>
      <button className="icon-button" aria-label="Report or block profile" aria-expanded={report} onClick={() => setReport(!report)}><Flag size={18} /></button>
    </div>
    <div className="bar-answer"><p>{barPrompt}</p><blockquote>{candidate.answer}</blockquote></div>
    </div>
    {report && <div className="report"><strong>Report or block this profile</strong><div className="pills">
      {barReportReasons.map(reason => <button key={reason} disabled={busy} onClick={() => void act('bar-report', {
        target, reason, photoId: reason === 'Fake or stolen photo' && shownPhoto.current?.target === target ? shownPhoto.current.photoId : undefined,
      })}>{reason}</button>)}
      <button disabled={busy} onClick={() => void act('bar-block', { target })}>Block</button>
    </div></div>}
    <div className="actions">
      <button className="secondary" disabled={busy} onClick={() => void act('bar-next', { target })}><Shuffle size={17} /> Next</button>
      <button className="primary" disabled={busy} onClick={() => void act('bar-hi', { target })}><Heart size={17} /> Say Hi</button>
    </div>
  </>;
}
