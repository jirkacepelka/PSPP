/* PSPP Studio - WebAssembly bridge to the PSPP engine.
   Copyright (C) 2026 PSPP Studio contributors.

   This program is free software: you can redistribute it and/or modify
   it under the terms of the GNU General Public License as published by
   the Free Software Foundation, either version 3 of the License, or
   (at your option) any later version.

   This program is distributed in the hope that it will be useful,
   but WITHOUT ANY WARRANTY; without even the implied warranty of
   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
   GNU General Public License for more details.

   You should have received a copy of the GNU General Public License
   along with this program.  If not, see <http://www.gnu.org/licenses/>. */

/* A small C API over libpspp, exported to JavaScript.

   The engine keeps one session with one active dataset across calls, the way
   the PSPPIRE GUI does.  JavaScript can:

     - Replace the active dataset, by describing its dictionary with the
       ds_* functions and then filling in column data (ds_commit).

     - Run syntax (pspp_run), which returns output as JSON: a tree of items,
       with tables already rendered to HTML by PSPP's own HTML renderer.

     - Read the active dataset back (ex_* functions), after syntax that may
       have transformed it.

   Files are read and written through Emscripten's virtual file system with
   ordinary PSPP syntax (GET, SAVE, IMPORT, EXPORT, GET DATA, ...). */

#include <config.h>

#include <float.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "data/case.h"
#include "data/casereader.h"
#include "data/casewriter.h"
#include "data/dataset.h"
#include "data/dictionary.h"
#include "data/file-handle-def.h"
#include "data/format.h"
#include "data/missing-values.h"
#include "data/session.h"
#include "data/settings.h"
#include "data/value-labels.h"
#include "data/value.h"
#include "data/variable.h"
#include "gsl/gsl_errno.h"
#include "language/command.h"
#include "language/lexer/lexer.h"
#include "libpspp/i18n.h"
#include "libpspp/message.h"
#include "libpspp/str.h"
#include "libpspp/string-array.h"
#include "libpspp/version.h"
#include "math/random.h"
#include "output/chart.h"
#include "output/driver-provider.h"
#include "output/driver.h"
#include "output/html.h"
#include "output/output-item.h"
#include "output/pivot-table.h"

#include "gl/minmax.h"
#include "gl/xalloc.h"

#include "chart-json.h"
#include "json.h"

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#define EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define EXPORT
#endif

static struct session *the_session;

/* ------------------------------------------------------------------ */
/* Output collection.                                                  */
/* ------------------------------------------------------------------ */

/* An output driver that serializes every submitted item to JSON. */
struct json_driver
  {
    struct output_driver driver;
  };

static struct string out_json = DS_EMPTY_INITIALIZER;
static bool out_first = true;
static int out_id = 0;
static int out_n_errors = 0;

static void json_item (struct string *, const struct output_item *);

static void
json_item_children (struct string *s, const struct output_item *item)
{
  ds_put_cstr (s, "[");
  for (size_t i = 0; i < item->group.n_children; i++)
    {
      if (i)
        ds_put_byte (s, ',');
      json_item (s, item->group.children[i]);
    }
  ds_put_cstr (s, "]");
}

