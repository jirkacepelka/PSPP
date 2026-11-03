/*
 * Grouped PSPP expression functions with one-line descriptions (Compute / Select cases palette).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
type L = { cs: string; en: string };
interface Fn {
  name: string;
  desc: L;
}

const f = (name: string, cs: string, en: string): Fn => ({ name, desc: { cs, en } });

export const FUNCTIONS_BY_GROUP: { id: string; label: L; items: Fn[] }[] = [
  {
    id: 'stat',
    label: { cs: 'Statistické (přes proměnné)', en: 'Statistical (across variables)' },
    items: [
      f('MEAN', 'průměr hodnot', 'mean of the values'),
      f('SUM', 'součet', 'sum'),
      f('SD', 'směrodatná odchylka', 'standard deviation'),
      f('MIN', 'nejmenší hodnota', 'smallest value'),
      f('MAX', 'největší hodnota', 'largest value'),
      f('MEDIAN', 'medián', 'median'),
      f('NVALID', 'počet platných hodnot', 'number of valid values'),
    ],
  },
  {
    id: 'arith',
    label: { cs: 'Aritmetické', en: 'Arithmetic' },
    items: [
      f('ABS', 'absolutní hodnota', 'absolute value'),
      f('RND', 'zaokrouhlení', 'round'),
      f('TRUNC', 'useknutí desetinné části', 'truncate'),
      f('SQRT', 'odmocnina', 'square root'),
      f('LN', 'přirozený logaritmus', 'natural logarithm'),
      f('LG10', 'dekadický logaritmus', 'base-10 logarithm'),
      f('EXP', 'e na x', 'e to the power x'),
      f('MOD', 'zbytek po dělení', 'remainder'),
    ],
  },
  {
    id: 'missing',
    label: { cs: 'Chybějící hodnoty', en: 'Missing values' },
    items: [
      f('MISSING', 'je hodnota chybějící?', 'is the value missing?'),
      f('SYSMIS', 'je systémově chybějící?', 'is it system-missing?'),
      f('NMISS', 'počet chybějících', 'number of missing values'),
      f('VALUE', 'hodnota i když je uživatelsky chybějící', 'value even if user-missing'),
    ],
  },
  {
    id: 'text',
    label: { cs: 'Textové', en: 'Text' },
    items: [
      f('CONCAT', 'spojení textů', 'join strings'),
      f('LENGTH', 'délka textu', 'string length'),
      f('UPCASE', 'velká písmena', 'upper case'),
      f('LOWER', 'malá písmena', 'lower case'),
      f('SUBSTR', 'část textu', 'substring'),
      f('INDEX', 'pozice podřetězce', 'position of a substring'),
      f('NUMBER', 'text na číslo', 'string to number'),
      f('STRING', 'číslo na text', 'number to string'),
      f('LTRIM', 'odstranit mezery vlevo', 'trim left'),
    ],
  },
  {
    id: 'logic',
    label: { cs: 'Logické a rozsahy', en: 'Logic and ranges' },
    items: [f('ANY', 'je hodnota mezi vyjmenovanými?', 'is the value among the listed ones?'), f('RANGE', 'leží v rozsahu?', 'is it within a range?')],
  },
  {
    id: 'date',
    label: { cs: 'Datum a čas', en: 'Date and time' },
    items: [
      f('DATE.DMY', 'datum ze dne, měsíce, roku', 'date from day, month, year'),
      f('XDATE.YEAR', 'rok z data', 'year of a date'),
      f('XDATE.MONTH', 'měsíc z data', 'month of a date'),
      f('DATEDIFF', 'rozdíl dvou dat', 'difference of two dates'),
      f('CTIME.DAYS', 'časový údaj ve dnech', 'time interval in days'),
    ],
  },
  {
    id: 'random',
    label: { cs: 'Rozdělení a náhoda', en: 'Distributions and random' },
    items: [
      f('RV.NORMAL', 'náhodné číslo z normálního rozdělení', 'random normal number'),
      f('RV.UNIFORM', 'náhodné číslo z rovnoměrného rozdělení', 'random uniform number'),
      f('CDF.NORMAL', 'distribuční funkce normálního rozdělení', 'normal CDF'),
      f('IDF.NORMAL', 'kvantil normálního rozdělení', 'normal quantile'),
    ],
  },
];
