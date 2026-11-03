# PSPP Studio

Moderní webové rozhraní pro [GNU PSPP](https://www.gnu.org/software/pspp/) –
statistickou analýzu dat (alternativu k SPSS) přímo v prohlížeči.
Originální výpočetní jádro PSPP běží jako WebAssembly u vás v počítači:
data nikam neodcházejí, nic se neinstaluje.

A modern web interface for GNU PSPP. The original PSPP engine runs as
WebAssembly in your browser — no server, your data never leaves your machine.

| | |
|---|---|
| `engine/` | Fork of GNU PSPP 2.1.3 + WebAssembly bridge ([engine/README.md](engine/README.md)) |
| `web/` | React front end ([web/README.md](web/README.md)) |
| `vercel.json` | Static deployment config |

## License

GNU General Public License v3.0 or later, like GNU PSPP itself.
PSPP Studio is an independent fork and is not affiliated with the GNU Project.
