'use client';

import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';
import { joinChallengeAction } from './options';

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: {
        sitekey: string;
        action: string;
        size: 'compact' | 'flexible';
        theme: 'light' | 'dark';
        callback: (token: string) => void;
        'expired-callback': () => void;
        'error-callback': () => void;
      }) => string;
      remove: (widgetId: string) => void;
    };
  }
}

export function JoinChallenge({ siteKey, theme, onToken }: { siteKey: string; theme: 'light' | 'dark'; onToken: (token: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [size, setSize] = useState<'compact' | 'flexible'>();

  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize(entry.contentRect.width < 300 ? 'compact' : 'flexible');
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const turnstile = window.turnstile;
    if (!ready || !size || !turnstile || !container.current) return;
    onToken('');
    const id = turnstile.render(container.current, {
      sitekey: siteKey,
      action: joinChallengeAction,
      size,
      theme,
      callback: token => { setFailed(false); onToken(token); },
      'expired-callback': () => onToken(''),
      'error-callback': () => { onToken(''); setFailed(true); },
    });
    return () => turnstile.remove(id);
  }, [ready, siteKey, size, theme, onToken]);

  return <>
    <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
      onReady={() => setReady(true)} onError={() => setFailed(true)} />
    <div className="join-challenge" ref={container} />
    {failed && <p role="status">Verification couldn’t load. Reload the page to try again.</p>}
  </>;
}
