/* PSPP Studio - minimal JSON writing helpers.
   Copyright (C) 2026 PSPP Studio contributors.
   SPDX-License-Identifier: GPL-3.0-or-later */

#ifndef BRIDGE_JSON_H
#define BRIDGE_JSON_H 1

#include <float.h>
#include <math.h>
#include <stdio.h>
#include <string.h>

#include "libpspp/str.h"

static inline void
json_put_substring (struct string *s, struct substring ss)
{
  ds_put_byte (s, '"');
  for (size_t i = 0; i < ss.length; i++)
    {
      unsigned char c = ss.string[i];
      switch (c)
        {
        case '"': ds_put_cstr (s, "\\\""); break;
        case '\\': ds_put_cstr (s, "\\\\"); break;
        case '\n': ds_put_cstr (s, "\\n"); break;
        case '\r': ds_put_cstr (s, "\\r"); break;
        case '\t': ds_put_cstr (s, "\\t"); break;
        default:
          if (c < 0x20)
            ds_put_format (s, "\\u%04x", c);
          else
            ds_put_byte (s, c);
        }
    }
  ds_put_byte (s, '"');
}

static inline void
json_put_str (struct string *s, const char *str)
{
  if (str)
    json_put_substring (s, ss_cstr (str));
  else
    ds_put_cstr (s, "null");
}

static inline void
json_put_key_str (struct string *s, const char *key, const char *value)
{
  ds_put_format (s, ",\"%s\":", key);
  json_put_str (s, value);
}

/* Writes D, mapping PSPP's system-missing value and non-finite values to
   null. */
static inline void
json_put_double (struct string *s, double d)
{
  if (!isfinite (d) || d == -DBL_MAX)
    ds_put_cstr (s, "null");
  else
    ds_put_format (s, "%.17g", d);
}

static inline void
json_put_key_double (struct string *s, const char *key, double d)
{
  ds_put_format (s, ",\"%s\":", key);
  json_put_double (s, d);
}

#endif /* bridge/json.h */
