// PSPP Studio - JavaScript wrapper around the PSPP WebAssembly bridge.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Framework-agnostic: used by the web front end's Web Worker and by the Node
// smoke tests.  Implements the EngineApi contract (see web/src/engine/types.ts).

const MEASURES = { unknown: 0, nominal: 1, ordinal: 2, scale: 3 };
const ALIGNS = { left: 0, right: 1, center: 2 };
const ROLES = { input: 0, target: 1, both: 2, none: 3, partition: 4, split: 5 };

const WORKDIR = '/work';

/** Quotes S as a PSPP string literal. */
export function psppString(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function extOf(name) {
  const m = /\.([^.]+)$/.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

/**
 * @param {(opts: object) => Promise<any>} createModule  Emscripten factory
 * @param {object} [moduleOpts]  e.g. { locateFile }
 */
export async function createEngine(createModule, moduleOpts = {}) {
  const stderr = [];
  const M = await createModule({
    print: () => {},
    printErr: (s) => stderr.push(s),
    ...moduleOpts,
  });

  const c = (name, ret, args) => M.cwrap(name, ret, args);
  const api = {
    init: c('pspp_init', 'number', []),
    version: c('pspp_version', 'string', []),
    run: c('pspp_run', 'string', ['string']),
    setLanguage: c('pspp_set_language', 'number', ['string']),
    dsBegin: c('ds_begin', null, []),
    dsAddVar: c('ds_add_var', 'number', ['string', 'number']),
    dsVarSetLabel: c('ds_var_set_label', null, ['number', 'string']),
    dsVarSetFormats: c('ds_var_set_formats', 'number',
      ['number', 'string', 'number', 'number', 'string', 'number', 'number']),
    dsVarAddLabelNum: c('ds_var_add_label_num', null, ['number', 'number', 'string']),
    dsVarAddLabelStr: c('ds_var_add_label_str', null, ['number', 'string', 'string']),
    dsVarSetMissingNum: c('ds_var_set_missing_num', null,
      ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']),
    dsVarSetMissingStr: c('ds_var_set_missing_str', null,
      ['number', 'number', 'string', 'string', 'string']),
    dsVarSetMisc: c('ds_var_set_misc', null, ['number', 'number', 'number', 'number', 'number']),
    dsSetFileLabel: c('ds_set_file_label', null, ['string']),
    dsAddDocument: c('ds_add_document', null, ['string']),
    dsSetWeight: c('ds_set_weight', null, ['string']),
    dsSetFilter: c('ds_set_filter', null, ['string']),
    dsSetSplit: c('ds_set_split', null, ['string', 'number']),
    dsSetCaseCount: c('ds_set_case_count', null, ['number']),
    dsNumColumn: c('ds_num_column', 'number', ['number']),
    dsSetStr: c('ds_set_str', null, ['number', 'number', 'string']),
    dsCommit: c('ds_commit', 'number', []),
    exBegin: c('ex_begin', 'string', []),
    exNumColumn: c('ex_num_column', 'number', ['number']),
    exStrColumn: c('ex_str_column', 'string', ['number']),
    exEnd: c('ex_end', null, []),
  };
  api.init();
  try { M.FS.mkdir(WORKDIR); } catch { /* exists */ }

  /** Loads a Dataset object into the engine as the active dataset. */
  function setDataset(ds) {
    api.dsBegin();
    const vars = ds.variables || [];
    const idx = vars.map((v) => api.dsAddVar(v.name, v.type === 'string' ? Math.max(1, v.width || 8) : 0));
    vars.forEach((v, i) => {
      const k = idx[i];
      if (k < 0) return;
      if (v.label) api.dsVarSetLabel(k, v.label);
      if (v.print && v.write) {
        api.dsVarSetFormats(k, v.print.type, v.print.w, v.print.d, v.write.type, v.write.w, v.write.d);
      }
      for (const vl of v.valueLabels || []) {
        if (v.type === 'string') api.dsVarAddLabelStr(k, String(vl.value), vl.label);
        else if (typeof vl.value === 'number') api.dsVarAddLabelNum(k, vl.value, vl.label);
      }
      const mv = v.missing || { values: [] };
      if (v.type === 'string') {
        const s = (mv.values || []).map(String);
        if (s.length) api.dsVarSetMissingStr(k, s.length, s[0] ?? '', s[1] ?? '', s[2] ?? '');
      } else {
        const n = (mv.values || []).filter((x) => typeof x === 'number');
        if (n.length || mv.range) {
          api.dsVarSetMissingNum(k, n.length, n[0] ?? 0, n[1] ?? 0, n[2] ?? 0,
            mv.range ? 1 : 0, mv.range?.low ?? 0, mv.range?.high ?? 0);
        }
      }
      api.dsVarSetMisc(k, MEASURES[v.measure] ?? 0, ALIGNS[v.align] ?? 1,
        ROLES[v.role] ?? 0, v.columns || 0);
    });
    if (ds.fileLabel) api.dsSetFileLabel(ds.fileLabel);
    for (const d of ds.documents || []) api.dsAddDocument(d);

    const nCases = Math.max(0, ...(ds.columns || []).map((col) => col?.length || 0));
    api.dsSetCaseCount(nCases);
    vars.forEach((v, i) => {
      const k = idx[i];
      if (k < 0) return;
      const col = ds.columns?.[i] || [];
      if (v.type === 'string') {
        for (let r = 0; r < nCases; r++) {
          const x = col[r];
          if (x != null && x !== '') api.dsSetStr(k, r, String(x));
        }
      } else {
        const ptr = api.dsNumColumn(k);
        const heap = new Float64Array(M.HEAPF64.buffer, ptr, nCases);
        for (let r = 0; r < nCases; r++) {
          const x = col[r];
          heap[r] = typeof x === 'number' && Number.isFinite(x) ? x : NaN;
        }
      }
    });
    if (ds.weight) api.dsSetWeight(ds.weight);
    if (ds.filter) api.dsSetFilter(ds.filter);
    if (ds.split?.length) api.dsSetSplit(ds.split.join(' '), ds.splitType === 'layered' ? 1 : 0);
    api.dsCommit();
  }

  /** Reads the active dataset back as a Dataset object. */
  function getDataset(name) {
    const meta = JSON.parse(api.exBegin());
    const n = meta.cases;
    const columns = meta.variables.map((v, i) => {
      if (v.type === 'string') return JSON.parse(api.exStrColumn(i));
      const ptr = api.exNumColumn(i);
      const out = new Array(n);
      if (ptr) {
        const heap = new Float64Array(M.HEAPF64.buffer, ptr, n);
        for (let r = 0; r < n; r++) out[r] = Number.isNaN(heap[r]) ? null : heap[r];
      } else out.fill(null);
      return out;
    });
    api.exEnd();
    return {
      name: name || meta.name || '',
      variables: meta.variables,
      columns,
      weight: meta.weight ?? null,
      filter: meta.filter ?? null,
      split: meta.split,
      splitType: meta.splitType,
      documents: meta.documents,
      fileLabel: meta.fileLabel,
    };
  }

  function runRaw(syntax) {
    stderr.length = 0;
    const r = JSON.parse(api.run(syntax));
    return r;
  }

  let currentName = '';
  let loadedDataset = null; // identity of the Dataset object last sent

  const engine = {
    async init() {
      return { version: api.version() };
    },

    async run(syntax, dataset) {
      if (dataset && dataset !== loadedDataset) {
        setDataset(dataset);
        currentName = dataset.name;
      }
      const r = runRaw(syntax);
      const ds = getDataset(currentName);
      // The engine holds exactly this data now; if the caller passes this
      // same object back unchanged, it need not be reloaded.
      loadedDataset = ds;
      return { items: r.items, ok: r.ok, dataset: ds };
    },

    async open(file) {
      const ext = extOf(file.name);
      const path = `${WORKDIR}/${file.name.replace(/[/\\]/g, '_')}`;
      M.FS.writeFile(path, file.bytes);
      const q = psppString(path);
      let syntax;
      switch (ext) {
        case 'sps':
        case 'pspp':
        case 'syntax':
          return { syntax: new TextDecoder().decode(file.bytes) };
        case 'por':
          syntax = `IMPORT FILE=${q}.`;
          break;
        case 'ods':
          syntax = `GET DATA /TYPE=ODS /FILE=${q} /READNAMES=ON.`;
          break;
        case 'gnumeric':
          syntax = `GET DATA /TYPE=GNM /FILE=${q} /READNAMES=ON.`;
          break;
        default:
          syntax = `GET FILE=${q}.`;
      }
      const r = runRaw(syntax);
      try { M.FS.unlink(path); } catch { /* ignore */ }
      if (!r.ok) return { items: r.items };
      currentName = file.name.replace(/\.[^.]+$/, '');
      const dataset = getDataset(currentName);
      loadedDataset = dataset;
      return { dataset, items: r.items };
    },

    async save(dataset, format) {
      if (dataset) {
        setDataset(dataset);
        loadedDataset = dataset;
      }
      const path = `${WORKDIR}/out.${format}`;
      const q = psppString(path);
      const syntax = {
        sav: `SAVE OUTFILE=${q}.`,
        zsav: `SAVE OUTFILE=${q} /ZCOMPRESSED.`,
        por: `EXPORT OUTFILE=${q}.`,
        csv: `SAVE TRANSLATE /OUTFILE=${q} /TYPE=CSV /FIELDNAMES /CELLS=VALUES /REPLACE.`,
      }[format];
      if (!syntax) throw new Error(`Unsupported format: ${format}`);
      const r = runRaw(syntax);
      if (!r.ok) {
        const msg = r.items.filter((i) => i.kind === 'message').map((i) => i.text).join('\n');
        throw new Error(msg || 'Save failed');
      }
      const bytes = M.FS.readFile(path);
      M.FS.unlink(path);
      return bytes;
    },

    /**
     * Switches the language of PSPP's output and messages.  MO is the
     * compiled message catalog (pspp.mo) for LANG, or null for English.
     */
    async setLanguage(lang, mo) {
      if (mo) {
        const dir = `/pspp/share/locale/${lang}/LC_MESSAGES`;
        M.FS.mkdirTree(dir);
        M.FS.writeFile(`${dir}/pspp.mo`, mo);
      }
      return api.setLanguage(lang) === 1;
    },

    /** Runs syntax without touching the dataset (internal/testing). */
    runRaw,
    setDataset,
    getDataset,
    FS: M.FS,
  };
  return engine;
}