static void
json_item (struct string *s, const struct output_item *item)
{
  ds_put_format (s, "{\"id\":\"o%d\"", ++out_id);
  json_put_key_str (s, "title", output_item_get_label (item));
  if (item->command_name)
    json_put_key_str (s, "command", item->command_name);
  if (!item->show)
    ds_put_cstr (s, ",\"hidden\":true");

  switch (item->type)
    {
    case OUTPUT_ITEM_GROUP:
      ds_put_cstr (s, ",\"kind\":\"group\",\"children\":");
      json_item_children (s, item);
      break;

    case OUTPUT_ITEM_TABLE:
      {
        ds_put_cstr (s, ",\"kind\":\"table\"");
        char *html = html_table_to_string (item, false, true);
        json_put_key_str (s, "html", html ? html : "");
        free (html);
      }
      break;

    case OUTPUT_ITEM_TEXT:
      {
        static const char *const subtypes[] = {
          [TEXT_ITEM_PAGE_TITLE] = "page-title",
          [TEXT_ITEM_TITLE] = "title",
          [TEXT_ITEM_SYNTAX] = "syntax",
          [TEXT_ITEM_LOG] = "log",
        };
        ds_put_cstr (s, ",\"kind\":\"text\"");
        json_put_key_str (s, "subtype", subtypes[item->text.subtype]);
        char *text = text_item_get_plain_text (item);
        json_put_key_str (s, "text", text);
        free (text);
      }
      break;

    case OUTPUT_ITEM_MESSAGE:
      {
        const struct msg *m = item->message;
        static const char *const severities[] = {
          [MSG_S_ERROR] = "error",
          [MSG_S_WARNING] = "warning",
          [MSG_S_NOTE] = "note",
        };
        ds_put_cstr (s, ",\"kind\":\"message\"");
        json_put_key_str (s, "severity", severities[m->severity]);
        json_put_key_str (s, "text", m->text);
        if (m->location)
          {
            if (m->location->file_name)
              json_put_key_str (s, "file", m->location->file_name);
            if (m->location->start.line > 0)
              ds_put_format (s, ",\"line\":%d,\"endLine\":%d",
                             m->location->start.line,
                             m->location->end.line);
            if (m->location->start.column > 0)
              ds_put_format (s, ",\"column\":%d,\"endColumn\":%d",
                             m->location->start.column,
                             m->location->end.column);
          }
        char *full = msg_to_string (m);
        json_put_key_str (s, "full", full);
        free (full);
        if (m->severity == MSG_S_ERROR)
          out_n_errors++;
      }
      break;

    case OUTPUT_ITEM_CHART:
      ds_put_cstr (s, ",\"kind\":\"chart\",\"chart\":");
      chart_to_json (s, item->chart);
      break;

    case OUTPUT_ITEM_IMAGE:
      ds_put_cstr (s, ",\"kind\":\"image\"");
      break;

    case OUTPUT_ITEM_PAGE_BREAK:
      ds_put_cstr (s, ",\"kind\":\"page-break\"");
      break;
    }
  ds_put_byte (s, '}');
}

static void
json_driver_submit (struct output_driver *driver UNUSED,
                    const struct output_item *item)
{
  if (!out_first)
    ds_put_byte (&out_json, ',');
  out_first = false;
  json_item (&out_json, item);
}

static void
json_driver_destroy (struct output_driver *driver)
{
  free (driver->name);
  free (driver);
}

static const struct output_driver_class json_driver_class =
  {
    .name = "json",
    .destroy = json_driver_destroy,
    .submit = json_driver_submit,
    .handles_groups = true,
    .handles_show = true,
  };

static void
handle_msg (const struct msg *m_, struct lexer *lexer)
{
  struct msg m = {
    .category = m_->category,
    .severity = m_->severity,
    .location = (m_->location ? m_->location
                 : lexer ? lex_get_location (lexer, 0, 0)
                 : NULL),
    .command_name = output_get_uppercase_command_name (),
    .text = m_->text,
  };

  output_item_submit (message_item_create (&m));

  free (m.command_name);
  if (m.location != m_->location)
    msg_location_destroy (m.location);
}

/* ------------------------------------------------------------------ */
/* Initialization and running syntax.                                  */
/* ------------------------------------------------------------------ */

EXPORT const char *
pspp_version (void)
{
  return version;
}

EXPORT int
pspp_init (void)
{
  if (the_session)
    return 1;

  i18n_init ();
  gsl_set_error_handler_off ();
  output_engine_push ();
  fh_init ();
  settings_init ();
  random_init ();

  /* Behave like PSPPIRE: no syntax echo, output to our driver only. */
  settings_set_include (false);

  struct json_driver *jd = xzalloc (sizeof *jd);
  jd->driver.class = &json_driver_class;
  jd->driver.name = xstrdup ("json");
  jd->driver.device_type = SETTINGS_DEVICE_TERMINAL;
  output_driver_register (&jd->driver);

  the_session = session_create (NULL);
  dataset_create (the_session, "");
  return 1;
}

