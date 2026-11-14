# Glossary

**Action**
One of the AI requests a reader makes on selected text: Translate, Define, Explain, Simplify or Ask.

**Thread**
One Action on one selection, with its follow-up questions and answers.

**Translation language**
The language Translate turns the selected text into, and the language a Vocab meaning is written in.
_Avoid_: explanation language, target language

**Answer language**
The language Define, Explain, Simplify and Ask answer in. English unless the reader chooses otherwise.
_Avoid_: explanation language, UI language

**Default language**
The Translation language or Answer language chosen in Settings, which every Book uses unless it has its own.

**Book language override**
A Translation language or Answer language chosen for one Book, replacing the Default language for that Book only.

**Vocab entry**
A saved word or phrase from a Book, with the sentence it came from and a one-line meaning.

## Rules

- A Thread keeps the languages it started with; changing a setting affects only new Threads.
- A Vocab entry keeps the meaning it was saved with; changing the Translation language affects only new entries.
- A Book without a Book language override follows the current Default language, even after the default changes.
- A question or follow-up the reader types is answered in the language it is written in; the Answer language applies only when the reader has typed nothing.
- In a Translate Thread, only the translation is in the Translation language; its note and follow-ups are in the Answer language.
