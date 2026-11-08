# Návrh e-mailu: PSPP Studio pro vývojáře GNU PSPP

Před odesláním doplň věci v `[hranatých závorkách]` a ověř adresy na pspp.org / gnu.org.
Repozitář musí být veřejný (stav jsem neověřil).

**Komu:** pspp-dev@gnu.org
**Kopie (volitelně):** maintainers@gnu.org (obecná otázka, jak se projekt může stát součástí GNU) nebo licensing@gnu.org (název, AI)
**Předmět:** Would you consider adopting PSPP Studio, a modern web front end for PSPP?

---

Hello PSPP developers,

My name is [Jiří Čepelka]. I am writing to ask a question rather than only to announce something: **would the PSPP project, or GNU more broadly, be willing to adopt and maintain a web front end I built for PSPP?** I do not have the time to maintain it on my own, and I would rather see it live on under the GNU Project than be left to rot in a personal repository.

**Why it exists.** It started at my university, where we wanted a user-friendly free alternative to SPSS. PSPP has an excellent core, but for students it was missing some analyses and its interface looked dated and was hard to find your way around. So I built **PSPP Studio**: the PSPP 2.1.3 engine compiled to WebAssembly, with a new interface that runs entirely in the browser (no installation, and no data ever leaves the user's computer). It is available in Czech and English, and PSPP's own messages are translated into Czech too.

- Live demo: https://pspp-studio-jiris-projects-be291b70.vercel.app
- Source code (GPL-3.0-or-later): https://github.com/jirkacepelka/PSPP

**What it adds on top of PSPP**

- dialogs for the common procedures that generate and show the PSPP syntax, next to a syntax editor
- a data grid with variable view, value labels and a variable inspector
- extra analyses that PSPP lacks, implemented in the browser on top of the engine (for example GLM with repeated measures and profile plots, line charts, and others)
- plain-language explanations of results, with effect sizes, aimed at beginners
- import and export of CSV, Excel, OpenDocument and JSON next to .sav/.zsav/.por, and export of the output to PDF, Word and HTML
- a guided first-run setup and a modern, accessible design (light and dark themes)

**About the engine.** My changes to the upstream sources are small, and are in `engine/pspp` (see `git log -- engine/pspp`): an optional `--without-cairo` build, an `html_table_to_string()` helper, and Emscripten portability fixes. A small C bridge (`engine/bridge`) exposes the library to JavaScript, and the build scripts are in `engine/scripts`. The compiled engine is committed so the app can be built without Emscripten.

**What I would like to know**

1. Would you be interested in taking this in, either as part of PSPP (for example as an official web interface) or as a separate GNU package? If not, I would be glad of any suggestion for where it could go, or which of its parts would be worth contributing separately (for example the Cairo-optional build).
2. If yes, what would be needed from my side: copyright assignment to the FSF, following the GNU coding standards (the front end is TypeScript/React, not C), or something else? I am happy to do the handover work.
3. Do you have any objection to the name "PSPP Studio"?

**Being open about how it was made.** Most of the front-end code, and the bridge and build scripts around the engine, were written with the help of an AI model (Anthropic's Claude Opus 5.5), under my direction and review. I understand that some free software projects have reservations about AI-assisted code, for licensing, provenance or other reasons, and I fully respect that. If this is a concern for you, I understand completely, and I will keep the project separate and not submit any of that code upstream unless you explicitly ask for it. I would rather you know it before deciding than find out later.

For clarity: today this is an independent project, not endorsed by the GNU Project or the FSF, and SPSS is a trademark of IBM (the application says so).

Thank you for PSPP, and for your time.

Best regards,
[Jiří Čepelka]
[university / affiliation, if you want to mention it]
[e-mail] · https://github.com/jirkacepelka

---

## Poznámky pro tebe

- **Realistické očekávání:** GNU projekty obvykle přijímá FSF až po přihlášení balíčku přes maintainers@gnu.org a podpisu převodu autorských práv; bývá to pomalé. Přirozenější první krok je často pspp-dev: oni sami rozhodnou, jestli to chtějí jako součást PSPP, jako samostatný balíček, nebo odkazem. Z paměti: ověř si postup na gnu.org/help/evaluation.html a gnu.org/software/devel.html.
- **Potenciální překážky, na které se připrav:** (1) JavaScript/TypeScript a React se v GNU často řeší jinak než C (FSF je citlivé na svobodný JavaScript – GPL licence a zdroj jsou ale v pořádku); (2) část kódu vznikla s pomocí AI, což může zpomalit nebo zablokovat převod autorských práv; (3) nasazení na Vercelu je komerční služba, FSF by pravděpodobně chtělo hostování mimo ni.
- **Převod autorských práv:** pokud na projektu pracovala univerzita (zadání, stipendium, pracovní poměr), může mít na kód práva ona. Před přislíbením převodu to ověř u školy.
- **Veřejný repozitář:** v GitHubu Settings → General → Danger Zone → Change visibility. Bez zdrojového kódu by distribuce aplikace s GPL jádrem nebyla v souladu s licencí.
- **Živá ukázka:** pokud je za Vercel Deployment Protection, vývojáři se do ní nedostanou. Ověř v anonymním okně.
- **Úpravy upstreamu:** výčet odpovídá `engine/README.md`; projdi si před odesláním `git log -- engine/pspp`.
- **Konference:** do `pspp-dev` se vyplatí přihlásit předem, aby ti došly odpovědi.
- **Tvrzení v e-mailu, která jsem nemohl ověřit:** „guided first-run setup", „accessible design" a seznam analýz odpovídají tomu, co jsme v projektu stavěli, ale zkontroluj, že ti sedí.