/* Runs SYNTAX against the active dataset and returns a JSON object
   {"ok":bool,"errors":N,"items":[...]}.  The returned string stays valid
   until the next call. */
EXPORT const char *
pspp_run (const char *syntax)
{
  static char *result;

  pspp_init ();
  ds_clear (&out_json);
  out_first = true;
  out_n_errors = 0;

  bool ok = true;
  struct lexer *lexer = lex_create ();
  lex_set_message_handler (lexer, handle_msg);
  lex_append (lexer, lex_reader_for_string (syntax, "UTF-8"));
  for (;;)
    {
      struct dataset *ds = session_active_dataset (the_session);
      enum cmd_result r = cmd_parse (lexer, ds);
      if (cmd_result_is_failure (r))
        {
          ok = false;
          if (lex_get_error_mode (lexer) == LEX_ERROR_STOP)
            break;
        }
      if (r == CMD_EOF || r == CMD_FINISH)
        break;
    }

  /* Execute pending transformations so that the data seen by the editor
     reflects them, as PSPPIRE does. */
  struct dataset *ds = session_active_dataset (the_session);
  if (dataset_has_source (ds))
    proc_execute (ds);

  lex_destroy (lexer);
  output_flush ();

  free (result);
  struct string s = DS_EMPTY_INITIALIZER;
  ds_put_format (&s, "{\"ok\":%s,\"errors\":%d,\"items\":[",
                 ok && !out_n_errors ? "true" : "false", out_n_errors);
  ds_put_substring (&s, ds_ss (&out_json));
  ds_put_cstr (&s, "]}");
  result = ds_steal_cstr (&s);
  return result;
}

/* ------------------------------------------------------------------ */
/* Building the active dataset from JavaScript.                        */
/* ------------------------------------------------------------------ */

static struct dictionary *new_dict;
static size_t new_n_cases;
static double **new_num;        /* new_num[var][case], NaN = SYSMIS. */
static char ***new_str;         /* new_str[var][case], NULL = empty. */
static size_t new_n_cols;

static void
new_data_free (void)
{
  for (size_t i = 0; i < new_n_cols; i++)
    {
      free (new_num ? new_num[i] : NULL);
      if (new_str && new_str[i])
        {
          for (size_t j = 0; j < new_n_cases; j++)
            free (new_str[i][j]);
          free (new_str[i]);
        }
    }
  free (new_num);
  free (new_str);
  new_num = NULL;
  new_str = NULL;
  new_n_cols = 0;
  new_n_cases = 0;
}

EXPORT void
ds_begin (void)
{
  pspp_init ();
  if (new_dict)
    dict_unref (new_dict);
  new_data_free ();
  new_dict = dict_create ("UTF-8");
}

static struct variable *
new_var (int idx)
{
  return (new_dict && idx >= 0 && idx < (int) dict_get_n_vars (new_dict)
          ? dict_get_var (new_dict, idx) : NULL);
}

/* Adds a variable of WIDTH (0 = numeric) and returns its index, or -1 if
   NAME is invalid or duplicate. */
EXPORT int
ds_add_var (const char *name, int width)
{
  if (!new_dict || width < 0 || width > MAX_STRING
      || !dict_id_is_valid (new_dict, name, DC_ORDINARY))
    return -1;
  struct variable *v = dict_create_var (new_dict, name, width);
  return v ? (int) var_get_dict_index (v) : -1;
}

EXPORT void
ds_var_set_label (int idx, const char *label)
{
  struct variable *v = new_var (idx);
  if (v)
    var_set_label (v, label && *label ? label : NULL);
}

static bool
make_format (const char *type, int w, int d, int width, struct fmt_spec *f)
{
  enum fmt_type t;
  if (!fmt_from_name (type, &t))
    return false;
  *f = (struct fmt_spec) { .type = t, .w = w, .d = d };
  return fmt_check_output (*f) && fmt_check_width_compat (*f, width);
}

