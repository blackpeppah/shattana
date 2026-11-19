'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, ArrowUp, Flag, Heart, MessageCircle, Shuffle, MapPin, X } from 'lucide-react';
import { drinks, spots, reasons } from './options';

type Chat = { id: string; nickname: string; school: string; drink: string; spot: string; matched: boolean; shot: boolean };
type State = {
  profile: { nickname: string; school: string; drink: string; spot: string; waiting: boolean } | null;
  active?: Chat;
  selected?: Chat;
  matches?: Chat[];
  messages?: { id: string; mine: boolean; body: string }[];
};

export default function Home() {
  const [data, setData] = useState<State>();
  const [view, setView] = useState<'home' | 'matches'>('home');
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
  const bottom = useRef<HTMLDivElement>(null);
  const revision = useRef(0);
  const requestInProgress = useRef(false);
  const hydrated = useRef(false);
  const chat = chatId ? (data?.selected?.id === chatId ? data.selected : undefined) : view === 'home' ? data?.active : undefined;
  const matches = data?.matches ?? [];
  const waiting = Boolean(data?.profile?.waiting);
  const joined = Boolean(data?.profile);
  const lastMessage = data?.messages?.at(-1)?.id;

  async function request(action?: string, fields: Record<string, unknown> = {}, selected = chatId) {
    const response = await fetch('/api/chat' + (selected ? '?chat=' + encodeURIComponent(selected) : ''), action ? {
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
    const timer = window.setInterval(refresh, waiting || chatId || data?.active ? 1800 : 9000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
    // A new polling cycle is needed when the conversation or queue changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, waiting, data?.active?.id, joined, view]);

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }); }, [lastMessage, chat?.id]);
  useEffect(() => { setReport(false); setDraft(''); }, [chat?.id]);

  async function act(action: string, fields: Record<string, unknown> = {}) {
    if (requestInProgress.current) return false;
    requestInProgress.current = true;
    revision.current++;
    setBusy(true);
    setError('');
    try {
      const payload = await request(action, fields, chat?.id ?? chatId);
      setData(payload);
      if (action === 'find' || action === 'next' || action === 'block' || action === 'report') setChatId('');
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
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (draft.trim() && await act('send', { body: draft })) setDraft('');
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
        <span className="age"><span className="age-location">Bacolod <span aria-hidden="true">/</span> </span>18+</span>
      </header>

      <main className={view === 'home' && !chat ? 'discover' : 'workspace'}>
        {view === 'home' && !chat && <section className="hero">
          <div className="locale"><MapPin size={15} /> Bacolod City</div>
          <h1>Hi lang anay.<br /><em>Basi ikaw na.</em></h1>
          <p>Meet someone from Bacolod in a one-on-one chat.</p>
        </section>}

        <div className="panel">
          {error && <p className="error" role="alert">{error}</p>}
          {!data && !error && <p role="status" className="card muted">Loading Shattana…</p>}

          {data && !joined && <form className="card entry" onSubmit={event => { event.preventDefault(); void act('join', { nickname, school, adult }); }}>
            <div className="card-head"><h2>Join as a guest</h2><p>Your nickname is what people see in chat.</p></div>
            <div className="fields">
              <label>Nickname<input required maxLength={24} value={nickname} onChange={event => setNickname(event.target.value)} placeholder="e.g. Kai" /></label>
              <label>School <span>(optional)</span><input maxLength={60} value={school} onChange={event => setSchool(event.target.value)} placeholder="Your school" /></label>
            </div>
            <label className="check"><input type="checkbox" checked={adult} onChange={event => setAdult(event.target.checked)} required /> I’m 18 or older</label>
            <button className="primary" disabled={busy}>Continue <ArrowRight size={18} /></button>
          </form>}

          {joined && view === 'home' && !chat && (waiting
            ? <section className="card waiting"><div className="tile-icon"><Shuffle size={23} /></div><h2 role="status">Finding someone…</h2><p>Keep this tab open. We’ll open the chat when someone joins.</p><button className="secondary" onClick={() => void act('cancel')} disabled={busy}>Cancel search</button></section>
            : <section className="card">
              <div className="card-head"><h2>Find a chat</h2><p>Choose an icebreaker or start right away.</p></div>
              <fieldset><legend>What’s your round? <span>Optional</span></legend><div className="pills">{drinks.map(option => <button type="button" key={option} aria-pressed={drink === option} onClick={() => setDrink(drink === option ? '' : option)}>{option}</button>)}</div></fieldset>
              <fieldset><legend>Where’s your spot? <span>Optional</span></legend><div className="pills spot-options">{spots.map(option => <button type="button" key={option} aria-pressed={spot === option} onClick={() => setSpot(spot === option ? '' : option)}>{option}</button>)}</div></fieldset>
              <button className="primary" disabled={busy} onClick={() => void act('find', { drink, spot })}>{busy ? 'Starting…' : 'Find a Chat'} <ArrowRight size={19} /></button>
            </section>)}

          {joined && view === 'matches' && !chat && <section className="card">
            <div className="card-head"><h2>Matches</h2>{!matches.length && <p>When you both shoot your shot, your chat lands here.</p>}</div>
            {matches.map(match => <button className="match" key={match.id} onClick={() => setChatId(match.id)}><span className="match-name"><span className="avatar" aria-hidden="true">{Array.from(match.nickname)[0]}</span>{match.nickname}</span><ArrowRight size={18} /></button>)}
            {!matches.length && <button className="primary" onClick={() => navigate('home')}>Find a Chat <ArrowRight size={18} /></button>}
          </section>}

          {joined && chat && <section className="card conversation" key={chat.id}>
            <div className="chat-head">
              <div className="avatar" aria-hidden="true">{Array.from(chat.nickname)[0]}</div>
              <div className="peer"><h2>{chat.nickname}</h2><p>{chat.matched ? 'Match kamo!' : chat.school || 'Random chat'}</p></div>
              <button className="icon-button" aria-label="Report or block" aria-expanded={report} onClick={() => setReport(!report)}><Flag size={18} /></button>
              {chat.matched && <button className="icon-button" aria-label="Close conversation" onClick={() => navigate('matches')}><X size={20} /></button>}
            </div>
            {report && <div className="report"><strong>Report or block</strong><p>Reporting also ends the chat and blocks this guest.</p><div className="pills">
              {reasons.map(reason => <button key={reason} disabled={busy} onClick={() => void act('report', { reason })}>{reason}</button>)}
              <button disabled={busy} onClick={() => void act('block')}>Block</button>
            </div></div>}
            <div className="thread" role="log" aria-label="Messages">
              <p className="opener"><MessageCircle size={16} /> {opener}</p>
              {data?.messages?.map(message => <p className={message.mine ? 'bubble mine' : 'bubble'} key={message.id}>{message.body}</p>)}
              <div ref={bottom} />
            </div>
            <form className="composer" onSubmit={send}>
              <input aria-label="Message" placeholder="Say hi…" maxLength={1000} value={draft} onChange={event => setDraft(event.target.value)} />
              <button className="send" aria-label="Send message" disabled={busy || !draft.trim()}><ArrowUp size={22} /></button>
            </form>
            {!chat.matched && <div className="actions">
              <button className="secondary" disabled={busy} onClick={() => void act('next')}><Shuffle size={17} /> Next</button>
              <button className="primary" disabled={busy || chat.shot} onClick={() => void act('shot')}><Heart size={17} /> {chat.shot ? 'Shot sent' : 'Shoot Your Shot'}</button>
            </div>}
          </section>}
        </div>
      </main>
    </div>
  );
}
