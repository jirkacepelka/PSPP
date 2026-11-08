# Draft e-mail: PSPP Studio for the GNU PSPP developers

Fill in everything in `[square brackets]` and check the addresses on pspp.org / gnu.org before sending.
The repository is public (checked via the GitHub API).

**To:** pspp-dev@gnu.org
**Cc (optional):** maintainers@gnu.org (general question on how a project becomes part of GNU) or licensing@gnu.org (name, AI)
**Subject:** Would you consider adopting PSPP Studio, a modern web front end for PSPP?

---

Hello PSPP developers,

My name is [Jiří Čepelka]. First of all, thank you for PSPP.

**Why I built this.** It started at my university, where we wanted a user-friendly, free alternative to SPSS for students. PSPP has an excellent statistical core, but for people who are new to statistics it was missing some of the analyses they need, and its interface looked dated and was hard to find your way around. I wanted to see how far a modern, approachable interface on top of the PSPP engine could go.

**What came out of it: PSPP Studio.** It is the PSPP 2.1.3 engine compiled to WebAssembly, with a new interface that runs entirely in the browser (nothing to install, and no data ever leaves the user's computer). It is available in Czech and English, and PSPP's own messages are translated into Czech too.

- Live demo: https://pspp-studio.vercel.app
- Source code (GPL-3.0-or-later): https://github.com/jirkacepelka/PSPP
- Screenshots: attached (see the list at the end)

**My question.** I do not have the time to maintain this on my own. **Would the PSPP project, or GNU more broadly, be interested in adopting and maintaining it?** It does not have to stay a web application: the engine and the design are separable, and the interface could just as well be rewritten as a native desktop application (for example to replace the current PSPPIRE GTK interface), or reused in some other form. I care more about the idea of a friendly free SPSS alternative living on than about the technology it is built with.

**What it adds on top of PSPP**

- dialogs for the common procedures that generate and show the PSPP syntax, next to a syntax editor
- a data grid with variable view, value labels and a variable inspector
- extra analyses that PSPP lacks, implemented in the browser on top of the engine (for example GLM with repeated measures and profile plots, line charts, and others)
- plain-language explanations of results, with effect sizes, aimed at beginners
- import and export of CSV, Excel, OpenDocument and JSON next to .sav/.zsav/.por, and export of the output to PDF, Word and HTML
- a guided first-run setup and a modern, accessible design (light and dark themes)

**About the engine.** My changes to the upstream sources are small, and are in `engine/pspp` (see `git log -- engine/pspp`): an optional `--without-cairo` build, an `html_table_to_string()` helper, and Emscripten portability fixes. A small C bridge (`engine/bridge`) exposes the library to JavaScript, and the build scripts are in `engine/scripts`. The compiled engine is committed so the app can be built without Emscripten.

**What I would like to know**

1. Would you be interested in taking this in, as part of PSPP (as a web interface, or as a model for a new native interface) or as a separate GNU package? If not, I would be glad of any suggestion for where it could go, or which of its parts would be worth contributing separately (for example the Cairo-optional build, or the extra analyses together with their unit tests).
2. If yes, what would be needed from my side: copyright assignment to the FSF, following the GNU coding standards (the front end is TypeScript/React, not C), or something else? I am happy to do the handover work.
3. Do you have any objection to the name "PSPP Studio"?

**Being open about how it was made.** Most of the front-end code, and the bridge and build scripts around the engine, were written with the help of an AI model (Anthropic's Claude Opus 5.5), under my direction and review. I understand that some free software projects have reservations about AI-assisted code, for licensing, provenance or other reasons, and I fully respect that. If this is a concern for you, I understand completely, and I will keep the project separate and not submit any of that code upstream unless you explicitly ask for it. I would rather you know it before deciding than find out later.

For clarity: today this is an independent project, not endorsed by the GNU Project or the FSF, and SPSS is a trademark of IBM (the application says so).

Thank you for your time.

Best regards,
[Jiří Čepelka]
[university / affiliation, if you want to mention it]
[e-mail] · https://github.com/jirkacepelka

Attachments (screenshots, also in the repository under `web/docs/screenshots/`):
1. `welcome-setup.png` – first-run guide with a live preview of the workspace
2. `start.png` – start screen
3. `data.png` – data grid with value labels and variable inspector
4. `menu.png` – the Analyze menu
5. `output.png` – results with a plain-language explanation under the table
6. `settings.png` – settings with a live preview
7. `output-dark.png` – dark theme

---

## Notes before sending

- **Attachments:** the screenshots are in `web/docs/screenshots/` (1600 px, English). Mailing lists often limit message size, so a link to the repository folder is safer than attaching the images: https://github.com/jirkacepelka/PSPP/tree/main/web/docs/screenshots (works once `main` is the default branch).
- **Demo:** the public address https://pspp-studio.vercel.app answers without a login (checked). The address containing `-jiris-projects-` is behind Vercel login protection, so do not use it in the e-mail.
- **Native rewrite:** the e-mail offers it as a possibility, not a promise. Make sure you mean it. The extra analyses have unit tests (`web/src/ext/commands/*.test.ts`), which is why the e-mail mentions them.
- **Realistic expectations:** GNU packages are normally accepted through maintainers@gnu.org, after a copyright assignment to the FSF, and this can be slow. A natural first step is `pspp-dev`: they can decide whether they want it as part of PSPP, as a separate package, or just a link. This is from memory; check gnu.org/help/evaluation.html and gnu.org/software/devel.html.
- **Obstacles to expect:** (1) JavaScript/TypeScript and React are handled differently from C in GNU (the FSF cares about free JavaScript; a GPL licence with available source is fine); (2) part of the code was written with AI assistance, which may slow down or block the copyright assignment; (3) hosting on Vercel is a commercial service, so the FSF would probably want hosting elsewhere.
- **Copyright:** if the university was involved (an assignment, scholarship or employment), it may hold rights to the code. Check with the university before promising an assignment.
- **Upstream changes:** the list matches `engine/README.md`; check `git log -- engine/pspp` before sending.
- **Mailing list:** subscribe to `pspp-dev` first so replies reach you.
- **AI disclosure:** the paragraph about Opus 5.5 is deliberately careful. If you wrote some of the code by hand, add that; the text must match the facts. The changes to PSPP's own sources in `engine/pspp` were also made with AI help, so the offer to send them upstream is conditional.
- **Branch:** `main` now exists and is identical to the working branch; make it the default in GitHub Settings → Branches.