/* Sets print and write formats; returns false if either is invalid (the
   variable then keeps its default formats). */
EXPORT int
ds_var_set_formats (int idx, const char *ptype, int pw, int pd,
                    const char *wtype, int ww, int wd)
{
  struct variable *v = new_var (idx);
  if (!v)
    return 0;
  struct fmt_spec p, w;
  int width = var_get_width (v);
  msg_disable ();
  bool ok = (make_format (ptype, pw, pd, width, &p)
             && make_format (wtype, ww, wd, width, &w));
  msg_enable ();
  if (ok)
    {
      var_set_print_format (v, p);
      var_set_write_format (v, w);
    }
  return ok;
}

EXPORT void
ds_var_add_label_num (int idx, double value, const char *label)
{
  struct variable *v = new_var (idx);
  if (v && var_is_numeric (v))
    {
      union value val = { .f = value };
      var_add_value_label (v, &val, label);
    }
}

EXPORT void
ds_var_add_label_str (int idx, const char *value, const char *label)
{
  struct variable *v = new_var (idx);
  if (v && var_is_alpha (v))
    {
      int width = var_get_width (v);
      union value val;
      value_init (&val, width);
      value_copy_str_rpad (&val, width, (const uint8_t *) value, ' ');
      var_add_value_label (v, &val, label);
      value_destroy (&val, width);
    }
}

/* Numeric missing values: N discrete values A, B, C, plus an optional range
   LO..HI if HAS_RANGE. */
EXPORT void
ds_var_set_missing_num (int idx, int n, double a, double b, double c,
                        int has_range, double lo, double hi)
{
  struct variable *v = new_var (idx);
  if (!v || !var_is_numeric (v))
    return;
  struct missing_values mv;
  mv_init (&mv, 0);
  if (has_range)
    mv_add_range (&mv, lo, hi);
  double vals[3] = { a, b, c };
  for (int i = 0; i < n && i < 3; i++)
    mv_add_num (&mv, vals[i]);
  var_set_missing_values (v, &mv);
  mv_destroy (&mv);
}

EXPORT void
ds_var_set_missing_str (int idx, int n, const char *a, const char *b,
                        const char *c)
{
  struct variable *v = new_var (idx);
  if (!v || !var_is_alpha (v))
    return;
  int width = var_get_width (v);
  struct missing_values mv;
  mv_init (&mv, width);
  const char *vals[3] = { a, b, c };
  for (int i = 0; i < n && i < 3; i++)
    if (vals[i])
      mv_add_str (&mv, (const uint8_t *) vals[i],
                  MIN (strlen (vals[i]), MV_MAX_STRING));
  var_set_missing_values (v, &mv);
  mv_destroy (&mv);
}

/* MEASURE: 0 unknown, 1 nominal, 2 ordinal, 3 scale.
   ALIGN: 0 left, 1 right, 2 center.
   ROLE: 0 input, 1 target, 2 both, 3 none, 4 partition, 5 split. */
EXPORT void
ds_var_set_misc (int idx, int measure, int align, int role, int columns)
{
  struct variable *v = new_var (idx);
  if (!v)
    return;
  if (measure >= MEASURE_UNKNOWN && measure <= MEASURE_SCALE)
    var_set_measure (v, measure);
  if (align >= ALIGN_LEFT && align <= ALIGN_CENTRE)
    var_set_alignment (v, align);
  if (role >= ROLE_INPUT && role <= ROLE_SPLIT)
    var_set_role (v, role);
  if (columns > 0)
    var_set_display_width (v, columns);
}

EXPORT void
ds_set_file_label (const char *label)
{
  if (new_dict)
    dict_set_label (new_dict, label && *label ? label : NULL);
}

EXPORT void
ds_add_document (const char *line)
{
  if (new_dict)
    dict_add_document_line (new_dict, line, false);
}

EXPORT void
ds_set_weight (const char *name)
{
  struct variable *v = new_dict ? dict_lookup_var (new_dict, name) : NULL;
  if (v && var_is_numeric (v))
    dict_set_weight (new_dict, v);
}

