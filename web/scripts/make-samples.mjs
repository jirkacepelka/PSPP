// Generates the bundled sample datasets (deterministic). Run: node scripts/make-samples.mjs
import { writeFileSync } from 'node:fs';

let seed = 20251103;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const normal = (m, s) => { const u = 1 - rand(); const v = rand(); return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const pick = (arr, w) => { const r = rand() * w.reduce((a, b) => a + b, 0); let c = 0; for (let i = 0; i < arr.length; i++) { c += w[i]; if (r < c) return arr[i]; } return arr[arr.length - 1]; };
const round = (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d;
const EPOCH = Date.UTC(1582, 9, 14);
const pdate = (y, m, d) => (Date.UTC(y, m - 1, d) - EPOCH) / 1000;

const num = (name, label, o = {}) => ({ name, label, type: 'numeric', width: 0, print: { type: 'F', w: o.w ?? 8, d: o.d ?? 0 }, write: { type: 'F', w: o.w ?? 8, d: o.d ?? 0 }, valueLabels: o.vl ?? [], missing: o.missing ?? { values: [] }, columns: o.columns ?? 8, align: 'right', measure: o.measure ?? 'scale', role: o.role ?? 'input' });
const str = (name, label, width, o = {}) => ({ name, label, type: 'string', width, print: { type: 'A', w: width, d: 0 }, write: { type: 'A', w: width, d: 0 }, valueLabels: o.vl ?? [], missing: { values: [] }, columns: Math.min(Math.max(width, 8), 24), align: 'left', measure: o.measure ?? 'nominal', role: 'input' });
const vl = (pairs) => pairs.map(([value, label]) => ({ value, label }));

// ---------- 1. Student survey
{
  const n = 120;
  const vars = [
    num('id', 'Respondent ID', { w: 4, measure: 'nominal', role: 'none' }),
    num('gender', 'Gender', { w: 1, measure: 'nominal', vl: vl([[1, 'Female'], [2, 'Male'], [3, 'Other / prefer not to say']]) }),
    num('age', 'Age in years', { w: 3 }),
    num('faculty', 'Faculty', { w: 1, measure: 'nominal', vl: vl([[1, 'Science'], [2, 'Humanities'], [3, 'Economics'], [4, 'Medicine'], [5, 'Law']]) }),
    num('year', 'Year of study', { w: 1, measure: 'ordinal', vl: vl([[1, '1st year'], [2, '2nd year'], [3, '3rd year'], [4, '4th year'], [5, '5th year']]) }),
    num('hours', 'Study hours per week', { w: 5, d: 1 }),
    num('sleep', 'Average sleep (hours/night)', { w: 4, d: 1 }),
    num('satisf', 'Satisfaction with studies', { w: 1, measure: 'ordinal', vl: vl([[1, 'Very dissatisfied'], [2, 'Dissatisfied'], [3, 'Neutral'], [4, 'Satisfied'], [5, 'Very satisfied'], [9, 'No answer']]), missing: { values: [9] } }),
    num('stress', 'Perceived stress (0–40)', { w: 2 }),
    num('gpa', 'Grade point average', { w: 4, d: 2 }),
    num('job', 'Has a part-time job', { w: 1, measure: 'nominal', vl: vl([[0, 'No'], [1, 'Yes']]) }),
    str('commute', 'Main way of commuting', 10, { vl: vl([['walk', 'Walking'], ['bike', 'Bicycle'], ['transit', 'Public transport'], ['car', 'Car']]) }),
  ];
  const cols = vars.map(() => []);
  for (let i = 0; i < n; i++) {
    const gender = pick([1, 2, 3], [56, 40, 4]);
    const year = pick([1, 2, 3, 4, 5], [30, 25, 20, 15, 10]);
    const age = Math.max(18, Math.round(18 + year + normal(0.5, 1.6)));
    const faculty = pick([1, 2, 3, 4, 5], [28, 20, 24, 16, 12]);
    const hours = Math.max(2, round(normal(faculty === 4 ? 32 : 22, 7), 1));
    const job = rand() < 0.38 ? 1 : 0;
    const sleep = Math.max(4, Math.min(10, round(normal(7.4 - hours / 60 - job * 0.4, 0.9), 1)));
    const stress = Math.max(0, Math.min(40, Math.round(normal(12 + hours / 3 - (sleep - 7) * 2 + job * 2, 5))));
    const gpa = Math.max(1, Math.min(4, round(normal(2.6 + hours / 60 - stress / 80, 0.45), 2)));
    let satisf = Math.max(1, Math.min(5, Math.round(normal(4.1 - stress / 18 + (gpa - 2.5) * 0.4, 0.8))));
    if (rand() < 0.04) satisf = 9;
    const commute = pick(['walk', 'bike', 'transit', 'car'], [22, 15, 50, 13]);
    const row = [i + 1, gender, age, faculty, year, hours, rand() < 0.03 ? null : sleep, satisf, stress, rand() < 0.02 ? null : gpa, job, commute];
    row.forEach((v, k) => cols[k].push(v));
  }
  writeFileSync(new URL('../src/samples/students.json', import.meta.url), JSON.stringify({ name: 'Student survey', fileLabel: 'Student wellbeing survey 2025 (simulated)', variables: vars, columns: cols, weight: null, filter: null, split: [], documents: ['Simulated data generated for PSPP Studio demos.'] }));
}

// ---------- 2. Employee salaries
{
  const n = 200;
  const vars = [
    num('empid', 'Employee ID', { w: 5, measure: 'nominal', role: 'none' }),
    num('gender', 'Gender', { w: 1, measure: 'nominal', vl: vl([[0, 'Female'], [1, 'Male']]) }),
    { ...num('bdate', 'Date of birth', { w: 10 }), print: { type: 'EDATE', w: 10, d: 0 }, write: { type: 'EDATE', w: 10, d: 0 } },
    num('educ', 'Educational level (years)', { w: 2, measure: 'ordinal', vl: vl([[8, 'Primary'], [12, 'Secondary'], [15, 'Bachelor'], [17, 'Master'], [20, 'Doctorate']]) }),
    num('jobcat', 'Employment category', { w: 1, measure: 'nominal', vl: vl([[1, 'Clerical'], [2, 'Custodial'], [3, 'Manager']]) }),
    { ...num('salary', 'Current salary', { w: 9 }), print: { type: 'DOLLAR', w: 9, d: 0 }, write: { type: 'DOLLAR', w: 9, d: 0 } },
    { ...num('salbegin', 'Beginning salary', { w: 9 }), print: { type: 'DOLLAR', w: 9, d: 0 }, write: { type: 'DOLLAR', w: 9, d: 0 } },
    num('jobtime', 'Months since hire', { w: 3 }),
    num('prevexp', 'Previous experience (months)', { w: 3, missing: { values: [-1] } }),
    num('minority', 'Minority classification', { w: 1, measure: 'nominal', vl: vl([[0, 'No'], [1, 'Yes']]) }),
    str('dept', 'Department', 12, {}),
  ];
  const cols = vars.map(() => []);
  for (let i = 0; i < n; i++) {
    const gender = rand() < 0.55 ? 1 : 0;
    const jobcat = pick([1, 2, 3], [70, 12, 18]);
    const educ = jobcat === 3 ? pick([15, 17, 20], [40, 45, 15]) : jobcat === 2 ? pick([8, 12], [60, 40]) : pick([12, 15, 17], [55, 35, 10]);
    const prevexp = rand() < 0.03 ? -1 : Math.max(0, Math.round(normal(90, 80)));
    const salbegin = Math.round((jobcat === 3 ? normal(30000, 6000) : jobcat === 2 ? normal(15000, 1500) : normal(14000 + (educ - 12) * 900, 2500)) / 50) * 50;
    const jobtime = Math.round(63 + rand() * 35);
    const salary = Math.round((salbegin * (1.6 + rand() * 0.6) + gender * 2500 + normal(0, 2500)) / 50) * 50;
    const by = 1940 + Math.floor(rand() * 32);
    const dept = pick(['Sales', 'Finance', 'Operations', 'IT', 'HR'], [30, 15, 30, 15, 10]);
    const row = [1000 + i + 1, gender, pdate(by, 1 + Math.floor(rand() * 12), 1 + Math.floor(rand() * 28)), educ, jobcat, salary, salbegin, jobtime, prevexp, rand() < 0.22 ? 1 : 0, dept];
    row.forEach((v, k) => cols[k].push(v));
  }
  writeFileSync(new URL('../src/samples/employees.json', import.meta.url), JSON.stringify({ name: 'Employee data', fileLabel: 'Employee salary data (simulated)', variables: vars, columns: cols, weight: null, filter: null, split: [], documents: [] }));
}

// ---------- 3. Clinical trial (blood pressure)
{
  const n = 60;
  const vars = [
    num('patient', 'Patient number', { w: 3, measure: 'nominal', role: 'none' }),
    num('group', 'Treatment group', { w: 1, measure: 'nominal', vl: vl([[1, 'Placebo'], [2, 'Drug A'], [3, 'Drug B']]), role: 'input' }),
    num('sex', 'Sex', { w: 1, measure: 'nominal', vl: vl([[1, 'Female'], [2, 'Male']]) }),
    num('age', 'Age', { w: 3 }),
    num('bmi', 'Body mass index', { w: 5, d: 1 }),
    num('sbp0', 'Systolic BP at baseline (mmHg)', { w: 3 }),
    num('sbp4', 'Systolic BP after 4 weeks (mmHg)', { w: 3 }),
    num('sbp8', 'Systolic BP after 8 weeks (mmHg)', { w: 3, role: 'target' }),
    num('smoker', 'Smoker', { w: 1, measure: 'nominal', vl: vl([[0, 'No'], [1, 'Yes']]) }),
  ];
  const cols = vars.map(() => []);
  for (let i = 0; i < n; i++) {
    const group = (i % 3) + 1;
    const age = Math.round(normal(58, 9));
    const bmi = round(normal(28, 4), 1);
    const sbp0 = Math.round(normal(152 + (bmi - 28) * 0.8, 10));
    const eff = group === 1 ? 2 : group === 2 ? 9 : 14;
    const sbp4 = Math.round(sbp0 - eff * 0.6 + normal(0, 6));
    const sbp8 = rand() < 0.05 ? null : Math.round(sbp0 - eff + normal(0, 7));
    const row = [i + 1, group, rand() < 0.5 ? 1 : 2, age, bmi, sbp0, sbp4, sbp8, rand() < 0.25 ? 1 : 0];
    row.forEach((v, k) => cols[k].push(v));
  }
  writeFileSync(new URL('../src/samples/trial.json', import.meta.url), JSON.stringify({ name: 'Blood pressure trial', fileLabel: 'Randomised blood pressure trial (simulated)', variables: vars, columns: cols, weight: null, filter: null, split: [], documents: [] }));
}
console.log('ok');
