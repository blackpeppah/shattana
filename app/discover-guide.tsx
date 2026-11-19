import { Clock, Heart, Minus, Plus, Shuffle } from 'lucide-react';

const modes = [
  ['Quick Chat', 'Get paired at random for a one-on-one text chat. Same round or same spot? That’s your opener.', Shuffle],
  ['Across the Bar', 'See who fits what you’re both looking for. Tap Say Hi if you’re interested. If they say hi back, a private chat opens.', Heart],
  ['After Hours', 'Fridays at 9 PM, Bacolod time. Drop into the same Quick Chat queue.', Clock],
] as const;

const questions = [
  ['Do I need an account?', 'Join as a guest with a nickname and confirm you’re 18 or older.'],
  ['Can people see where I am?', 'Shattana doesn’t share your live location. Your favorite hangout can show on your Across the Bar card or come up as a Quick Chat icebreaker.'],
  ['Will my matches disappear if I refresh?', 'Your matches stay available in the same browser as long as your guest session cookie is still there.'],
  ['How do I block or report someone?', 'In a conversation, open Chat menu. You can block the guest or choose a report reason. Either action ends the chat.'],
];

export function DiscoverGuide() {
  return <div className="discover-guide">
    <section aria-labelledby="how-it-works">
      <h2 id="how-it-works">How Shattana works</h2>
      <dl className="guide-cards">
        {modes.map(([title, description, Icon]) => <div key={title} className="guide-card">
          <dt><span className="tile-icon" aria-hidden="true"><Icon size={21} /></span>{title}</dt>
          <dd>{description}</dd>
        </div>)}
      </dl>
    </section>
    <section className="guide-faq" aria-labelledby="discover-faq">
      <h2 id="discover-faq">FAQ</h2>
      <div className="faq-rows">
        {questions.map(([question, answer]) => <details key={question} className="faq-row">
          <summary>{question}<span className="faq-toggle" aria-hidden="true">
            <Plus size={17} /><Minus size={17} />
          </span></summary>
          <p>{answer}</p>
        </details>)}
      </div>
    </section>
  </div>;
}
