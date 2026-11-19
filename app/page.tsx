'use client';

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type PointerEvent } from 'react';
import { ArrowRight, Flag, Heart, MessageCircle, Moon, Shuffle, MapPin, ShieldCheck, Sun } from 'lucide-react';
import { drinks, genders, spots, reasons } from './options';
import { BarCard, BarSetup, type BarCandidate, type BarProfile } from './across-bar';
import { afterHours } from './after-hours';
import { DiscoverGuide } from './discover-guide';
import { JoinChallenge } from './join-challenge';

const openChatKey = 'shattana.open-chat';
type Chat = { id: string; nickname: string; school: string; drink: string; spot: string; gender: string; matched: boolean; shot: boolean; barPending: boolean; peerTyping: boolean };
type State = {
  profile: (BarProfile & { nickname: string; school: string; drink: string; spot: string; quickGender: string; waiting: boolean }) | null;
  challenge?: { required: boolean; siteKey?: string };
  activeUsers: number;
  active?: Chat;
  selected?: Chat;
  matches?: Chat[];
  candidate?: BarCandidate;
  newBarChat?: string;
  advancedChat?: string;
  messages?: { id: string; mine: boolean; body: string }[];
};

export default function Home() {
  const [data, setData] = useState<State>();
  const [dark, setDark] = useState(false);
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
  const [challengeToken, setChallengeToken] = useState('');
  const [challengeAttempt, setChallengeAttempt] = useState(0);
  const [drink, setDrink] = useState('');
  const [spot, setSpot] = useState('');
  const [quickGender, setQuickGender] = useState('');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [report, setReport] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [endingQuickChat, setEndingQuickChat] = useState(false);
  const [matchAnnouncement, setMatchAnnouncement] = useState('');
  const composer = useRef<HTMLInputElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const pressedControl = useRef<HTMLElement | null>(null);
  const previousChat = useRef<Chat | undefined>(undefined);
  const followThread = useRef(true);
  const revision = useRef(0);
  const requestInProgress = useRef(false);
  const endingChat = useRef(false);
  const lastHeartbeat = useRef(0);
  const typingActivity = useRef<{ chatId: string; at: number } | null>(null);
  const hydrated = useRef(false);
  const chat = chatId ? (data?.selected?.id === chatId ? data.selected : undefined)
    : view === 'home' ? (data?.selected?.barPending ? data.selected : data?.active) : undefined;
  const matches = data?.matches ?? [];
  const waiting = Boolean(data?.profile?.waiting);
  const joined = Boolean(data?.profile);
  const lastMessage = data?.messages?.at(-1)?.id;
  const inConversation = Boolean(chat);

  async function showEndedQuickChat() {
    endingChat.current = true;
    setEndingQuickChat(true);
    setReport(false);
    await new Promise<void>(resolve => window.setTimeout(resolve, 1800));
    endingChat.current = false;
    setEndingQuickChat(false);
    setView('home');
    setMode('quick');
    setChatId('');
  }

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
    setDark(document.documentElement.dataset.theme === 'dark');
  }, []);

  function toggleTheme() {
    const theme = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    setDark(!dark);
    try { localStorage.setItem('shattana.theme', theme); } catch {}
  }

  function clearTapFeedback() {
    pressedControl.current?.removeAttribute('data-tap-pressed');
    pressedControl.current = null;
  }

  function showTapFeedback(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' || !(event.target instanceof Element)) return;
    const control = event.target.closest<HTMLElement>('button:not(:disabled), .faq-row summary');
    if (!control?.closest('.discover, .masthead')) return;
    clearTapFeedback();
    control.setAttribute('data-tap-pressed', '');
    pressedControl.current = control;
  }

  useEffect(() => {
    const savedChat = sessionStorage.getItem(openChatKey);
    if (savedChat) setChatId(savedChat);
  }, []);

  useEffect(() => {
    let live = true;
    let inFlight = false;
    async function refresh() {
      if (inFlight || requestInProgress.current || document.hidden) return;
      inFlight = true;
      const version = revision.current;
      try {
        const now = Date.now();
        const selected = chatId || data?.selected?.id;
        const activity = typingActivity.current;
        const typing = !endingChat.current && activity !== null && activity.chatId === selected && now - activity.at < 2400;
        const heartbeat = joined && now - lastHeartbeat.current > (waiting || data?.active ? 12000 : 35000);
        const payload = await request(heartbeat ? 'heartbeat' : typing ? 'typing' : undefined, {}, selected);
        if (heartbeat) lastHeartbeat.current = Date.now();
        if (!live || version !== revision.current) return;
        const previousQuickChat = data?.active?.id;
        if (view === 'home' && previousQuickChat && payload.advancedChat === previousQuickChat) {
          await showEndedQuickChat();
          setData(payload);
          return;
        }
        setData(payload);
        if (!data) setError('');
        if (view === 'home' && previousQuickChat && payload.active?.id !== previousQuickChat &&
          !payload.matches?.some(match => match.id === previousQuickChat)) {
          setNotice('Chat ended. Start a new Quick Chat whenever you’re ready.');
        }
        if (payload.profile && !hydrated.current) {
          hydrated.current = true;
          setDrink(payload.profile.drink);
          setSpot(payload.profile.spot);
          setQuickGender(payload.profile.quickGender);
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
  useEffect(() => { setReport(false); setConfirmRemove(false); setDraft(''); typingActivity.current = null; }, [chat?.id]);
  useLayoutEffect(() => { followThread.current = true; }, [chat?.id]);
  useEffect(() => {
    const previous = previousChat.current;
    if (chat?.id !== previous?.id) setMatchAnnouncement('');
    if (chat?.matched && !chat.barPending && previous?.id === chat.id && !previous.matched) {
      setMatchAnnouncement(chat.id);
    }
    previousChat.current = chat;
    if (chat) sessionStorage.setItem(openChatKey, chat.id);
    else if (data && !chatId) sessionStorage.removeItem(openChatKey);
  }, [chat, chatId, data]);

  useLayoutEffect(() => {
    if (thread.current && (followThread.current || endingQuickChat)) thread.current.scrollTop = thread.current.scrollHeight;
  }, [lastMessage, chat?.id, chat?.peerTyping, matchAnnouncement, endingQuickChat]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const element = shell.current;
    if (!inConversation || !viewport || !element) return;
    const chatViewport = viewport;
    const chatShell = element;
    function update() {
      chatShell.style.setProperty('--chat-viewport-height', `${chatViewport.height}px`);
      chatShell.style.setProperty('--chat-viewport-top', `${chatViewport.offsetTop}px`);
      chatShell.toggleAttribute('data-compact', chatViewport.height < 360);
      if (thread.current && followThread.current) thread.current.scrollTop = thread.current.scrollHeight;
    }
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      element.style.removeProperty('--chat-viewport-height');
      element.style.removeProperty('--chat-viewport-top');
      element.removeAttribute('data-compact');
    };
  }, [inConversation]);

  async function act(action: string, fields: Record<string, unknown> = {}) {
    if (requestInProgress.current || endingChat.current) return false;
    requestInProgress.current = true;
    revision.current++;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const payload = await request(action, fields, chat?.id ?? chatId);
      if (action === 'next') await showEndedQuickChat();
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
      if (action === 'leave' || action === 'next') {
        setView('home');
        setMode('quick');
      }
      if (action === 'leave') setNotice('You left the conversation.');
      if (action === 'unmatch') {
        setView('matches');
        setNotice('Match removed.');
      }
      if (['find', 'next', 'leave', 'unmatch', 'block', 'report'].includes(action)) setChatId('');
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
    typingActivity.current = null;
    if (await act('send', { body: draft })) setDraft('');
  }

  const mySpot = data?.profile?.spot;
  const myRound = data?.profile?.drink;
  const icebreakers = [
    myRound && myRound === chat?.drink ? `${myRound} kag chika? g?` : '',
    mySpot && mySpot === chat?.spot ? `chika sa ${mySpot}? g?` : '',
  ].filter(Boolean);
  if (!icebreakers.length) icebreakers.push('one drink or a whole yap session?');

  return (
    <div ref={shell} className={chat ? 'shell chat-shell' : 'shell'} onPointerDown={showTapFeedback}
      onPointerUp={clearTapFeedback} onPointerCancel={clearTapFeedback}>
      <header className="masthead">
        <button className="brand" disabled={endingQuickChat} onClick={() => navigate('home')}>shattana<span>!</span></button>
        {joined && <nav aria-label="Main navigation">
          <button disabled={endingQuickChat} aria-current={view === 'home' ? 'page' : undefined} onClick={() => navigate('home')}><Shuffle size={16} /> Discover</button>
          <button disabled={endingQuickChat} aria-current={view === 'matches' ? 'page' : undefined} onClick={() => navigate('matches')}><Heart size={16} /> Matches {matches.length > 0 && <span className="count">{matches.length}</span>}</button>
        </nav>}
        <div className="header-tools">
          {typeof data?.activeUsers === 'number' && <output className="presence-pill" aria-label="Active guests"
            title="Guests active in the last 90 seconds. Join as a guest to be counted.">{data.activeUsers}</output>}
          <button type="button" className="theme-switch" role="switch" aria-label="Dark mode" aria-checked={dark} onClick={toggleTheme}>
            <span className="theme-track" aria-hidden="true">
              <span className="theme-thumb"><Sun size={13} /><Moon size={13} /></span>
            </span>
          </button>
        </div>
      </header>

      <main className={view === 'home' && !chat ? 'discover' : 'workspace'}>
        {view === 'home' && !chat && <section className="hero">
          <div className="locale"><MapPin size={15} /> Bacolod City</div>
          <h1>down for a drink? <em>g!</em></h1>
          <p>yap and i’m giving u shots</p>
          <div className="hero-preview" aria-hidden="true">
            <span className="preview-bubble">one drink or a whole yap session? <span>✦</span></span>
            <span className="preview-bubble preview-reply">both. g! <span>♡</span></span>
          </div>
        </section>}

        <div className="panel">
          {error && <p className="error" role="alert">{error}</p>}
          {notice && !chat && <p className="notice" role="status">{notice}</p>}
          {!data && !error && <p role="status" className="card muted">Loading Shattana…</p>}

          {data && !joined && <form className="card entry" onSubmit={async event => {
            event.preventDefault();
            if (data.challenge?.required && !challengeToken) return;
            if (!await act('join', { nickname, school, adult, challengeToken }) && data.challenge?.siteKey) {
              setChallengeToken('');
              setChallengeAttempt(attempt => attempt + 1);
            }
          }}>
            <div className="card-head"><span className="tile-icon"><MessageCircle size={22} /></span><h2>Join as a guest</h2><p>Pick a nickname to get started.</p></div>
            <div className="fields">
              <label>Nickname<input required maxLength={24} value={nickname} onChange={event => setNickname(event.target.value)} placeholder="e.g. Kai" /></label>
              <label>School <span>(optional, visible in chat)</span><input maxLength={60} value={school} onChange={event => setSchool(event.target.value)} placeholder="Your school" /></label>
            </div>
            <label className="check"><input type="checkbox" checked={adult} onChange={event => setAdult(event.target.checked)} required /> I’m 18 or older</label>
            {data.challenge?.siteKey && <JoinChallenge key={challengeAttempt} siteKey={data.challenge.siteKey} theme={dark ? 'dark' : 'light'} onToken={setChallengeToken} />}
            {data.challenge?.required && !data.challenge.siteKey && <p role="status">Guest verification is temporarily unavailable.</p>}
            <button className="primary" disabled={busy || Boolean(data.challenge?.required && !challengeToken)}>Continue <ArrowRight size={18} /></button>
            <p className="privacy-note"><ShieldCheck size={16} /> Share only what you’re comfortable sharing.</p>
          </form>}

          {joined && view === 'home' && !chat && <div className="mode-choices" aria-label="How to meet">
            <button className="secondary" aria-pressed={mode === 'quick'} disabled={busy} onClick={() => void chooseMode('quick')}><Shuffle size={17} /> Quick Chat</button>
            <button className="secondary" aria-pressed={mode === 'bar'} disabled={busy} onClick={() => void chooseMode('bar')}><Heart size={17} /> Across the Bar</button>
          </div>}

          {data?.profile && view === 'home' && !chat && <div className="discover-mode" key={mode}>
          {mode === 'bar' ? <section className="card discovery-card">
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
          </section> : waiting
            ? <section className="card waiting"><div className="tile-icon"><Shuffle size={23} /></div><h2 role="status">Finding someone…</h2><p>Keep this tab open. We’ll open the chat when someone joins.</p><button className="secondary" onClick={() => void act('cancel')} disabled={busy}>Cancel search</button></section>
            : <section className="card discovery-card">
              <div className="card-head"><h2>Quick Chat</h2><p>Get paired at random. Choose an icebreaker or jump right in.</p></div>
              <fieldset className="fields"><label>Gender <span>(optional, visible in chat)</span>
                <select value={quickGender} onChange={event => setQuickGender(event.target.value)}>
                  <option value="">Prefer not to share</option>
                  {genders.map(gender => <option key={gender}>{gender}</option>)}
                </select>
              </label></fieldset>
              <fieldset><legend>What’s your round? <span>Optional</span></legend><div className="pills">{drinks.map(option => <button type="button" key={option} aria-pressed={drink === option} onClick={() => setDrink(drink === option ? '' : option)}>{option}</button>)}</div></fieldset>
              <fieldset><legend>Where’s your spot? <span>Optional</span></legend><div className="pills spot-options">{spots.map(option => <button type="button" key={option} aria-pressed={spot === option} onClick={() => setSpot(spot === option ? '' : option)}>{option}</button>)}</div></fieldset>
              <button className="primary" disabled={busy} onClick={() => void act('find', { drink, spot, quickGender })}>{busy ? 'Starting…' : 'Start Quick Chat'} <ArrowRight size={19} /></button>
            </section>}
          </div>}

          {joined && view === 'home' && !chat && <section className="after-hours">
            <div><h3>After Hours</h3><p>{meetup?.tonight ? 'Tonight’s meetup started at 9 PM.' : meetup ? `Next meetup Friday, ${meetup.date} at 9 PM.` : 'Fridays at 9 PM.'} Bacolod time. Everyone joins the Quick Chat pool.</p></div>
            <button className="secondary" disabled={busy || waiting} onClick={async () => {
              if (await act('after-hours', { drink, spot, quickGender })) setMode('quick');
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
              <div className="peer"><h2>{chat.nickname}</h2><p>{[chat.gender, chat.matched ? 'Saved match' : chat.school || 'Quick Chat'].filter(Boolean).join(' · ')}</p></div>
            </div>
            <div className="chat-controls">
              <button className="secondary" disabled={busy || endingQuickChat} onClick={async () => {
                if (!chat.matched) { await act('leave'); return; }
                if (!chat.barPending || await act('bar-dismiss')) navigate('matches');
              }}>{chat.matched ? 'Back to Matches' : 'Leave chat'}</button>
              {!chat.matched && <button className="secondary" disabled={busy || endingQuickChat} onClick={() => void act('next')}>Next chat</button>}
              <button className="secondary chat-menu" disabled={endingQuickChat} aria-controls="chat-moderation" aria-expanded={report} onClick={() => {
                setReport(!report);
                setConfirmRemove(false);
              }}><Flag size={16} /> Chat menu</button>
            </div>
            <div id="chat-moderation" className="report" hidden={!report}>
              {confirmRemove ? <>
                <strong>Remove this match?</strong>
                <p>This closes the conversation for both of you and removes it from both Matches lists.</p>
                <div className="pills">
                  <button disabled={busy} onClick={() => setConfirmRemove(false)}>Keep match</button>
                  <button disabled={busy} onClick={() => void act('unmatch')}>Yes, remove match</button>
                </div>
              </> : <>
                <strong>{chat.matched ? 'Manage match' : 'Block or Report'}</strong>
                <p>Choose a report reason, or block this guest. Both end the conversation.</p>
                <div className="pills">
                  {reasons.map(reason => <button key={reason} disabled={busy} onClick={() => void act('report', { reason })}>{reason}</button>)}
                  <button disabled={busy} onClick={() => void act('block')}>Block</button>
                  {chat.matched && <button disabled={busy} onClick={() => setConfirmRemove(true)}>Remove match</button>}
                </div>
              </>}
            </div>
            {!chat.matched && <div className="shot-control">
              {chat.shot ? <p className="shot-note" role="status">Shot sent · only you can see this</p>
                : <button className="secondary shot-button" disabled={busy || endingQuickChat} onClick={() => void act('shot')}><Heart size={16} /> Shoot Your Shot</button>}
            </div>}
            <div className="thread" ref={thread} role="log" aria-label="Messages" tabIndex={0} onScroll={event => {
              const log = event.currentTarget;
              followThread.current = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
            }}>
              {!data?.messages?.length && !chat.matched && !endingQuickChat && <div className="first-message">
                <div className="icebreaker-lines">{icebreakers.map(line => <p key={line}>{line}</p>)}</div>
                <button type="button" className="secondary" onClick={() => {
                  if (!draft) setDraft('g!');
                  composer.current?.focus();
                }}>g!</button>
              </div>}
              {data?.messages?.map(message => <p className={message.mine ? 'bubble mine' : 'bubble'} key={message.id}>{message.body}</p>)}
              {chat.peerTyping && !endingQuickChat && <div className="typing-bubble" role="status" aria-label={`${chat.nickname} is typing`}>
                <span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" />
              </div>}
              {matchAnnouncement === chat.id && <p className="match-announcement">Ti, pareho kamo gali.</p>}
              {endingQuickChat && <p className="match-announcement" role="status">Chat ended. Looking for someone new…</p>}
            </div>
            <form className="composer" onSubmit={send}>
              <input ref={composer} aria-label="Message" placeholder="Say hi…" maxLength={1000} readOnly={busy || endingQuickChat} value={draft} onChange={event => {
                const value = event.target.value;
                setDraft(value);
                typingActivity.current = value.trim() ? { chatId: chat.id, at: Date.now() } : null;
              }} />
              <button className="primary send" disabled={busy || endingQuickChat || !draft.trim()}>Send</button>
            </form>
          </section>}
        </div>
        {view === 'home' && !chat && !chatId && <DiscoverGuide />}
      </main>
    </div>
  );
}