EXPORT void
ds_set_filter (const char *name)
{
  struct variable *v = new_dict ? dict_lookup_var (new_dict, name) : NULL;
  if (v && var_is_numeric (v))
    dict_set_filter (new_dict, v);
}

/* NAMES is a space-separated list of variable names.  LAYERED selects
   SPLIT FILE LAYERED instead of SEPARATE. */
EXPORT void
ds_set_split (const char *names, int layered)
{
  if (!new_dict)
    return;
  struct variable *vars[MAX_SPLITS];
  size_t n = 0;
  char *copy = xstrdup (names);
  char *save = NULL;
  for (char *tok = strtok_r (copy, " ", &save); tok && n < MAX_SPLITS;
       tok = strtok_r (NULL, " ", &save))
    {
      struct variable *v = dict_lookup_var (new_dict, tok);
      if (v)
        vars[n++] = v;
    }
  free (copy);
  if (n)
    dict_set_split_vars (new_dict, vars, n,
                         layered ? SPLIT_LAYERED : SPLIT_SEPARATE);
}

/* Allocates storage for N_CASES cases.  Call after all ds_add_var(). */
EXPORT void
ds_set_case_count (int n_cases)
{
  new_data_free ();
  if (!new_dict || n_cases < 0)
    return;
  new_n_cases = n_cases;
  new_n_cols = dict_get_n_vars (new_dict);
  new_num = xcalloc (new_n_cols, sizeof *new_num);
  new_str = xcalloc (new_n_cols, sizeof *new_str);
  for (size_t i = 0; i < new_n_cols; i++)
    {
      if (var_is_numeric (dict_get_var (new_dict, i)))
        {
          new_num[i] = xmalloc (MAX (1, new_n_cases) * sizeof (double));
          for (size_t j = 0; j < new_n_cases; j++)
            new_num[i][j] = NAN;
        }
      else
        new_str[i] = xcalloc (MAX (1, new_n_cases), sizeof (char *));
    }
}

/* Returns a pointer to the numeric column for variable IDX, which
   JavaScript fills directly with doubles (NaN = system-missing). */
EXPORT double *
ds_num_column (int idx)
{
  return (idx >= 0 && (size_t) idx < new_n_cols ? new_num[idx] : NULL);
}

EXPORT void
ds_set_str (int idx, int row, const char *value)
{
  if (idx >= 0 && (size_t) idx < new_n_cols && new_str[idx]
      && row >= 0 && (size_t) row < new_n_cases)
    {
      free (new_str[idx][row]);
      new_str[idx][row] = value && *value ? xstrdup (value) : NULL;
    }
}

/* Makes the dataset built since ds_begin() the active dataset. */
EXPORT int
ds_commit (void)
{
  if (!new_dict)
    return 0;
  if (!new_num)
    ds_set_case_count (0);

  const struct caseproto *proto = dict_get_proto (new_dict);
  struct casewriter *w = autopaging_writer_create (proto);
  size_t n_vars = dict_get_n_vars (new_dict);
  for (size_t row = 0; row < new_n_cases; row++)
    {
      struct ccase *c = case_create (proto);
      for (size_t i = 0; i < n_vars; i++)
        {
          const struct variable *v = dict_get_var (new_dict, i);
          union value *val = case_data_rw (c, v);
          if (var_is_numeric (v))
            {
              double d = new_num[i][row];
              val->f = isnan (d) ? SYSMIS : d;
            }
          else
            {
              const char *str = new_str[i][row];
              value_copy_str_rpad (val, var_get_width (v),
                                   (const uint8_t *) (str ? str : ""), ' ');
            }
        }
      casewriter_write (w, c);
    }
  new_data_free ();

  struct dataset *ds = session_active_dataset (the_session);
  dataset_set_dict (ds, new_dict);
  dataset_set_source (ds, casewriter_make_reader (w));
  new_dict = NULL;
  return 1;
}

/* ------------------------------------------------------------------ */
/* Reading the active dataset back.                                    */
/* ------------------------------------------------------------------ */

