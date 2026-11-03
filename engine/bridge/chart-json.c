/* PSPP Studio - serialization of PSPP chart items to JSON.
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

/* PSPP normally renders charts with Cairo.  The WebAssembly build has no
   Cairo, so instead each chart's underlying data is written out as JSON and
   the web front end draws it.  The "type" member selects the chart kind; the
   remaining members mirror what the corresponding *-cairo.c renderer uses. */

#include <config.h>

#include "chart-json.h"

#include <gsl/gsl_histogram.h>
#include <gsl/gsl_vector.h>

#include "data/case.h"
#include "data/casereader.h"
#include "data/value.h"
#include "data/variable.h"
#include "language/commands/freq.h"
#include "language/commands/roc.h"
#include "libpspp/hmap.h"
#include "libpspp/ll.h"
#include "math/box-whisker.h"
#include "math/np.h"
#include "output/chart.h"
#include "output/charts/barchart.h"
#include "output/charts/boxplot.h"
#include "output/charts/np-plot.h"
#include "output/charts/piechart.h"
#include "output/charts/plot-hist.h"
#include "output/charts/roc-chart.h"
#include "output/charts/scatterplot.h"
#include "output/charts/scree.h"
#include "output/charts/spreadlevel-plot.h"

#include "json.h"

/* Bounds the size of point-based charts sent to the browser. */
#define MAX_POINTS 20000

static void
put_value_name (struct string *s, const struct variable *var,
                const union value *val)
{
  struct string label = DS_EMPTY_INITIALIZER;
  if (var)
    var_append_value_name (var, val, &label);
  json_put_str (s, ds_cstr (&label));
  ds_destroy (&label);
}

static const struct category *
find_category (const struct hmap *map, const union value *val, int width)
{
  const struct category *c;
  size_t hash = value_hash (val, width, 0);
  HMAP_FOR_EACH_WITH_HASH (c, struct category, node, hash, map)
    if (value_equal (&c->val, val, width))
      return c;
  return NULL;
}

static void
histogram_to_json (struct string *s, const struct histogram_chart *h)
{
  ds_put_cstr (s, "\"type\":\"histogram\"");
  json_put_key_double (s, "n", h->n);
  json_put_key_double (s, "mean", h->mean);
  json_put_key_double (s, "stddev", h->stddev);
  ds_put_format (s, ",\"showNormal\":%s,\"bins\":[",
                 h->show_normal ? "true" : "false");
  if (h->gsl_hist)
    for (size_t i = 0; i < gsl_histogram_bins (h->gsl_hist); i++)
      {
        double lo, hi;
        gsl_histogram_get_range (h->gsl_hist, i, &lo, &hi);
        ds_put_cstr (s, i ? ",[" : "[");
        json_put_double (s, lo);
        ds_put_byte (s, ',');
        json_put_double (s, hi);
        ds_put_byte (s, ',');
        json_put_double (s, gsl_histogram_get (h->gsl_hist, i));
        ds_put_byte (s, ']');
      }
  ds_put_byte (s, ']');
}

static void
barchart_to_json (struct string *s, const struct barchart *bc)
{
  ds_put_format (s, "\"type\":\"bar\",\"percent\":%s",
                 bc->percent ? "true" : "false");
  json_put_key_str (s, "ylabel", bc->ylabel);
  json_put_key_double (s, "total", bc->total_count);
  ds_put_cstr (s, ",\"bars\":[");
  for (int i = 0; i < bc->n_nzcats; i++)
    {
      const struct freq *f = bc->cats[i];
      const struct category *p = find_category (&bc->primaries,
                                                &f->values[0], bc->widths[0]);
      ds_put_cstr (s, i ? ",{\"x\":" : "{\"x\":");
      json_put_str (s, p ? ds_cstr (&p->label) : "");
      ds_put_cstr (s, ",\"group\":");
      if (bc->ss)
        {
          const struct category *g = find_category (&bc->secondaries,
                                                    &f->values[1],
                                                    bc->widths[1]);
          json_put_str (s, g ? ds_cstr (&g->label) : "");
        }
      else
        ds_put_cstr (s, "null");
      json_put_key_double (s, "count", f->count);
      ds_put_byte (s, '}');
    }
  ds_put_byte (s, ']');
}

