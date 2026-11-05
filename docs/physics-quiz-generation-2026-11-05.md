# Physics quiz generation check — 5 November 2026

## Live reproduction

Signed in to the tutor workspace using the account supplied for this check.
Selected Physics, 10 questions, Intermediate difficulty and Mixed question types.
Topic:

> Grade 12 Physical Sciences: Newton's laws, force diagrams and vertical projectile motion. Include numerical calculations with SI units and clear worked explanations.

The live site returned:

> Could not generate quiz: Generated quiz failed validation: Question 8: a short-answer key can contain a maximum of two words

The rejected answer itself was not exposed in the UI. Source inspection shows
that short-answer validation splits punctuation into separate words: a value
such as `9.8 m/s²` exceeds the limit despite looking like two space-separated
items. The short-answer marker also discards punctuation/signs and permits
spelling variations, making it unsuitable for numerical physics answers.

With the same topic, count and difficulty, changing Question types to Multiple
choice successfully generated all 10 questions. The student preview displayed
10 questions and 17 marks. No quiz was saved or published during this check.
The browser was left on the successful preview.

Evidence: [Live physics preview](../output/physics-quiz-check/live-physics-preview.jpg).

## Local changes

- Tell the model to use short answers only for one- or two-word concepts/names,
  including similar practice questions. Calculations use MCQ or long answers;
  a short-only request stays short-only and asks conceptual questions.
- Add physics guidance for supplied data, assumptions, units, sign conventions
  and worked explanations.
- Reject generated numerical/formula short keys before they reach the word
  marker. Existing manually authored quizzes and marking rules are unchanged.
- Validate four distinct options and an exact answer key for Fun Quiz similar
  MCQs as well as the main MCQs.
- Retry invalid generated content once, on the same provider, with the original
  constraints and validation feedback. Provider failures are not retried and
  no provider fallback is introduced. Both failed attempts still return an
  error; partial output is never returned or published.
- Update generation status text to account for validation and the possible retry.

Validation: all 13 AI generation backend tests passed, using mocked provider
responses and a disposable database. The existing quiz-builder browser test
also passed. The live successful MCQ check used the currently deployed code,
not this local patch. The local fix has not been pushed or deployed.

One content-repair retry can increase latency and provider usage. Model prompts
and structural validation do not guarantee scientific correctness; tutors must
still review generated questions and answers.
