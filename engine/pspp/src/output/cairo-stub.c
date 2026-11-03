/* PSPP - a program for statistical analysis.
   Copyright (C) 2026 Free Software Foundation, Inc.

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

/* Stand-ins for the Cairo chart renderers, used when PSPP is configured
   --without-cairo.  Every entry point reports that nothing was drawn. */

#include <config.h>

#include "output/cairo-chart.h"

#include <stddef.h>

cairo_surface_t *
xr_draw_image_chart (const struct chart *chart UNUSED,
                     const struct cell_color *fg UNUSED,
                     const struct cell_color *bg UNUSED)
{
  return NULL;
}

char *
xr_write_png_image (cairo_surface_t *image UNUSED,
                    const char *file_name_template UNUSED,
                    int number UNUSED)
{
  return NULL;
}

char *
xr_draw_png_chart (const struct chart *chart UNUSED,
                   const char *file_name_template UNUSED, int number UNUSED,
                   const struct cell_color *fg UNUSED,
                   const struct cell_color *bg UNUSED)
{
  return NULL;
}

char *
xr_draw_eps_chart (const struct chart *chart UNUSED,
                   const char *file_name_template UNUSED, int number UNUSED,
                   const struct cell_color *fg UNUSED,
                   const struct cell_color *bg UNUSED)
{
  return NULL;
}
