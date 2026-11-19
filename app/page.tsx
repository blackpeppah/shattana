'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, ArrowUp, Flag, Heart, MessageCircle, Shuffle, MapPin, ShieldCheck, Sparkles, X } from 'lucide-react';
import { drinks, icebreakers, spots, reasons } from './options';
import { BarCard, BarSetup, type BarCandidate, type BarProfile } from './across-bar';
import { afterHours } from './after-hours';

type Chat = { id: string; nickname: string; school: string; drink: string; spot: string; matched: boolean; shot: boolean; barPending: boolean };
type State = {
  profile: (BarProfile & { nickname: string; school: string; drink: string; spot: string; waiting: boolean }) | null;
  active?: Chat;
  selected?: Chat;
  matches?: Chat[];
  candidate?: BarCandidate;
  newBarChat?: string;
  messages?: { id: string; mine: boolean; body: string }[];
};

export default function Home() {
  const [data, setData] = useState<State>();
  const [view, setView] = useState<'home' | 'matches'>('home');
  const [mode, setMode] = useState<'quick' | 'bar'>('quick');
  const [barCursor, setBarCursor] = useState('');
  const [editingBar, setEditingBar] = useState(false);
  const [barReport, setBarReport] = useState(false);
  const [meetup, setMeetup] = useState<ReturnType<typeof afterHours>>();
  const [chatId, setChatId] = useState('');
  const [nickname, setNickname] = useState('');
  const [school, setSchool] = useState('');
  const [adult, setAdult] = useState(false);
  const [drink, setDrink] = useState('');
  const [spot, setSpot] = useState('');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [report, setReport] = useState(false);
  const [busy, setBusy] = useState(false);
  const [promptIndex, setPromptIndex] = useState(0);
  const [notice, setNotice] = useState('');
  const composer = useRef<HTMLInputElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const followThread = useRef(true);
  const revision = useRef(0);
  const requestInProgress = useRef(false);
  const hydrated = useRef(false);
  const chat = chatId ? (data?.selected?.id === chatId ? data.selected : undefined)
    : view === 'home' ? (data?.selected?.barPending ? data.selected : data?.active) : undefined;
  const matches = data?.matches ?? [];
  const waiting = Boolean(data?.profile?.waiting);
  const joined = Boolean(data?.profile);
  const lastMessage = data?.messages?.at(-1)?.id;

  async function request(action?: string, fields: Record<string, unknown> = {}, selected = chatId) {
    const params = new URLSearchParams();
    if (selected) params.set('chat', selected);
    if (view === 'home' && mode === 'bar') {
      params.set('bar', '1');
      if (barCursor && action !== 'bar-reset' && action !== 'bar-profile') params.set('after', barCursor);
    }
    const response = await fetch('/api/chat?' + params, action ? {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: selected, action, ...fields }),
    } : { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Please try again.');
    return payload as State;
  }

  useEffect(() => {
    let live = true;
    let inFlight = false;
    let lastHeartbeat = Date.now();
    async function refresh() {
      if (inFlight || requestInProgress.current || document.hidden) return;
      inFlight = true;
      const version = revision.current;
      try {
        const heartbeat = (waiting || data?.active) && Date.now() - lastHeartbeat > 12000;
        if (heartbeat) lastHeartbeat = Date.now();
        const payload = await request(heartbeat ? 'heartbeat' : undefined, {}, chatId || data?.active?.id);
        if (!live || version !== revision.current) return;
        setData(payload);
        if (!data) setError('');
        if (view === 'home' && data?.active && !payload.active && !payload.selected) {
          setNotice('That conversation ended. Start a new one whenever you’re ready.');
        }
        if (payload.profile && !hydrated.current) {
          hydrated.current = true;
          setDrink(payload.profile.drink);
          setSpot(payload.profile.spot);
        }
        if (chatId && payload.selected?.id !== chatId) setChatId('');
        if (!chatId && payload.selected?.matched && payload.selected.id === data?.active?.id && view === 'home') {
          setChatId(payload.selected.id);
        }
      } catch (failure) {
        if (live && version === revision.current && !data) setError((failure as Error).message);
      } finally {
        inFlight = false;
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, waiting || chatId || data?.active || data?.selected?.barPending || mode === 'bar' ? 1800 : 9000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
    // A new polling cycle is needed when the conversation or queue changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, waiting, data?.active?.id, data?.selected?.barPending, joined, view, mode, barCursor]);

  useEffect(() => {
    const update = () => setMeetup(afterHours(new Date()));
    update();
    const timer = window.setInterval(update, 30000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { setBarReport(false); }, [data?.candidate?.id, mode]);
  useEffect(() => { setReport(false); setDraft(''); setPromptIndex(0); followThread.current = true; }, [chat?.id]);
  useEffect(() => {
    if (thread.current && followThread.current) thread.current.scrollTop = thread.current.scrollHeight;
  }, [lastMessage, chat?.id]);

  async function act(action: string, fields: Record<string, unknown> = {}) {
    if (requestInProgress.current) return false;
    requestInProgress.current = true;
    revision.current++;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const payload = await request(action, fields, chat?.id ?? chatId);
      setData(payload);
      if (action === 'report') setNotice('Report submitted. This guest has been blocked.');
      if (action === 'block') setNotice('This guest has been blocked.');
      if (action === 'bar-block') setNotice('This guest has been blocked.');
      if (action === 'bar-report') setNotice('Report submitted. This guest has been blocked.');
      if (action === 'bar-hi' && !payload.newBarChat) setNotice('Hi sent. It stays private unless they say hi too.');
      if (action === 'bar-next' && typeof fields.target === 'string') setBarCursor(fields.target);
      if (action === 'bar-profile' || action === 'bar-reset') setBarCursor('');
      if (action === 'bar-profile') setEditingBar(false);
      if (payload.newBarChat) setChatId(payload.newBarChat);
      if (action === 'leave') setNotice('You left the conversation.');
      if (['find', 'next', 'leave', 'block', 'report'].includes(action)) setChatId('');
      if (action === 'shot' && payload.selected?.matched) setChatId(payload.selected.id);
      return true;
    } catch (failure) {
      setError((failure as Error).message);
      return false;
    } finally {
      requestInProgress.current = false;
      setBusy(false);
    }
  }

  function navigate(next: 'home' | 'matches') {
    setView(next);
    setChatId('');
    setError('');
    setNotice('');
  }

  async function chooseMode(next: 'quick' | 'bar') {
    if (next === mode || (next === 'bar' && waiting && !await act('cancel'))) return;
    setMode(next);
    setBarCursor('');
    setEditingBar(false);
    setNotice('');
    setError('');
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    followThread.current = true;
    if (await act('send', { body: draft })) setDraft('');
  }

  const opener = spot && spot === chat?.spot
    ? `${spot} man gali. Sin-o mauna mag-hi?`
    : chat?.spot ? `Favorite spot ni ${chat.nickname} ang ${chat.spot}. Paano mo siya i-hi?`
    : drink && drink === chat?.drink ? `${drink} kamo pareho. Sin-o mauna mag-hi?` : 'Hi lang anay. Sin-o mauna?';

  return (
    <div className="shell">
      <header className="masthead">
        <button className="brand" onClick={() => navigate('home')}>shattana<span>!</span></button>
        {joined && <nav aria-label="Main navigation">
          <button aria-current={view === 'home' ? 'page' : undefined} onClick={() => navigate('home')}><Shuffle size={16} /> Discover</button>
          <button aria-current={view === 'matches' ? 'page' : undefined} onClick={() => navigate('matches')}><Heart size={16} /> Matches {matches.length > 0 && <span className="count">{matches.length}</span>}</button>
        </nav>}
        <span className="age">18+</span>
      </header>

      <main className={view === 'home' && !chat ? 'discover' : 'workspace'}>
        {view === 'home' && !chat && <section className="hero">
          <div className="locale"><MapPin size={15} /> Bacolod City</div>
          <h1>Hi lang anay.<br /><em>Basi ikaw na.</em></h1>
          <p>May nakita ka sa pihak nga table? <strong>Shot mo na.</strong></p>
          <div className="hero-preview" aria-hidden="true">
            <span className="preview-bubble">Hi! Ari ka man sa BCD? <span>✦</span></span>
            <span className="preview-bubble preview-reply">Oo! Diin ta? <span>♡</span></span>
          </div>
        </section>}

        <div className="panel">
          {error && <p className="error" role="alert">{error}</p>}
          {notice && !chat && <p className="notice" role="status">{notice}</p>}
          {!data && !error && <p role="status" className="card muted">Loading Shattana…</p>}

          {data && !joined && <form className="card entry" onSubmit={event => { event.preventDefault(); void act('join', { nickname, school, adult }); }}>
            <div className="card-head"><span className="tile-icon"><MessageCircle size={22} /></span><h2>Join as a guest</h2><p>Pick a nickname to get started.</p></div>
            <div className="fields">
              <label>Nickname<input required maxLength={24} value={nickname} onChange={event => setNickname(event.target.value)} placeholder="e.g. Kai" /></label>
              <label>School <span>(optional, visible in chat)</span><input maxLength={60} value={school} onChange={event => setSchool(event.target.value)} placeholder="Your school" /></label>
            </div>
            <label className="check"><input type="checkbox" checked={adult} onChange={event => setAdult(event.target.checked)} required /> I’m 18 or older</label>
            <button className="primary" disabled={busy}>Continue <ArrowRight size={18} /></button>
            <p className="privacy-note"><ShieldCheck size={16} /> Share only what you’re comfortable sharing.</p>
          </form>}

          {joined && view === 'home' && !chat && <div className="mode-choices" aria-label="How to meet">
            <button className="secondary" aria-pressed={mode === 'quick'} disabled={busy} onClick={() => void chooseMode('quick')}><Shuffle size={17} /> Quick Chat</button>
            <button className="secondary" aria-pressed={mode === 'bar'} disabled={busy} onClick={() => void chooseMode('bar')}><Heart size={17} /> Across the Bar</button>
          </div>}

          {data?.profile && view === 'home' && !chat && mode === 'bar' && <section className="card discovery-card">
            {editingBar || !data.profile.answer
              ? <BarSetup profile={data.profile} busy={busy} save={fields => void act('bar-profile', fields)} />
              : <>
                <div className="card-head"><h2>Across the Bar</h2><p>A private hello. A chat opens when you both say hi.</p></div>
                {data.candidate
                  ? <BarCard candidate={data.candidate} busy={busy} report={barReport} setReport={setBarReport} act={act} />
                  : <p role="status">No more profiles fit both sets of preferences right now.</p>}
                <div className="bar-controls">
                  <button className="secondary" disabled={busy} onClick={() => setEditingBar(true)}>Edit card and preferences</button>
                  {!data.candidate && barCursor && <button className="secondary" disabled={busy} onClick={() => void act('bar-reset')}>Start over</button>}
                </div>
              </>}
          </section>}

          {joined && view === 'home' && !chat && mode === 'quick' && (waiting
            ? <section className="card waiting"><div className="tile-icon"><Shuffle size={23} /></div><h2 role="status">Finding someone…</h2><p>Keep this tab open. We’ll open the chat when someone joins.</p><button className="secondary" onClick={() => void act('cancel')} disabled={busy}>Cancel search</button></section>
            : <section className="card discovery-card">
              <div className="card-head"><h2>Quick Chat</h2><p>Get paired at random. Choose an icebreaker or jump right in.</p></div>
              <fieldset><legend>What’s your round? <span>Optional</span></legend><div className="pills">{drinks.map(option => <button type="button" key={option} aria-pressed={drink === option} onClick={() => setDrink(drink === option ? '' : option)}>{option}</button>)}</div></fieldset>
              <fieldset><legend>Where’s your spot? <span>Optional</span></legend><div className="pills spot-options">{spots.map(option => <button type="button" key={option} aria-pressed={spot === option} onClick={() => setSpot(spot === option ? '' : option)}>{option}</button>)}</div></fieldset>
              <button className="primary" disabled={busy} onClick={() => void act('find', { drink, spot })}>{busy ? 'Starting…' : 'Start Quick Chat'} <ArrowRight size={19} /></button>
            </section>)}

          {joined && view === 'home' && !chat && <section className="after-hours">
            <div><h3>After Hours</h3><p>{meetup?.tonight ? 'Tonight’s meetup started at 9 PM.' : meetup ? `Next meetup Friday, ${meetup.date} at 9 PM.` : 'Fridays at 9 PM.'} Bacolod time. Everyone joins the Quick Chat pool.</p></div>
            <button className="secondary" disabled={busy || waiting} onClick={async () => {
              if (await act('after-hours', { drink, spot })) setMode('quick');
            }}>{waiting ? 'In the queue' : 'Join Quick Chat'}</button>
          </section>}

          {joined && view === 'matches' && !chat && <section className="card">
            <div className="card-head"><span className="tile-icon"><Heart size={22} /></span><h2>Matches</h2>{!matches.length && <p>Mutual hellos and shots are saved here.</p>}</div>
            {matches.map(match => <button className="match" key={match.id} onClick={() => setChatId(match.id)}><span className="match-name"><span className="avatar" aria-hidden="true">{Array.from(match.nickname)[0]}</span>{match.nickname}</span><ArrowRight size={18} /></button>)}
            {!matches.length && <button className="primary" onClick={() => navigate('home')}>Find a Chat <ArrowRight size={18} /></button>}
          </section>}

          {joined && chat && <section className="card conversation" key={chat.id}>
            <div className="chat-head">
              <div className="avatar" aria-hidden="true">{Array.from(chat.nickname)[0]}</div>
              <div className="peer"><h2>{chat.nickname}</h2><p>{chat.matched ? 'Match kamo!' : chat.school || 'Random chat'}</p></div>
              <button className="icon-button" aria-label="Report or block" aria-expanded={report} onClick={() => setReport(!report)}><Flag size={18} /></button>
              <button className="icon-button" disabled={busy} aria-label={chat.matched ? 'Back to Matches' : 'Leave chat'} onClick={async () => {
                if (!chat.matched) { await act('leave'); return; }
                if (!chat.barPending || await act('bar-dismiss')) navigate('matches');
              }}><X size={20} /></button>
            </div>
            {report && <div className="report"><strong>Report or block</strong><p>Reporting also ends the chat and blocks this guest.</p><div className="pills">
              {reasons.map(reason => <button key={reason} disabled={busy} onClick={() => void act('report', { reason })}>{reason}</button>)}
              <button disabled={busy} onClick={() => void act('block')}>Block</button>
            </div></div>}
            {chat.matched && <p className="match-banner" role="status"><Heart size={17} /> It’s mutual. This chat is saved in Matches.</p>}
            <div className="thread" ref={thread} role="log" aria-label="Messages" tabIndex={0} onScroll={event => {
              const log = event.currentTarget;
              followThread.current = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
            }}>
              {!data?.messages?.length && <p className="opener"><MessageCircle size={16} /> {opener}</p>}
              {data?.messages?.map(message => <p className={message.mine ? 'bubble mine' : 'bubble'} key={message.id}>{message.body}</p>)}
            </div>
            {!data?.messages?.length && !chat.matched && <div className="icebreaker">
              <div><Sparkles size={17} /><p>{icebreakers[promptIndex]}</p></div>
              <button type="button" className="icon-button" aria-label="Shuffle icebreaker" onClick={() => setPromptIndex((promptIndex + 1) % icebreakers.length)}><Shuffle size={16} /></button>
              <button type="button" className="secondary" disabled={Boolean(draft.trim())} onClick={() => { setDraft(icebreakers[promptIndex]); composer.current?.focus(); }}>Use prompt</button>
            </div>}
            <form className="composer" onSubmit={send}>
              <input ref={composer} aria-label="Message" placeholder="Say hi…" maxLength={1000} readOnly={busy} value={draft} onChange={event => setDraft(event.target.value)} />
              <button className="send" aria-label="Send message" disabled={busy || !draft.trim()}><ArrowUp size={22} /></button>
            </form>
            {!chat.matched && <div className="actions">
              <button className="secondary" disabled={busy} onClick={() => void act('next')}><Shuffle size={17} /> Next</button>
              <button className="primary" disabled={busy || chat.shot} onClick={() => void act('shot')}><Heart size={17} /> {chat.shot ? 'Shot sent' : 'Shoot Your Shot'}</button>
            </div>}
            {!chat.matched && <p className="shot-note">Your shot stays private unless you both tap.</p>}
          </section>}
        </div>
      </main>
    </div>
  );
}