static void
piechart_to_json (struct string *s, const struct piechart *pc)
{
  ds_put_cstr (s, "\"type\":\"pie\",\"slices\":[");
  for (int i = 0; i < pc->n_slices; i++)
    {
      ds_put_cstr (s, i ? ",{\"label\":" : "{\"label\":");
      json_put_str (s, ds_cstr (&pc->slices[i].label));
      json_put_key_double (s, "value", pc->slices[i].magnitude);
      ds_put_byte (s, '}');
    }
  ds_put_byte (s, ']');
}

static void
boxplot_to_json (struct string *s, const struct boxplot *bp)
{
  ds_put_cstr (s, "\"type\":\"boxplot\"");
  json_put_key_double (s, "yMin", bp->y_min);
  json_put_key_double (s, "yMax", bp->y_max);
  ds_put_cstr (s, ",\"boxes\":[");
  for (size_t i = 0; i < bp->n_boxes; i++)
    {
      const struct box_whisker *bw = bp->boxes[i].bw;
      double hinges[3], whiskers[2];
      box_whisker_hinges (bw, hinges);
      box_whisker_whiskers (bw, whiskers);
      ds_put_cstr (s, i ? ",{\"label\":" : "{\"label\":");
      json_put_str (s, bp->boxes[i].label);
      ds_put_cstr (s, ",\"hinges\":[");
      for (int j = 0; j < 3; j++)
        {
          if (j)
            ds_put_byte (s, ',');
          json_put_double (s, hinges[j]);
        }
      ds_put_cstr (s, "],\"whiskers\":[");
      json_put_double (s, whiskers[0]);
      ds_put_byte (s, ',');
      json_put_double (s, whiskers[1]);
      ds_put_cstr (s, "],\"outliers\":[");
      const struct outlier *o;
      bool first = true;
      ll_for_each (o, struct outlier, ll, box_whisker_outliers (bw))
        {
          ds_put_cstr (s, first ? "{\"value\":" : ",{\"value\":");
          first = false;
          json_put_double (s, o->value);
          json_put_key_str (s, "label", ds_cstr (&o->label));
          ds_put_format (s, ",\"extreme\":%s}", o->extreme ? "true" : "false");
        }
      ds_put_cstr (s, "]}");
    }
  ds_put_byte (s, ']');
}

static void
np_plot_to_json (struct string *s, const struct np_plot_chart *np)
{
  ds_put_format (s, "\"type\":\"np\",\"detrended\":%s",
                 np->detrended ? "true" : "false");
  json_put_key_double (s, "slope", np->slope);
  json_put_key_double (s, "intercept", np->intercept);
  json_put_key_double (s, "yFirst", np->y_first);
  json_put_key_double (s, "yLast", np->y_last);
  json_put_key_double (s, "xLower", np->x_lower);
  json_put_key_double (s, "xUpper", np->x_upper);
  ds_put_cstr (s, ",\"points\":[");
  struct casereader *r = casereader_clone (np->data);
  struct ccase *c;
  size_t n = 0;
  for (; (c = casereader_read (r)) != NULL && n < MAX_POINTS; case_unref (c))
    {
      ds_put_cstr (s, n++ ? ",[" : "[");
      json_put_double (s, case_num_idx (c, NP_IDX_Y));
      ds_put_byte (s, ',');
      json_put_double (s, case_num_idx (c, np->detrended
                                        ? NP_IDX_DNS : NP_IDX_NS));
      ds_put_byte (s, ']');
    }
  case_unref (c);
  casereader_destroy (r);
  ds_put_byte (s, ']');
}

static void
roc_to_json (struct string *s, const struct roc_chart *rc)
{
  ds_put_format (s, "\"type\":\"roc\",\"reference\":%s,\"curves\":[",
                 rc->reference ? "true" : "false");
  for (size_t i = 0; i < rc->n_vars; i++)
    {
      ds_put_cstr (s, i ? ",{\"name\":" : "{\"name\":");
      json_put_str (s, rc->vars[i].name);
      ds_put_cstr (s, ",\"points\":[[0,0]");
      struct casereader *r = casereader_clone (rc->vars[i].cutpoint_reader);
      struct ccase *c;
      for (; (c = casereader_read (r)) != NULL; case_unref (c))
        {
          double se = case_num_idx (c, ROC_TP);
          double sp = case_num_idx (c, ROC_TN);
          se /= case_num_idx (c, ROC_FN) + case_num_idx (c, ROC_TP);
          sp /= case_num_idx (c, ROC_TN) + case_num_idx (c, ROC_FP);
          ds_put_cstr (s, ",[");
          json_put_double (s, 1 - sp);
          ds_put_byte (s, ',');
          json_put_double (s, se);
          ds_put_byte (s, ']');
        }
      casereader_destroy (r);
      ds_put_cstr (s, ",[1,1]]}");
    }
  ds_put_byte (s, ']');
}

