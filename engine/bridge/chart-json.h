/* PSPP Studio - serialization of PSPP chart items to JSON.
   Copyright (C) 2026 PSPP Studio contributors.
   SPDX-License-Identifier: GPL-3.0-or-later */

#ifndef BRIDGE_CHART_JSON_H
#define BRIDGE_CHART_JSON_H 1

struct chart;
struct string;

void chart_to_json (struct string *, const struct chart *);

#endif /* bridge/chart-json.h */
