'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Activity, ArrowUpRight, Flag, Heart, LayoutDashboard, LogOut, MapPin, Plus, Users } from 'lucide-react';
import logo from '../../shattana-logo.png';
import { ReportQueue } from './report-queue';

const sections = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'reports', label: 'Reports', icon: Flag },
  { id: 'guests', label: 'Guests', icon: Users },
  { id: 'venues', label: 'Venues', icon: MapPin },
] as const;
type Section = typeof sections[number]['id'];
type Venue = { id: number; name: string };
type Guest = { id: string; nickname: string; lastSeen: string; status: 'active' | 'available' | 'suspended' | 'ended' };
type DashboardData = {
  stats?: { active: number; matches: number; pending: number };
  guests?: Guest[];
  venues?: Venue[];
  venuesReady?: boolean;
};

const guestStatus = { active: 'Active', available: 'Away', suspended: 'Suspended', ended: 'Session ended' };
const sectionLink = (section: Section) => section === 'overview' ? '/moderation' : `/moderation?section=${section}`;

async function dashboardRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: 'no-store' });
  if (response.status === 401) window.location.replace('/admin');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The request failed.');
  return data;
}

export function Dashboard({ sectionName }: { sectionName?: string | string[] }) {
  const section = sections.find(item => item.id === sectionName)?.id ?? 'overview';
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState('');

  async function signOut() {
    setSigningOut(true);
    setError('');
    try {
      await dashboardRequest('/api/moderation/session', { method: 'DELETE' });
      window.location.replace('/admin');
    } catch (failure) {
      setError((failure as Error).message);
      setSigningOut(false);
    }
  }

  return <div className="admin-layout">
    <aside className="admin-sidebar">
      <div className="admin-brand">
        <Image src={logo} width={46} height={46} alt="" />
        <div><strong>Shattana!</strong><span>Administration</span></div>
      </div>
      <nav className="admin-nav" aria-label="Administration">
        {sections.map(({ id, label, icon: Icon }) => <Link key={id} href={sectionLink(id)}
          aria-current={id === section ? 'page' : undefined}>
          <Icon size={18} aria-hidden="true" />{label}
        </Link>)}
      </nav>
      <div className="admin-sidebar-actions">
        <a href="/">Open Shattana <ArrowUpRight size={16} aria-hidden="true" /></a>
        <button type="button" onClick={() => void signOut()} disabled={signingOut}>
          <LogOut size={16} aria-hidden="true" />{signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </aside>
    <main className="admin-content">
      {error && <p className="error" role="alert">{error}</p>}
      {section === 'reports' ? <ReportQueue /> : <DashboardSection key={section} section={section} />}
    </main>
  </div>;
}

function DashboardSection({ section }: { section: Exclude<Section, 'reports'> }) {
  const [data, setData] = useState<DashboardData>();
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [venueName, setVenueName] = useState('');
  const [editing, setEditing] = useState<number>();
  const [removing, setRemoving] = useState<number>();

  useEffect(() => {
    if (saving) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ view: section, search: query });
    let inFlight = false;
    async function refresh() {
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        const result = await dashboardRequest('/api/moderation/dashboard?' + params, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(9000)]),
        });
        if (!controller.signal.aborted) {
          setData(result);
          setLoadError('');
        }
      } catch {
        if (!controller.signal.aborted) setLoadError('Couldn’t load the latest data. Try refreshing.');
      } finally {
        inFlight = false;
      }
    }
    void refresh();
    const live = section !== 'venues';
    const timer = live ? window.setInterval(refresh, 10_000) : undefined;
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [section, query, revision, saving]);

  async function change(fields: Record<string, unknown>, message: string) {
    setSaving(true);
    setError('');
    setFeedback('');
    try {
      const result = await dashboardRequest('/api/moderation/dashboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields),
      });
      if (result.venue) {
        const venue = result.venue as Venue;
        setData(previous => {
          const list = previous?.venues ?? [];
          const venues = fields.action === 'delete-venue' ? list.filter(item => item.id !== venue.id)
            : list.some(item => item.id === venue.id) ? list.map(item => item.id === venue.id ? venue : item)
            : [...list, venue];
          return { ...previous, venues };
        });
      }
      setFeedback(message);
      setRevision(current => current + 1);
      return true;
    } catch (failure) {
      setError((failure as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveVenue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const success = await change(
      { action: editing === undefined ? 'create-venue' : 'rename-venue', id: editing, name: venueName },
      editing === undefined ? 'Venue added.' : 'Venue updated.',
    );
    if (success) { setVenueName(''); setEditing(undefined); }
  }

  const heading = sections.find(item => item.id === section)?.label;
  return <>
    <header className="admin-heading">
      <h1>{heading}</h1>
      {section === 'overview' && <p>See what’s happening in Shattana.</p>}
      {section === 'guests' && <p>Find guests and manage their access to the app.</p>}
      {section === 'venues' && <p>Manage the venues guests can choose in Quick Chat and meetup invitations.</p>}
    </header>
    {loadError && <div className="error admin-load-error" role="alert">{loadError}
      <button className="secondary" onClick={() => setRevision(current => current + 1)}>Retry</button>
    </div>}
    {error && <p className="error" role="alert">{error}</p>}
    {feedback && <p className="notice" role="status">{feedback}</p>}
    {!data && !loadError && <p role="status">Loading…</p>}
    {section === 'overview' && data?.stats && <div className="admin-metrics">
      {[
        { label: 'Active guests', value: data.stats.active, icon: Activity, note: 'Seen in the last 90 seconds' },
        { label: 'Open matches', value: data.stats.matches, icon: Heart, note: 'Saved conversations' },
        { label: 'Pending reports', value: data.stats.pending, icon: Flag, note: 'Awaiting review' },
      ].map(({ label, value, icon: Icon, note }) => <section key={label} className="admin-card admin-metric">
        <div className="admin-metric-icon"><Icon size={19} aria-hidden="true" /></div>
        <strong>{value}</strong><h2>{label === 'Pending reports' ? <Link href={sectionLink('reports')}>{label}</Link> : label}</h2><p>{note}</p>
      </section>)}
    </div>}
    {section === 'overview' && data?.stats && <p className="admin-data-note">Updates every 10 seconds while this tab is open and visible.</p>}
    {section === 'guests' && <>
      <form className="admin-card admin-form" onSubmit={event => {
        event.preventDefault();
        setError('');
        setQuery(search.trim());
        setRevision(current => current + 1);
      }}>
        <label htmlFor="admin-guest-search">Find by nickname</label>
        <div className="admin-form-row"><input id="admin-guest-search" value={search} onChange={event => setSearch(event.target.value)} maxLength={60} />
          <button className="secondary">Search</button></div>
      </form>
      {data?.guests && <section className="admin-card admin-list" aria-label="Guest results">
        {data.guests.length === 0 && <p>No guests found.</p>}
        {data.guests.map(guest => <div className="admin-row" key={guest.id}>
          <div><strong>{guest.nickname}</strong><small>{new Date(guest.lastSeen).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</small></div>
          <span className={`admin-state${guest.status === 'active' ? ' is-active' : ''}`}>{guestStatus[guest.status]}</span>
          {guest.status !== 'ended' && <button className="secondary" disabled={saving} onClick={() => {
            const suspended = guest.status !== 'suspended';
            if (!suspended || window.confirm('Suspend this guest and close their open conversations?')) {
              void change({ action: 'set-suspension', id: guest.id, suspended }, suspended ? 'Guest suspended.' : 'Guest access restored.');
            }
          }}>{guest.status === 'suspended' ? 'Reinstate' : 'Suspend'}</button>}
        </div>)}
      </section>}
    </>}
    {section === 'venues' && data && (data.venuesReady ? <>
      <form className="admin-card admin-form" onSubmit={saveVenue}>
        <label htmlFor="admin-venue-name">{editing === undefined ? 'New venue' : 'Edit venue name'}</label>
        <div className="admin-form-row">
          <input id="admin-venue-name" value={venueName} onChange={event => setVenueName(event.target.value)} maxLength={60} required />
          <button className="primary" disabled={saving || !venueName.trim()}>
            {editing === undefined && <Plus size={16} aria-hidden="true" />}{editing === undefined ? 'Add venue' : 'Save changes'}
          </button>
          {editing !== undefined && <button className="secondary" type="button" disabled={saving}
            onClick={() => { setVenueName(''); setEditing(undefined); }}>Cancel</button>}
        </div>
      </form>
      <section className="admin-card admin-list" aria-label="Venue list">
        {!data.venues?.length && <p>No venues yet.</p>}
        {data.venues?.map(venue => <div className="admin-row admin-venue-row" key={venue.id}>
          <strong>{venue.name}</strong>
          {removing === venue.id ? <div className="admin-row-actions">
            <button className="secondary" disabled={saving} onClick={() => setRemoving(undefined)}>Cancel</button>
            <button className="secondary" disabled={saving} onClick={async () => {
              if (await change({ action: 'delete-venue', id: venue.id }, 'Venue removed from the app’s pickers.')) {
                setRemoving(undefined);
                if (editing === venue.id) { setVenueName(''); setEditing(undefined); }
              }
            }}>Confirm removal</button>
          </div> : <div className="admin-row-actions">
            <button className="secondary" disabled={saving} onClick={() => {
              setEditing(venue.id); setVenueName(venue.name); setRemoving(undefined);
              document.getElementById('admin-venue-name')?.focus();
            }}>Edit<span className="visually-hidden"> {venue.name}</span></button>
            <button className="secondary" disabled={saving} onClick={() => setRemoving(venue.id)}>
              Delete<span className="visually-hidden"> {venue.name}</span>
            </button>
          </div>}
        </div>)}
      </section>
    </> : <p className="notice">Apply the venue schema to manage the app’s venue list.</p>)}
  </>;
}