static void
scatterplot_to_json (struct string *s, const struct scatterplot_chart *sp)
{
  ds_put_cstr (s, "\"type\":\"scatter\"");
  json_put_key_str (s, "xlabel", sp->xlabel);
  json_put_key_str (s, "ylabel", sp->ylabel);
  json_put_key_double (s, "xMin", sp->x_min);
  json_put_key_double (s, "xMax", sp->x_max);
  json_put_key_double (s, "yMin", sp->y_min);
  json_put_key_double (s, "yMax", sp->y_max);
  if (sp->byvar)
    json_put_key_str (s, "byvar", var_get_name (sp->byvar));
  ds_put_cstr (s, ",\"points\":[");
  struct casereader *r = casereader_clone (sp->data);
  struct ccase *c;
  size_t n = 0;
  for (; (c = casereader_read (r)) != NULL && n < MAX_POINTS; case_unref (c))
    {
      ds_put_cstr (s, n++ ? ",[" : "[");
      json_put_double (s, case_num_idx (c, SP_IDX_X));
      ds_put_byte (s, ',');
      json_put_double (s, case_num_idx (c, SP_IDX_Y));
      if (sp->byvar)
        {
          ds_put_byte (s, ',');
          put_value_name (s, sp->byvar, case_data_idx (c, SP_IDX_BY));
        }
      ds_put_byte (s, ']');
    }
  case_unref (c);
  casereader_destroy (r);
  ds_put_byte (s, ']');
}

static void
scree_to_json (struct string *s, const struct scree *sc)
{
  ds_put_cstr (s, "\"type\":\"scree\"");
  json_put_key_str (s, "xlabel", sc->xlabel);
  ds_put_cstr (s, ",\"values\":[");
  for (size_t i = 0; sc->eval && i < sc->eval->size; i++)
    {
      if (i)
        ds_put_byte (s, ',');
      json_put_double (s, gsl_vector_get (sc->eval, i));
    }
  ds_put_byte (s, ']');
}

static void
spreadlevel_to_json (struct string *s, const struct spreadlevel_plot_chart *sl)
{
  ds_put_cstr (s, "\"type\":\"spreadlevel\"");
  json_put_key_double (s, "power", sl->tx_pwr);
  ds_put_cstr (s, ",\"points\":[");
  for (size_t i = 0; i < sl->n_data; i++)
    {
      ds_put_cstr (s, i ? ",[" : "[");
      json_put_double (s, sl->data[i].x);
      ds_put_byte (s, ',');
      json_put_double (s, sl->data[i].y);
      ds_put_byte (s, ']');
    }
  ds_put_byte (s, ']');
}

void
chart_to_json (struct string *s, const struct chart *chart)
{
  ds_put_byte (s, '{');
  if (is_histogram_chart (chart))
    histogram_to_json (s, to_histogram_chart (chart));
  else if (is_barchart (chart))
    barchart_to_json (s, to_barchart (chart));
  else if (is_piechart (chart))
    piechart_to_json (s, to_piechart (chart));
  else if (is_boxplot (chart))
    boxplot_to_json (s, to_boxplot (chart));
  else if (is_np_plot_chart (chart))
    np_plot_to_json (s, to_np_plot_chart (chart));
  else if (is_roc_chart (chart))
    roc_to_json (s, to_roc_chart (chart));
  else if (is_scatterplot_chart (chart))
    scatterplot_to_json (s, to_scatterplot_chart (chart));
  else if (is_scree (chart))
    scree_to_json (s, to_scree (chart));
  else if (is_spreadlevel_plot_chart (chart))
    spreadlevel_to_json (s, to_spreadlevel_plot_chart (chart));
  else
    ds_put_cstr (s, "\"type\":\"unknown\"");
  json_put_key_str (s, "title", chart_get_title (chart));
  ds_put_byte (s, '}');
}
