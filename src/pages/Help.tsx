import type { ReactNode } from "react";
import { Link } from "../router";

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: "Is Margin free?",
    a: (
      <>
        Yes. By default Margin uses a free, open AI model, with a daily limit of drafts per teacher. If you want stronger
        feedback or more drafts, you can add your own Claude or Gemini key in <Link to="/settings">Settings</Link>; then that
        provider bills you directly, usually a few cents per essay.
      </>
    ),
  },
  {
    q: "Do my students need accounts?",
    a: "No. Students open the assignment link (or type its code at the student page), enter their name and paste or type their writing. They get a private link where feedback appears once you release it. Tell them to save that link.",
  },
  {
    q: "Can a student see the AI's feedback before I check it?",
    a: "Never. The AI writes a draft that only you can see. Students see feedback only after you click Release, and only the version you approved. You can edit and release again at any time.",
  },
  {
    q: "What happens to student data?",
    a: "Essays are stored in Margin's database. Before an essay is sent to an AI, Margin removes the student's name, email addresses, phone numbers and links. The AI never sees who wrote it. You can delete an assignment, with all its essays and feedback, from the bottom of its page.",
  },
  {
    q: "The AI gave a score I disagree with. What should I do?",
    a: "Change it. Your score is the one the student sees. Every change you make is recorded, and the AI accuracy page uses those records to show where the AI is reliable and where it isn't.",
  },
  {
    q: "What do the colours mean?",
    a: "Red is grammar, yellow is vocabulary, blue is organisation (how ideas are ordered and linked), purple is the task (whether the essay answers the question), and green marks a strength.",
  },
  {
    q: "What does the AI accuracy page show?",
    a: (
      <>
        How often the AI's suggested score matched yours exactly, how often it was within one band, and whether it tends to
        mark too high or too low on each criterion. "QWK" is a standard agreement score used in exam research: 1 means
        perfect agreement and 0 means no better than chance. It appears once there are at least five scores.
      </>
    ),
  },
  {
    q: "Drafting is slow or fails. Why?",
    a: "Each essay takes about 20 seconds. If the free daily limit is reached, Margin says so; try again tomorrow or add your own key. If an AI answer doesn't match the rubric, Margin asks the AI once more to fix it, then shows an error. Clicking Draft again usually works.",
  },
];

export function HelpPage() {
  return (
    <>
      <h1>Help</h1>
      <section className="card stack">
        <h2>Margin in four steps</h2>
        <ol className="plain-steps">
          <li><strong>Create an assignment.</strong> Write the task and choose your students' level.</li>
          <li><strong>Share the link.</strong> Students hand in their writing; no accounts needed.</li>
          <li><strong>Draft with AI.</strong> One click drafts scores and comments for every new essay.</li>
          <li><strong>Review and release.</strong> Keep, edit or remove each suggestion, then release it to the student.</li>
        </ol>
        <p className="muted small">
          Want to practise first? On the <Link to="/">Assignments</Link> page, choose <em>Try a sample class</em> (shown until you create your first assignment).
        </p>
      </section>

      <h2>Questions</h2>
      <div className="faq">
        {FAQ.map((f) => (
          <details key={f.q} className="card">
            <summary>{f.q}</summary>
            <div className="faq-a">{f.a}</div>
          </details>
        ))}
      </div>
    </>
  );
}