static size_t ex_n_cases;
static size_t ex_n_vars;
static double **ex_num;
static struct string_array *ex_str;

static void
ex_free (void)
{
  for (size_t i = 0; i < ex_n_vars; i++)
    {
      free (ex_num[i]);
      if (ex_str)
        string_array_destroy (&ex_str[i]);
    }
  free (ex_num);
  free (ex_str);
  ex_num = NULL;
  ex_str = NULL;
  ex_n_vars = ex_n_cases = 0;
}

static void
json_put_format (struct string *s, const char *key, struct fmt_spec f)
{
  ds_put_format (s, ",\"%s\":{\"type\":\"%s\",\"w\":%d,\"d\":%d}",
                 key, fmt_name (f.type), f.w, f.d);
}

static void
json_put_value (struct string *s, const union value *v, int width)
{
  if (width == 0)
    json_put_double (s, v->f);
  else
    {
      struct substring ss = ss_buffer ((const char *) v->s, width);
      ss_rtrim (&ss, ss_cstr (" "));
      json_put_substring (s, ss);
    }
}

static void
json_put_variable (struct string *s, const struct variable *v)
{
  static const char *const measures[] = {
    "unknown", "nominal", "ordinal", "scale" };
  static const char *const aligns[] = { "left", "right", "center" };
  static const char *const roles[] = {
    "input", "target", "both", "none", "partition", "split" };
  int width = var_get_width (v);

  ds_put_byte (s, '{');
  json_put_str (s, "name");
  ds_put_byte (s, ':');
  json_put_str (s, var_get_name (v));
  json_put_key_str (s, "label", var_get_label (v) ? var_get_label (v) : "");
  ds_put_format (s, ",\"type\":\"%s\",\"width\":%d",
                 width ? "string" : "numeric", width);
  json_put_format (s, "print", var_get_print_format (v));
  json_put_format (s, "write", var_get_write_format (v));

  ds_put_cstr (s, ",\"valueLabels\":[");
  const struct val_labs *vls = var_get_value_labels (v);
  const struct val_lab **labels = val_labs_sorted (vls);
  size_t n_labels = val_labs_count (vls);
  for (size_t i = 0; i < n_labels; i++)
    {
      if (i)
        ds_put_byte (s, ',');
      ds_put_cstr (s, "{\"value\":");
      json_put_value (s, val_lab_get_value (labels[i]), width);
      json_put_key_str (s, "label", val_lab_get_label (labels[i]));
      ds_put_byte (s, '}');
    }
  free (labels);
  ds_put_byte (s, ']');

  const struct missing_values *mv = var_get_missing_values (v);
  ds_put_cstr (s, ",\"missing\":{\"values\":[");
  for (int i = 0; i < mv_n_values (mv); i++)
    {
      if (i)
        ds_put_byte (s, ',');
      json_put_value (s, mv_get_value (mv, i), width);
    }
  ds_put_byte (s, ']');
  if (mv_has_range (mv))
    {
      double lo, hi;
      mv_get_range (mv, &lo, &hi);
      ds_put_cstr (s, ",\"range\":{\"low\":");
      json_put_double (s, lo);
      ds_put_cstr (s, ",\"high\":");
      json_put_double (s, hi);
      ds_put_byte (s, '}');
    }
  ds_put_byte (s, '}');

  ds_put_format (s, ",\"columns\":%d,\"align\":\"%s\",\"measure\":\"%s\","
                 "\"role\":\"%s\"}",
                 var_get_display_width (v), aligns[var_get_alignment (v)],
                 measures[var_get_measure (v)], roles[var_get_role (v)]);
}

/* Reads the whole active dataset into memory and returns its dictionary as
   JSON.  Column data is then available through ex_num_column() and
   ex_str_column(). */
