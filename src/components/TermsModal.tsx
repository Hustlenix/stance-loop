import { useState } from "react";
import { TERMS_URL, PRIVACY_URL, TERMS_VERSION } from "../terms";

/**
 * DRAFT legal consent gate (Task 2). Shown until the athlete accepts the
 * current TERMS_VERSION. Re-consent on version bump is enforced by App.tsx.
 * This document is a draft for review with counsel — see the note below.
 */
export default function TermsModal({ onAccept }: { onAccept: (version: string) => void }) {
  const [checked, setChecked] = useState(false);
  return (
    <div className="modal-backdrop terms-backdrop">
      <section className="session-modal terms-modal" data-testid="terms-modal">
        <span className="brand-mark">S</span>
        <span className="kicker">LEGAL</span>
        <h1>Terms &amp; Conditions</h1>
        <p className="terms-draft">
          DRAFT — prepared for review by [COMPANY NAME]&apos;s counsel. Shown here to establish the
          consent flow; do not ship as final until reviewed.
        </p>
        <div className="terms-body">
          <h3>1. Who we are &amp; acceptance</h3>
          <p>
            StanceLoop is provided by [COMPANY NAME], [REGISTERED ADDRESS] (&ldquo;we&rdquo;,
            &ldquo;us&rdquo;, &ldquo;StanceLoop&rdquo;). By checking the consent box you agree to these
            Terms and Conditions, which are a legal agreement between you and us. Keep a copy for your
            records. If you do not agree with anything in them, do not use the app.
          </p>
          <h3>2. What StanceLoop does</h3>
          <p>
            StanceLoop is movement-training software. It reads pose landmarks from your device&apos;s
            camera to score technique, give real-time form feedback, and keep a training log on your
            device. It is not a medical device, not a certified coach, and not a promise of any result.
          </p>
          <h3>3. Not medical advice</h3>
          <p>
            Everything in the app is educational. Nothing is a diagnosis, treatment, or prevention of
            injury or illness. Consult a qualified professional before starting any training program,
            especially if you are injured, have a medical condition, or have been inactive.
          </p>
          <h3>4. Assumption of risk &amp; safety</h3>
          <p>
            Movement training carries inherent risk, even with software feedback. You train at your own
            risk. Train in a clear, safe space; keep the camera pointing where you intend; and stop
            immediately if you feel pain, dizziness, or unsafe. StanceLoop cannot see your surroundings,
            judge whether a movement is safe for your body, or prevent injury.
          </p>
          <h3>5. Your data &amp; privacy</h3>
          <p>Privacy at a glance:</p>
          <ul>
            <li>No account. StanceLoop runs as a guest on your device; nothing is uploaded to a company server.</li>
            <li>Camera frames are processed on-device in the browser and are never transmitted. Raw video is never stored.</li>
            <li>The optional AI coach is off by default and only talks to a model you run yourself on your machine.</li>
            <li>Duel links share only what you choose — an invite, never your video.</li>
            <li>Analytics are off by default, and you can export or delete all local data at any time.</li>
          </ul>
          <p>The full privacy policy is published at {PRIVACY_URL}.</p>
          <h3>6. Acceptable use</h3>
          <p>
            Use the app for its intended purpose. You may not copy, resell, or scrape it, reverse-engineer
            it beyond what law permits, or use it to harass, defraud, or harm anyone, or to break the law.
            Shared duel links must be posted only with the consent of the athletes shown.
          </p>
          <h3>7. Intellectual property</h3>
          <p>
            StanceLoop, its design, and its content belong to us or our licensors. We grant you a
            personal, non-exclusive, non-transferable license to use the app for training. Your training
            data and results are yours.
          </p>
          <h3>8. Disclaimer of warranties</h3>
          <p>
            The app is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without express or
            implied warranties, including merchantability, fitness for a particular purpose, and
            non-infringement. We do not warrant that scores are accurate, that the app is error-free or
            uninterrupted, or that any particular outcome will result.
          </p>
          <h3>9. Limitation of liability</h3>
          <p>
            To the fullest extent permitted by law, we are not liable for indirect, incidental, special,
            consequential, or punitive damages, or for injury, loss, or damage arising from your
            training, even if we were told they were possible. Our total liability is limited to the
            amount you paid for the app (currently nothing) or, if you paid nothing, zero. Where a
            jurisdiction does not allow these limits, they apply as narrowly as the law requires.
          </p>
          <h3>10. Termination</h3>
          <p>
            You may stop using the app at any time and delete all of your data from preferences. We may
            suspend or terminate access if you breach these Terms.
          </p>
          <h3>11. Changes to these Terms</h3>
          <p>
            We may update these Terms from time to time. Each version carries a date, and you will be
            asked to consent again when it changes. Continuing to use the app after an update means you
            accept the new Terms.
          </p>
          <h3>12. Severability &amp; entire agreement</h3>
          <p>
            If any provision is found unenforceable, the rest of these Terms stay in effect. These Terms
            are the entire agreement about the app and are governed by the laws of
            [GOVERNING-LAW JURISDICTION], with disputes subject to the exclusive jurisdiction of its
            courts.
          </p>
          <h3>13. Contact</h3>
          <p>
            Questions about these Terms: [SUPPORT EMAIL]. A hosted copy is available at {TERMS_URL}.
          </p>
        </div>
        <label className="consent-check terms-consent">
          <input
            type="checkbox"
            data-testid="terms-checkbox"
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
          />
          <span>I have read the Terms &amp; Conditions and agree to be bound by them.</span>
        </label>
        <button
          className="primary-button"
          data-testid="terms-accept-button"
          disabled={!checked}
          onClick={() => onAccept(TERMS_VERSION)}
        >
          I agree <span>→</span>
        </button>
        <small>Raw camera footage is never stored by this app.</small>
      </section>
    </div>
  );
}