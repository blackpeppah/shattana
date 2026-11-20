'use client';

import { useRef, useState, type PointerEvent } from 'react';
import { Reply } from 'lucide-react';

export type Message = {
  id: string;
  mine: boolean;
  body: string;
  reply?: { id: string; mine: boolean | null; body: string | null } | null;
};

export const unavailableReply = 'Original message unavailable';

export function MessageBubbles({ messages, liveFrom, nickname, onReply }: {
  messages: Message[];
  liveFrom?: string;
  nickname: string;
  onReply?: (message: Message) => void;
}) {
  const [history] = useState(() => new Set(messages.map(message => message.id)));
  return messages.map(message => <MessageBubble key={message.id} message={message} nickname={nickname} onReply={onReply}
    animate={!history.has(message.id) && (!liveFrom || BigInt(message.id) >= BigInt(liveFrom))} />);
}

function MessageBubble({ message, nickname, animate, onReply }: {
  message: Message;
  nickname: string;
  animate: boolean;
  onReply?: (message: Message) => void;
}) {
  const swipe = useRef<{ pointer: number; x: number; y: number; axis?: 'x' | 'y' }>(undefined);
  const { reply } = message;

  function move(event: PointerEvent<HTMLDivElement>) {
    const start = swipe.current;
    if (!start || start.pointer !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.axis && Math.max(Math.abs(dx), Math.abs(dy)) >= 9) {
      start.axis = Math.abs(dx) > Math.abs(dy) * 1.4 ? 'x' : 'y';
    }
    if (start.axis === 'x') event.currentTarget.style.setProperty('--reply-drag', `${Math.sign(dx) * Math.min(25, Math.abs(dx) / 2)}px`);
  }

  function finish(event: PointerEvent<HTMLDivElement>, canceled = false) {
    const start = swipe.current;
    if (!start || start.pointer !== event.pointerId) return;
    swipe.current = undefined;
    event.currentTarget.style.removeProperty('--reply-drag');
    const dx = Math.abs(event.clientX - start.x);
    const dy = Math.abs(event.clientY - start.y);
    if (!canceled && start.axis !== 'y' && dx >= 52 && dx > dy * 1.4) onReply?.(message);
  }

  return <div data-message-id={message.id} data-incoming-id={message.mine ? undefined : message.id}
    className={`message-row${message.mine ? ' message-mine' : ''}${animate ? ' motion-rise' : ''}`}>
    <div className={`bubble${message.mine ? ' mine' : ''}${onReply ? ' swipe-reply' : ''}`}
      onPointerDown={event => {
        if (!onReply || event.pointerType !== 'touch' || !event.isPrimary) return;
        swipe.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)}
      onLostPointerCapture={event => finish(event, true)}>
      {reply && <blockquote className="message-quote">
        {reply.body !== null && <strong>{reply.mine ? 'You' : nickname}</strong>}
        <span>{reply.body ?? unavailableReply}</span>
      </blockquote>}
      <p>{message.body}</p>
    </div>
    {onReply && <button className="reply-action" type="button" onClick={() => onReply(message)}>
      <Reply size={15} aria-hidden="true" /> Reply
    </button>}
  </div>;
}