EXPORT const char *
ex_begin (void)
{
  static char *result;

  pspp_init ();
  ex_free ();
  free (result);

  struct dataset *ds = session_active_dataset (the_session);
  const struct dictionary *dict = dataset_dict (ds);
  ex_n_vars = dict_get_n_vars (dict);
  ex_num = xcalloc (MAX (1, ex_n_vars), sizeof *ex_num);
  ex_str = xcalloc (MAX (1, ex_n_vars), sizeof *ex_str);

  size_t allocated = 0;
  if (dataset_has_source (ds))
    {
      struct casereader *r = casereader_clone (dataset_source (ds));
      struct ccase *c;
      for (; (c = casereader_read (r)) != NULL; case_unref (c))
        {
          if (ex_n_cases >= allocated)
            {
              allocated = allocated ? allocated * 2 : 1024;
              for (size_t i = 0; i < ex_n_vars; i++)
                if (var_is_numeric (dict_get_var (dict, i)))
                  ex_num[i] = xrealloc (ex_num[i],
                                        allocated * sizeof (double));
            }
          for (size_t i = 0; i < ex_n_vars; i++)
            {
              const struct variable *v = dict_get_var (dict, i);
              const union value *val = case_data (c, v);
              if (var_is_numeric (v))
                ex_num[i][ex_n_cases] = val->f == SYSMIS ? NAN : val->f;
              else
                {
                  struct substring ss = ss_buffer ((const char *) val->s,
                                                   var_get_width (v));
                  ss_rtrim (&ss, ss_cstr (" "));
                  string_array_append_nocopy (&ex_str[i],
                                              ss_xstrdup (ss));
                }
            }
          ex_n_cases++;
        }
      casereader_destroy (r);
    }

  struct string s = DS_EMPTY_INITIALIZER;
  ds_put_format (&s, "{\"cases\":%zu", ex_n_cases);
  json_put_key_str (&s, "name", dataset_name (ds));
  json_put_key_str (&s, "fileLabel",
                    dict_get_label (dict) ? dict_get_label (dict) : "");
  const struct variable *wv = dict_get_weight (dict);
  if (wv)
    json_put_key_str (&s, "weight", var_get_name (wv));
  const struct variable *fv = dict_get_filter (dict);
  if (fv)
    json_put_key_str (&s, "filter", var_get_name (fv));

  ds_put_cstr (&s, ",\"split\":[");
  const struct variable *const *splits = dict_get_split_vars (dict);
  for (size_t i = 0; i < dict_get_n_splits (dict); i++)
    {
      if (i)
        ds_put_byte (&s, ',');
      json_put_str (&s, var_get_name (splits[i]));
    }
  ds_put_format (&s, "],\"splitType\":\"%s\"",
                 dict_get_split_type (dict) == SPLIT_LAYERED
                 ? "layered" : "separate");

  ds_put_cstr (&s, ",\"documents\":[");
  const struct string_array *docs = dict_get_documents (dict);
  for (size_t i = 0; i < docs->n; i++)
    {
      if (i)
        ds_put_byte (&s, ',');
      json_put_str (&s, docs->strings[i]);
    }
  ds_put_cstr (&s, "],\"variables\":[");
  for (size_t i = 0; i < ex_n_vars; i++)
    {
      if (i)
        ds_put_byte (&s, ',');
      json_put_variable (&s, dict_get_var (dict, i));
    }
  ds_put_cstr (&s, "]}");
  result = ds_steal_cstr (&s);
  return result;
}

EXPORT const double *
ex_num_column (int idx)
{
  return (idx >= 0 && (size_t) idx < ex_n_vars ? ex_num[idx] : NULL);
}

/* Returns string column IDX as a JSON array of strings. */
EXPORT const char *
ex_str_column (int idx)
{
  static char *result;
  free (result);
  result = NULL;
  if (idx < 0 || (size_t) idx >= ex_n_vars)
    return "[]";

  struct string s = DS_EMPTY_INITIALIZER;
  ds_put_byte (&s, '[');
  for (size_t j = 0; j < ex_str[idx].n; j++)
    {
      if (j)
        ds_put_byte (&s, ',');
      json_put_str (&s, ex_str[idx].strings[j]);
    }
  ds_put_byte (&s, ']');
  result = ds_steal_cstr (&s);
  return result;
}

EXPORT void
ex_end (void)
{
  ex_free ();
}
