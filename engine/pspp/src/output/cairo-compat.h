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

/* Allows the output subsystem to be built without Cairo (configure
   --without-cairo), e.g. for headless WebAssembly builds.  Without Cairo,
   image items cannot be decoded or encoded and charts are not rendered
   by PSPP itself; front ends may render chart items from their data. */

#ifndef OUTPUT_CAIRO_COMPAT_H
#define OUTPUT_CAIRO_COMPAT_H 1

#ifdef HAVE_CAIRO
#include <cairo.h>
#else
#include <stddef.h>

typedef struct _cairo cairo_t;
typedef struct _cairo_surface cairo_surface_t;
typedef enum
  {
    CAIRO_STATUS_SUCCESS = 0,
    CAIRO_STATUS_NO_MEMORY = 1,
    CAIRO_STATUS_READ_ERROR = 10,
    CAIRO_STATUS_WRITE_ERROR = 11,
  }
cairo_status_t;
typedef cairo_status_t (*cairo_read_func_t) (void *, unsigned char *,
                                             unsigned int);
typedef cairo_status_t (*cairo_write_func_t) (void *, const unsigned char *,
                                              unsigned int);

static inline void cairo_surface_destroy (cairo_surface_t *s) { (void) s; }
static inline cairo_surface_t *
cairo_surface_reference (cairo_surface_t *s) { return s; }
static inline cairo_status_t
cairo_surface_status (cairo_surface_t *s)
{
  return s ? CAIRO_STATUS_SUCCESS : CAIRO_STATUS_NO_MEMORY;
}
static inline cairo_surface_t *
cairo_image_surface_create_from_png_stream (cairo_read_func_t f, void *aux)
{
  (void) f; (void) aux;
  return NULL;
}
static inline cairo_status_t
cairo_surface_write_to_png_stream (cairo_surface_t *s, cairo_write_func_t f,
                                   void *aux)
{
  (void) s; (void) f; (void) aux;
  return CAIRO_STATUS_WRITE_ERROR;
}
#endif

#endif /* output/cairo-compat.h */
