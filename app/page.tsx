'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent } from 'react';
import Image from 'next/image';
import { ArrowRight, Flag, Heart, MessageCircle, Moon, Shuffle, MapPin, ShieldCheck, Sun } from 'lucide-react';
import { drinks, genders, spots, reasons } from './options';
import { BarCard, BarSetup, type BarCandidate, type BarProfile } from './across-bar';
import { afterHours } from './after-hours';
import { DiscoverGuide } from './discover-guide';
import { GuestPrivacy } from './guest-privacy';
import { JoinChallenge } from './join-challenge';
import { MeetupCard, MeetupEditor, type MeetupDraft, type MeetupInvite } from './meetup-invite';
import { PhotoAvatar, type PhotoSettings } from './profile-photo';
import shattanaLogo from '../shattana-logo.png';

const openChatKey = 'shattana.open-chat';
const barHiNotice = 'Hi sent. It stays private unless they say hi too.';
type Chat = { id: string; nickname: string; drink: string; spot: string; gender: string; matched: boolean; shot: boolean; barPending: boolean; peerTyping: boolean; readThrough: string; unread: boolean; preview: string | null; photoId?: string | null };
type Message = { id: string; mine: boolean; body: string };
type State = {
  availableSpots?: string[];
  profile: (BarProfile & { nickname: string; drink: string; spot: string; quickGender: string; waiting: boolean }) | null;
  challenge?: { required: boolean; siteKey?: string };
  activeUsers: number;
  active?: Chat;
  selected?: Chat;
  matches?: Chat[];
  candidate?: BarCandidate;
  newBarChat?: string;
  advancedChat?: string;
  messages?: Message[];
  invite?: MeetupInvite;
  savedMatchFeatures?: boolean;
  retrySends?: boolean;
  extendedMeetups?: boolean;
  hasEarlier?: boolean;
  guestControls?: boolean;
  photosReady?: boolean;
  suspended?: boolean;
  lastReportableChat?: string;
};

function MessageBubbles({ messages = [], liveFrom }: { messages?: Message[]; liveFrom?: string }) {
  const [history] = useState(() => new Set(messages.map(message => message.id)));
  return messages.map(message => <p key={message.id} data-message-id={message.id} data-incoming-id={message.mine ? undefined : message.id}
    className={`bubble${message.mine ? ' mine' : ''}${history.has(message.id) || (liveFrom && BigInt(message.id) < BigInt(liveFrom)) ? '' : ' motion-rise'}`}>{message.body}</p>);
}

function mergeMessages(previous: Message[], next: Message[]) {
  return Array.from(new Map([...previous, ...next].map(message => [message.id, message])).values())
    .sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1);
}

function sendNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

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
  const [reportLastTarget, setReportLastTarget] = useState('');
  const [endingQuickChat, setEndingQuickChat] = useState(false);
  const [matchAnnouncement, setMatchAnnouncement] = useState('');
  const [connectingChat, setConnectingChat] = useState('');
  const [sentShot, setSentShot] = useState('');
  const [arrivingCard, setArrivingCard] = useState('');
  const [meetupDraft, setMeetupDraft] = useState<MeetupDraft>();
  const [reconnecting, setReconnecting] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [failedSend, setFailedSend] = useState<{ chatId: string; nonce: string; body: string }>();
  const [history, setHistory] = useState<{ chatId: string; messages: Message[]; hasEarlier: boolean }>();
  const [loadingEarlier, setLoadingEarlier] = useState(false);
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
  const requestedReads = useRef(new Map<string, string>());
  const historyAnchor = useRef<{ chatId: string; top: number; height: number; messageId?: string; offset?: number } | null>(null);
  const hydrated = useRef(false);
  const chat = chatId ? (data?.selected?.id === chatId ? data.selected : undefined)
    : view === 'home' ? (data?.selected?.barPending ? data.selected : data?.active) : undefined;
  const matches = data?.matches ?? [];
  const availableSpots = data?.availableSpots ?? spots;
  const waiting = Boolean(data?.profile?.waiting);
  const joined = Boolean(data?.profile);
  const lastMessage = data?.messages?.at(-1)?.id;
  const savedHistory = history?.chatId === chat?.id ? history : undefined;
  const matchingMessages = data?.selected?.id === chat?.id ? data?.messages : undefined;
  const messages = useMemo(() => savedHistory ? mergeMessages(savedHistory.messages, matchingMessages ?? []) : matchingMessages ?? [],
    [savedHistory, matchingMessages]);
  const canLoadEarlier = savedHistory?.hasEarlier ?? data?.hasEarlier;
  const invite = chat?.matched && data?.selected?.id === chat.id ? data.invite : undefined;
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

  async function request(action?: string, fields: Record<string, unknown> = {}, selected = chatId, before?: string) {
    const params = new URLSearchParams();
    if (selected) params.set('chat', selected);
    if (before) params.set('before', before);
    if (view === 'home' && mode === 'bar') {
      params.set('bar', '1');
      if (barCursor && action !== 'bar-reset' && action !== 'bar-profile') params.set('after', barCursor);
    }
    const response = await fetch('/api/chat?' + params, action ? {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: selected, action, ...fields }),
      keepalive: action === 'read',
      signal: AbortSignal.timeout(10000),
    } : { cache: 'no-store', signal: AbortSignal.timeout(10000) });
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
    if (!control) return;
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
        setReconnecting(false);
        const previousQuickChat = data?.active?.id;
        if (view === 'home' && previousQuickChat && payload.advancedChat === previousQuickChat) {
          await showEndedQuickChat();
          if (payload.active) setConnectingChat(payload.active.id);
          setData(payload);
          return;
        }
        if (view === 'home' && waiting && payload.active && payload.active.id !== previousQuickChat) {
          setConnectingChat(payload.active.id);
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
        if (live && version === revision.current) {
          if (!data) setError((failure as Error).message);
          else setReconnecting(true);
        }
      } finally {
        inFlight = false;
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, waiting || chatId || data?.active || data?.selected?.barPending || mode === 'bar' ? 1800 : 9000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('online', refresh);
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
  useEffect(() => { setReport(false); setConfirmRemove(false); setDraft(''); setMeetupDraft(undefined); typingActivity.current = null; }, [chat?.id]);
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
    const anchor = historyAnchor.current;
    if (anchor && anchor.chatId === chat?.id && thread.current) {
      const log = thread.current;
      const message = anchor.messageId && log.querySelector(`[data-message-id="${anchor.messageId}"]`);
      if (message && anchor.offset !== undefined) {
        log.scrollTop += message.getBoundingClientRect().top - log.getBoundingClientRect().top - anchor.offset;
      } else {
        log.scrollTop = anchor.top + log.scrollHeight - anchor.height;
      }
      historyAnchor.current = null;
      return;
    }
    if (thread.current && (followThread.current || endingQuickChat)) thread.current.scrollTop = thread.current.scrollHeight;
  }, [lastMessage, chat?.id, chat?.peerTyping, invite?.version, matchAnnouncement, endingQuickChat, history]);

  useEffect(() => {
    if (!chat?.matched || !matchingMessages) return;
    const id = chat.id;
    setHistory(previous => {
      if (previous?.chatId !== id) return { chatId: id, messages: matchingMessages, hasEarlier: Boolean(data?.hasEarlier) };
      if (previous.messages.at(-1)?.id === matchingMessages.at(-1)?.id) return previous;
      return { ...previous, messages: mergeMessages(previous.messages, matchingMessages) };
    });
  }, [chat?.id, chat?.matched, matchingMessages, data?.hasEarlier]);

  useEffect(() => {
    if (!data?.savedMatchFeatures || !chat?.matched || !thread.current || data?.selected?.id !== chat.id) return;
    const { id, readThrough } = chat;
    const observer = new IntersectionObserver(entries => {
      if (document.hidden) return;
      const requested = requestedReads.current.get(id) ?? '0';
      let through = BigInt(requested) > BigInt(readThrough) ? requested : readThrough;
      for (const entry of entries) {
        const messageId = entry.target.getAttribute('data-incoming-id');
        if (entry.isIntersecting && entry.intersectionRatio > 0 && messageId && BigInt(messageId) > BigInt(through)) through = messageId;
      }
      if (BigInt(through) <= BigInt(requested) || BigInt(through) <= BigInt(readThrough)) return;
      requestedReads.current.set(id, through);
      void request('read', { through }, id).catch(() => {
        if (requestedReads.current.get(id) === through) requestedReads.current.delete(id);
      });
    });
    thread.current.querySelectorAll('[data-incoming-id]').forEach(message => observer.observe(message));
    return () => observer.disconnect();
  }, [chat?.id, chat?.matched, chat?.readThrough, data?.savedMatchFeatures, data?.selected?.id, data?.messages, history]);

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

  async function act(action: string, fields: Record<string, unknown> = {}, onError?: (message: string) => void) {
    if (requestInProgress.current || endingChat.current) {
      onError?.('Another request is in progress. Try again in a moment.');
      return false;
    }
    requestInProgress.current = true;
    revision.current++;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const payload = await request(action, fields, chat?.id ?? chatId);
      if (action === 'next') await showEndedQuickChat();
      if (['find', 'next', 'after-hours'].includes(action) && payload.active && payload.active.id !== chat?.id) {
        setConnectingChat(payload.active.id);
      }
      if ((action === 'bar-next' || action === 'bar-hi') && payload.candidate && payload.candidate.id !== data?.candidate?.id) {
        setArrivingCard(payload.candidate.id);
      }
      setData(payload);
      if (action === 'report') setNotice('Report submitted. This guest has been blocked.');
      if (action === 'report-last') {
        setReportLastTarget('');
        setNotice('Report submitted. This guest has been blocked.');
      }
      if (action === 'end-session' || action === 'delete-data') {
        sessionStorage.removeItem(openChatKey);
        hydrated.current = false;
        setView('home');
        setMode('quick');
        setChatId('');
        setNickname('');
        setAdult(false);
        setFailedSend(undefined);
        setHistory(undefined);
        setReportLastTarget('');
      }
      if (action === 'block') setNotice('This guest has been blocked.');
      if (action === 'bar-block') setNotice('This guest has been blocked.');
      if (action === 'bar-report') setNotice('Report submitted. This guest has been blocked.');
      if (action === 'bar-hi' && !payload.newBarChat) setNotice(barHiNotice);
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
      else if (action === 'shot' && payload.selected?.shot) setSentShot(payload.selected.id);
      return true;
    } catch (failure) {
      (onError ?? setError)((failure as Error).message);
      return false;
    } finally {
      requestInProgress.current = false;
      setBusy(false);
    }
  }

  function navigate(next: 'home' | 'matches') {
    setView(next);
    setChatId('');
    setConnectingChat('');
    setSentShot('');
    setError('');
    setNotice('');
  }

  function updatePhoto(photo: PhotoSettings) {
    revision.current++;
    setData(previous => previous?.profile ? { ...previous, profile: { ...previous.profile, ...photo } } : previous);
  }

  async function chooseMode(next: 'quick' | 'bar') {
    if (requestInProgress.current || next === mode || (next === 'bar' && waiting && !await act('cancel'))) return;
    setMode(next);
    setBarCursor('');
    setArrivingCard('');
    setEditingBar(false);
    setNotice('');
    setError('');
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!chat || !draft.trim() || requestInProgress.current) return;
    typingActivity.current = null;
    const pending = failedSend?.chatId === chat.id && failedSend.body === draft ? failedSend
      : { chatId: chat.id, body: draft, nonce: sendNonce() };
    setSendingMessage(true);
    try {
      if (await act('send', { body: pending.body, ...(data?.retrySends ? { nonce: pending.nonce } : {}) })) {
        setDraft('');
        setFailedSend(undefined);
      } else if (data?.retrySends) {
        setFailedSend(pending);
      }
    } finally {
      setSendingMessage(false);
    }
  }

  async function loadEarlier() {
    const element = thread.current;
    const before = messages[0]?.id;
    if (!chat?.matched || !element || !before || loadingEarlier) return;
    setLoadingEarlier(true);
    setError('');
    try {
      const page = await request(undefined, {}, chat.id, before);
      if (thread.current !== element) return;
      const bounds = element.getBoundingClientRect();
      const anchor = Array.from(element.querySelectorAll<HTMLElement>('[data-message-id]')).find(message => {
        const rect = message.getBoundingClientRect();
        return rect.bottom > bounds.top && rect.top < bounds.bottom;
      });
      historyAnchor.current = { chatId: chat.id, top: element.scrollTop, height: element.scrollHeight,
        messageId: anchor?.dataset.messageId, offset: anchor && anchor.getBoundingClientRect().top - bounds.top };
      followThread.current = false;
      setHistory(previous => ({
        chatId: chat.id,
        messages: mergeMessages(page.messages ?? [], previous?.chatId === chat.id ? previous.messages : messages),
        hasEarlier: Boolean(page.hasEarlier),
      }));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setLoadingEarlier(false);
    }
  }

  async function submitMeetup(fields: { venue: string; date: string; time?: string }) {
    if (!meetupDraft) return;
    const action = meetupDraft.kind === 'counter' ? 'meetup-respond' : 'meetup-propose';
    const response = meetupDraft.kind === 'counter' ? { response: 'counter' } : {};
    if (await act(action, { ...fields, version: meetupDraft.version, ...response })) setMeetupDraft(undefined);
  }

  function lastChatReport(target: string, inThread = false) {
    const expanded = reportLastTarget === target;
    return <div className={inThread ? 'last-chat-report last-chat-report-thread' : 'last-chat-report'}>
      <button className="secondary" aria-expanded={expanded} onClick={() => setReportLastTarget(expanded ? '' : target)}>Report last chat</button>
      {expanded && <div className="pills" aria-label="Report reason">
        {reasons.map(reason => <button key={reason} disabled={busy || endingQuickChat}
          onClick={() => void act('report-last', { chatId: target, reason })}>{reason}</button>)}
      </div>}
    </div>;
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
        <button className="brand" disabled={endingQuickChat} onClick={() => navigate('home')}>
          <Image className="brand-icon" src={shattanaLogo} alt="" width={48} height={48}
            sizes="(max-width: 760px) 40px, 48px" />
          <span>shattana<span className="brand-accent">!</span></span>
        </button>
        {joined && <nav aria-label="Main navigation">
          <button disabled={endingQuickChat} aria-current={view === 'home' ? 'page' : undefined} onClick={() => navigate('home')}>
            <Shuffle size={16} aria-hidden="true" /><span className="nav-label">Discover</span>
          </button>
          <button disabled={endingQuickChat} aria-current={view === 'matches' ? 'page' : undefined} onClick={() => navigate('matches')}>
            <Heart size={16} aria-hidden="true" /><span className="nav-label">Matches{' '}
              {matches.length > 0 && <span className="count">{matches.length}</span>}
            </span>
          </button>
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
          {reconnecting && joined && <p className="notice connection-notice" role="status">Reconnecting…</p>}
          {notice && notice !== barHiNotice && (!chat || notice === 'Report submitted. This guest has been blocked.') && <p className="notice" role="status">{notice}</p>}
          {!endingQuickChat && data?.lastReportableChat && lastChatReport(data.lastReportableChat)}
          {!data && !error && <p role="status" className="card muted">Loading Shattana…</p>}

          {data?.suspended && <p className="card" role="status">This browser is suspended from joining Shattana.
            {data.guestControls && ' You can still manage your session in Privacy & guest session below.'}</p>}
          {data && !joined && !data.suspended && <form className="card entry" onSubmit={async event => {
            event.preventDefault();
            if (data.challenge?.required && !challengeToken) return;
            if (!await act('join', { nickname, adult, challengeToken }) && data.challenge?.siteKey) {
              setChallengeToken('');
              setChallengeAttempt(attempt => attempt + 1);
            }
          }}>
            <div className="card-head"><span className="tile-icon"><MessageCircle size={22} /></span><h2>Join as a guest</h2><p>Pick a nickname to get started.</p></div>
            <div className="fields">
              <label>Nickname<input required maxLength={24} value={nickname} onChange={event => setNickname(event.target.value)} placeholder="e.g. Kai" /></label>
            </div>
            <label className="check"><input type="checkbox" checked={adult} onChange={event => setAdult(event.target.checked)} required /> I’m 18 or older</label>
            {data.challenge?.siteKey && <JoinChallenge key={challengeAttempt} siteKey={data.challenge.siteKey} theme={dark ? 'dark' : 'light'} onToken={setChallengeToken} />}
            {data.challenge?.required && !data.challenge.siteKey && <p role="status">Guest verification is temporarily unavailable.</p>}
            <button className="primary" disabled={busy || Boolean(data.challenge?.required && !challengeToken)}>Continue <ArrowRight size={18} /></button>
            <p className="privacy-note"><ShieldCheck size={16} /> Share only what you’re comfortable sharing.</p>
          </form>}

          {joined && view === 'home' && !chat && <div className="mode-choices" role="group" aria-label="How to meet" data-mode={mode}>
            <span className="mode-indicator" aria-hidden="true" />
            <button className="secondary" aria-pressed={mode === 'quick'} aria-disabled={busy} onClick={() => void chooseMode('quick')}><Shuffle size={17} /> Quick Chat</button>
            <button className="secondary" aria-pressed={mode === 'bar'} aria-disabled={busy} onClick={() => void chooseMode('bar')}><Heart size={17} /> Across the Bar</button>
          </div>}

          {data?.profile && view === 'home' && !chat && <div className="discover-mode" key={mode}>
          {mode === 'bar' ? <section className="card discovery-card">
            {editingBar || !data.profile.answer
              ? <BarSetup profile={data.profile} busy={busy} photosReady={Boolean(data.photosReady)} updatePhoto={updatePhoto}
                save={fields => void act('bar-profile', fields)} />
              : <>
                <div className="card-head"><h2>Across the Bar</h2><p>A private hello. A chat opens when you both say hi.</p></div>
                {data.candidate
                  ? <BarCard candidate={data.candidate} animate={arrivingCard === data.candidate.id} busy={busy} report={barReport} setReport={setBarReport} act={act} />
                  : <p role="status">No more profiles fit both sets of preferences right now.</p>}
                {notice === barHiNotice && <p className="notice bar-notice" role="status">{notice}</p>}
                <div className="bar-controls">
                  <button className="secondary" disabled={busy} onClick={() => setEditingBar(true)}>Edit card and preferences</button>
                  {!data.candidate && barCursor && <button className="secondary" disabled={busy} onClick={() => void act('bar-reset')}>Start over</button>}
                </div>
              </>}
          </section> : waiting
            ? <section className="card waiting">
              <div className="tile-icon"><Shuffle size={23} /></div>
              <h2 role="status">Finding someone…</h2>
              <p>Keep this tab open. We’ll open the chat when someone joins.</p>
              <p>The green count includes guests who are browsing or already in a chat. Try <a href="#after-hours">After Hours</a> when more people are likely to join.</p>
              <div className="queue-progress" aria-hidden="true" />
              <button className="secondary" onClick={() => void act('cancel')} disabled={busy}>Cancel search</button>
            </section>
            : <section className="card discovery-card">
              <div className="card-head"><h2>Quick Chat</h2><p>Get paired at random. Choose an icebreaker or jump right in.</p></div>
              <fieldset className="fields"><label>Gender <span>(optional, visible in chat)</span>
                <select value={quickGender} onChange={event => setQuickGender(event.target.value)}>
                  <option value="">Prefer not to share</option>
                  {genders.map(gender => <option key={gender}>{gender}</option>)}
                </select>
              </label></fieldset>
              <fieldset><legend>What’s your round? <span>Optional</span></legend><div className="pills">{drinks.map(option => <button type="button" key={option} aria-pressed={drink === option} onClick={() => setDrink(drink === option ? '' : option)}>{option}</button>)}</div></fieldset>
              {availableSpots.length > 0 && <fieldset><legend>Where’s your spot? <span>Optional</span></legend><div className="pills spot-options">{availableSpots.map(option => <button type="button" key={option} aria-pressed={spot === option} onClick={() => setSpot(spot === option ? '' : option)}>{option}</button>)}</div></fieldset>}
              <button className="primary" disabled={busy} onClick={() => void act('find', { drink, spot, quickGender })}>{busy ? 'Starting…' : 'Start Quick Chat'} <ArrowRight size={19} /></button>
            </section>}
          </div>}

          {joined && view === 'home' && !chat && <section className="after-hours" id="after-hours">
            <div><h3>After Hours</h3><p>{meetup?.tonight ? 'Tonight’s meetup started at 9 PM.' : meetup ? `Next meetup Friday, ${meetup.date} at 9 PM.` : 'Fridays at 9 PM.'} Bacolod time. Everyone joins the Quick Chat pool.</p></div>
            <button className="secondary" disabled={busy || waiting} onClick={async () => {
              if (await act('after-hours', { drink, spot, quickGender })) setMode('quick');
            }}>{waiting ? 'In the queue' : 'Join Quick Chat'}</button>
          </section>}

          {joined && view === 'matches' && !chat && <section className="card">
            <div className="card-head"><span className="tile-icon"><Heart size={22} /></span><h2>Matches</h2>{!matches.length && <p>Mutual hellos and shots are saved here.</p>}</div>
            {matches.map(match => <button className="match" key={match.id} aria-label={match.nickname}
              aria-describedby={[match.unread && `unread-${match.id}`, match.preview && `preview-${match.id}`].filter(Boolean).join(' ') || undefined}
              onClick={() => setChatId(match.id)}>
              <span className="match-name">
                <span className="avatar" aria-hidden="true">{Array.from(match.nickname)[0]}</span>
                <span className="match-copy"><span>{match.nickname}</span>
                  {match.preview && <span className="match-preview" id={`preview-${match.id}`}>{match.preview}</span>}
                </span>
              </span>
              {match.unread && <><span className="match-unread" aria-hidden="true" /><span hidden id={`unread-${match.id}`}>Unread messages</span></>}
              <ArrowRight size={18} aria-hidden="true" />
            </button>)}
            {!matches.length && <button className="primary" onClick={() => navigate('home')}>Find a Chat <ArrowRight size={18} /></button>}
          </section>}

          {joined && chat && <section className={`card conversation${connectingChat === chat.id ? ' motion-fade' : ''}`} key={chat.id}>
            <div className="chat-head">
              <PhotoAvatar nickname={chat.nickname} scope="quick" target={chat.id} photoId={chat.matched ? null : chat.photoId} />
              <div className="peer"><h2>{chat.nickname}</h2><p>{[chat.gender, chat.matched ? 'Saved match' : 'Quick Chat'].filter(Boolean).join(' · ')}</p></div>
            </div>
            <div className="chat-controls">
              <button className="secondary" disabled={busy || endingQuickChat} onClick={async () => {
                if (!chat.matched) { await act('leave'); return; }
                if (!chat.barPending || await act('bar-dismiss')) navigate('matches');
              }}>{chat.matched ? 'Back to Matches' : 'Leave chat'}</button>
              {!chat.matched && <button className="secondary" disabled={busy || endingQuickChat} onClick={() => void act('next')}>Next chat</button>}
              {chat.matched && data?.savedMatchFeatures && <button className="secondary" disabled={busy || invite?.status === 'pending'}
                aria-expanded={meetupDraft?.kind === 'propose'} onClick={() => setMeetupDraft(meetupDraft?.kind === 'propose'
                  ? undefined : { kind: 'propose', version: invite?.version ?? null })}>G ta?</button>}
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
              {chat.shot ? <p className={`shot-note${sentShot === chat.id ? ' motion-fade' : ''}`} role="status">Shot sent · only you can see this</p>
                : <button className="secondary shot-button" disabled={busy || endingQuickChat} onClick={() => void act('shot')}><Heart size={16} /> Shoot Your Shot</button>}
            </div>}
            {chat.matched && meetupDraft && <MeetupEditor key={meetupDraft.version ?? 'new'} draft={meetupDraft} venues={availableSpots} extended={Boolean(data?.extendedMeetups)} busy={busy}
              cancel={() => setMeetupDraft(undefined)} submit={fields => void submitMeetup(fields)} />}
            <div className="thread" ref={thread} role="log" aria-label="Messages" tabIndex={0} onScroll={event => {
              const log = event.currentTarget;
              followThread.current = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
            }}>
              {chat.matched && canLoadEarlier && <div className="history-control">
                <button className="secondary" disabled={loadingEarlier} onClick={() => void loadEarlier()}>{loadingEarlier ? 'Loading…' : 'Load earlier'}</button>
              </div>}
              {!data?.messages?.length && !chat.matched && !endingQuickChat && <div className="first-message">
                <div className="icebreaker-lines">{icebreakers.map(line => <p key={line}>{line}</p>)}</div>
                <button type="button" className="secondary" onClick={() => {
                  if (!draft) setDraft('g!');
                  composer.current?.focus();
                }}>g!</button>
              </div>}
              <MessageBubbles messages={messages} liveFrom={matchingMessages?.[0]?.id} />
              {invite && <MeetupCard invite={invite} nickname={chat.nickname} busy={busy}
                withdraw={data?.extendedMeetups ? () => void act('meetup-withdraw', { version: invite.version }) : undefined}
                counter={() => setMeetupDraft({ kind: 'counter', version: invite.version, venue: invite.venue, date: invite.date, time: invite.time })}
                respond={response => void act('meetup-respond', { version: invite.version, response })} />}
              {chat.peerTyping && !endingQuickChat && <div className="typing-bubble" role="status" aria-label={`${chat.nickname} is typing`}>
                <span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" />
              </div>}
              {matchAnnouncement === chat.id && <p className="match-announcement motion-fade">Ti, pareho kamo gali.</p>}
              {endingQuickChat && <p className="match-announcement" role="status">Chat ended. Looking for someone new…</p>}
              {endingQuickChat && lastChatReport(chat.id, true)}
            </div>
            <form className="composer" onSubmit={send}>
              <input ref={composer} aria-label="Message" placeholder="Say hi…" maxLength={1000} readOnly={busy || endingQuickChat} value={draft} onChange={event => {
                const value = event.target.value;
                setDraft(value);
                typingActivity.current = value.trim() ? { chatId: chat.id, at: Date.now() } : null;
              }} />
              <button className="primary send" disabled={busy || endingQuickChat || !draft.trim()}>
                {sendingMessage ? 'Sending…' : failedSend?.chatId === chat.id && failedSend.body === draft ? 'Retry' : 'Send'}
              </button>
            </form>
          </section>}
        </div>
        {view === 'home' && !chat && !chatId && <DiscoverGuide afterFaq={<GuestPrivacy
          canManage={Boolean(data?.guestControls && (joined || data.suspended))} busy={busy}
          submit={(action, onError) => act(action, action === 'delete-data' ? { confirmation: 'DELETE' } : {}, onError)}
        />} />}
      </main>
    </div>
  );
}
