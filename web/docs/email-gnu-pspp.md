# Návrh e-mailu: PSPP Studio pro vývojáře GNU PSPP

Před odesláním doplň věci v `[hranatých závorkách]` a ověř adresy na pspp.org / gnu.org.
Repozitář musí být veřejný (stav ke dni psaní jsem neověřil).

**Komu:** pspp-dev@gnu.org
**Kopie (volitelně):** licensing@gnu.org (jen pokud se chceš zeptat na název „PSPP Studio“)
**Předmět:** PSPP Studio – a browser-based front end for PSPP 2.1.3 (WebAssembly, Czech and English)

---

Hello PSPP developers,

My name is [Jiří Čepelka] and I would like to let you know about a project built on top of GNU PSPP, in case it is useful or interesting to you.

**PSPP Studio** is a web user interface for PSPP. The PSPP 2.1.3 engine is compiled to WebAssembly and runs entirely in the browser, so no data ever leaves the user's computer and nothing needs to be installed. The interface is available in Czech and English, and PSPP's own messages and output are translated into Czech as well.

- Live demo: https://pspp-studio-jiris-projects-be291b70.vercel.app
- Source code (GPL-3.0-or-later): https://github.com/jirkacepelka/PSPP

What it adds on top of PSPP:

- dialogs for the common procedures (descriptives, t-tests, ANOVA, regression, correlations, charts and more) that generate and show the PSPP syntax, alongside a syntax editor
- a data grid with variable view, value labels and a variable inspector
- plain-language explanations of results (with effect sizes) for beginners
- import and export of CSV/TSV, Excel (.xlsx), OpenDocument (.ods) and JSON next to the native .sav/.zsav/.por formats
- output export to PDF, Word (.docx) and HTML, with charts and tables
- a few extra analyses implemented in the browser on top of the engine (for example GLM profile plots and line charts)

About the engine: the changes to the upstream sources are small and published in the repository under `engine/pspp` (see `git log -- engine/pspp`): an optional `--without-cairo` build, an `html_table_to_string()` helper, and Emscripten portability fixes. A small C bridge (`engine/bridge`) exposes the library to JavaScript, and the build scripts are in `engine/scripts`. I would be glad to submit any of these changes upstream if you think they are worth having, for example the Cairo-optional build.

I should also say that this is an independent project and is not endorsed by the GNU Project or the FSF. The name "PSPP Studio" contains the PSPP name, so please tell me if you would prefer that I use a different one. SPSS is a trademark of IBM, and the application states this.

I would welcome any feedback, and I would be happy if you wanted to mention the project or link to it. Thank you for PSPP.

Best regards,
[Jiří Čepelka]
[e-mail] · [https://github.com/jirkacepelka]

---

## Poznámky pro tebe

- **Veřejný repozitář:** v GitHubu otevři Settings → General → Danger Zone → Change visibility, pokud ještě není veřejný. Bez zdrojového kódu by distribuce aplikace s GPL jádrem nebyla v souladu s licencí.
- **Živá ukázka:** Vercel adresa je z konfigurace projektu. Pokud nasazení chrání přihlášení (Vercel Deployment Protection), vývojáři se na ukázku nedostanou. Zkontroluj to v anonymním okně, případně nastav vlastní doménu.
- **Úpravy upstreamu:** tvrzení o změnách v e-mailu odpovídá `engine/README.md`. Před odesláním si ještě pro jistotu projdi `git log -- engine/pspp`, aby seznam seděl.
- **Konference:** pro zaslání do `pspp-dev` se může vyplatit přihlásit se předem na gnu.org/software/pspp, aby ti došly odpovědi (zprávy od nečlenů mohou čekat na schválení).
- **Tón:** e-mail záměrně nic nežádá; je to informace a nabídka. FSF ani GNU projekt neschvalují odvozené projekty.
