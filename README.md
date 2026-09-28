# PASS IT ON — Book Bank prototype

**Support the child without hiding the shortage.**

A single-file, offline HTML prototype of a school textbook-continuity service. Children pass on last year's current-edition textbooks to a school Book Bank. A child still waiting for their official government textbook can borrow one of these copies right away. Meanwhile the school keeps reporting the **full official shortage** upward, calculated as students entitled minus government books received.

**Live demo:** https://nikhilkhandelwal07.github.io/pass-it-on/

| File | What it is |
|---|---|
| `pass-it-on.html` | The prototype: School and CRC/Block views; English, Hindi, Odia and Marathi. Works offline when double-clicked. |
| `phone-demo.html` | The same prototype inside a phone frame, for showing the mobile layout on a projector. It is self-contained. |
| `index.html` | Landing page linking to both. |

## What a school can do

- **Classes and subjects:** each one, such as Class 6 Science or Class 7 Maths, is its own register. It has its own official figures, waiting list and Book Bank shelf, and copy codes follow the class and subject (`BB-7-MAT-001`). Use **+ Add class / subject** to enter students entitled and government books already received.
- **Waiting list:** use **Add or remove children** to list the children who have not received their government book. Paste names or roll numbers, one per line, and choose the "waiting since" date; days waiting then count up by themselves. The list can never name more children than there are books pending.
- **Four actions:** Add a Book (current edition only), Give a Book (longest wait first), Book Returned, and Govt Books Arrived (tick who received a book).
- **CRC / Block view and the monthly statement:** one row per class and subject, built only from enrolment and official receipts.

## The one rule the system protects

A temporary Book Bank copy is school-local learning support. It **never** reduces the official government shortage, and the CRC/Block view never sees Book Bank stock, borrowers, donors or copy numbers. Only a government book that actually arrives reduces the official number.

Demo check: 60 entitled and 50 received, so 10 pending, with 7 Book Bank copies. Lending Asha a temporary copy leaves **10 pending** (unchanged), 6 copies available, and 9 children without any copy. After 10 government books arrive, pending falls to **0**.

## Maintaining

- Tech: HTML, CSS and vanilla JavaScript only. No dependencies, no server; state is kept in `localStorage`.
- To add a language, add a line to `LANGS` and a matching block in `I18N` inside `pass-it-on.html`. Any text left untranslated falls back to English.
- After editing `pass-it-on.html`, rebuild the phone demo:
  ```
  python tools/build-phone-demo.py pass-it-on.html tools/phone-demo.src.html phone-demo.html
  ```
- Automated checks run in headless Chrome with Node 22+ and no npm packages. Pass the absolute path to `pass-it-on.html` and an output folder:
  ```
  node tools/pass-it-on.test.mjs "C:/full/path/to/pass-it-on.html" test-output
  ```
  The script expects Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe`.

Prototype for Systems and Design Thinking, SPJIMR. All names and schools are fictional.
