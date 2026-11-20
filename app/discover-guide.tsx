import { ChevronDown, Heart, MapPin, ShieldCheck, Shuffle } from 'lucide-react';
import type { ReactNode } from 'react';

const modes = [
  ['Quick Chat', 'Get paired at random for a private text chat.', Shuffle],
  ['Across the Bar', 'Browse profiles and open a private text chat when both people tap Say Hi.', Heart],
] as const;

const notes = [
  ['Bacolod after dark', 'Petals, Lunar, or wherever you end up. Pick your go-to spot and use it to break the ice.', MapPin],
  ['Active moderation', 'Real people review reports and can suspend guests who break the rules. If a chat feels off, open Chat menu to block or report.', ShieldCheck],
] as const;

const questions = [
  ['Do I need an account?', 'Join as a guest with a nickname and confirm you’re 18 or older.'],
  ['Can people see where I am?', 'Shattana doesn’t share your live location. Your favorite hangout can show on your Across the Bar card or come up as a Quick Chat icebreaker.'],
  ['Will my matches disappear if I refresh?', 'Open Matches to reopen saved conversations in the same browser while your guest session cookie is still there.'],
  ['How do I block or report someone?', 'In a conversation, open Chat menu. You can block the guest or choose a report reason. Either action ends the chat.'],
];

export function DiscoverGuide({ afterFaq }: { afterFaq?: ReactNode }) {
  return <div className="discover-guide">
    <section aria-labelledby="how-it-works">
      <h2 id="how-it-works">How Shattana works</h2>
      <dl className="guide-cards">
        {modes.map(([title, description, Icon]) => <div key={title} className="guide-card">
          <dt><span className="tile-icon" aria-hidden="true"><Icon size={21} /></span>{title}</dt>
          <dd>{description}</dd>
        </div>)}
      </dl>
      <ul className="guide-notes">
        {notes.map(([title, description, Icon]) => <li key={title} className="guide-note">
          <span className="guide-note-icon" aria-hidden="true"><Icon size={19} /></span>
          <div><h3>{title}</h3><p>{description}</p></div>
        </li>)}
      </ul>
    </section>
    <div className="guide-faq">
      <section aria-labelledby="discover-faq">
        <h2 id="discover-faq">FAQ</h2>
        <div className="faq-rows">
          {questions.map(([question, answer]) => <details key={question} className="faq-row">
            <summary>{question}<ChevronDown className="faq-toggle" size={17} aria-hidden="true" /></summary>
            <p>{answer}</p>
          </details>)}
        </div>
      </section>
      {afterFaq}
    </div>
  </div>;
}
