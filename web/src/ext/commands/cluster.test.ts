/*
 * CLUSTER (hierarchical cluster analysis) checked against scipy.cluster.hierarchy.
 *
 * SPSS conventions and how they map onto scipy (all verified below):
 * - the merged cluster keeps the lower case number; "Cluster 1" < "Cluster 2" are the lowest
 *   case numbers of the two clusters (scipy cluster ids are relabelled that way);
 * - BAVERAGE = scipy "average" (UPGMA); SINGLE/COMPLETE = "single"/"complete"; the
 *   coefficient is the merge height. WAVERAGE (average linkage WITHIN groups: merge the pair
 *   whose union has the smallest mean of all within-cluster proximities) has no scipy
 *   counterpart (scipy "weighted" is WPGMA/McQuitty, which SPSS does not offer); it is checked
 *   against a brute-force implementation of that definition;
 * - COSINE / PEARSON are similarities: scipy runs on 1 − s ("cosine"/"correlation") and the
 *   SPSS coefficient is 1 − height;
 * - CENTROID / MEDIAN / WARD apply the Lance–Williams update to the proximities themselves.
 *   scipy squares Euclidean input inside these updates, so with MEASURE=SEUCLID the SPSS
 *   coefficient is height² of scipy on Euclidean distances (and for MEASURE=EUCLID scipy is fed
 *   sqrt(Euclidean));
 * - WARD coefficient = total within-cluster sum of squares after the stage, i.e. the running
 *   sum of ΔESS = height²/2 (with SEUCLID, ½ × the Lance–Williams Ward distance);
 * - memberships: the k-cluster state after n − k stages, clusters numbered in order of first
 *   appearance in the file (fcluster maxclust for monotone methods; a replay of the merges for
 *   CENTROID, whose last stage here is an inversion, where cut_tree is wrong).
 * Test data have no tied proximities (asserted), so the merge order is unique; tie-breaking
 * (lowest cluster pair first, as SPSS) is checked on hand-computed cases.
 *
 * Reference values: scipy 1.x / numpy, script (python3 ref.py > ref.json):
 *
 *   import json, numpy as np
 *   from scipy.cluster.hierarchy import linkage, fcluster
 *   from scipy.spatial.distance import pdist, squareform
 *
 *   def schedule(Z, n, coef):
 *       lab = {i: i + 1 for i in range(n)}
 *       out = []
 *       for s, (a, b, h, _) in enumerate(Z):
 *           la, lb = lab[int(a)], lab[int(b)]
 *           out.append([min(la, lb), max(la, lb), round(float(coef(s, h)), 6)])
 *           lab[n + s] = min(la, lb)
 *       return out
 *
 *   def first_next(sch):
 *       last = {}; rows = []
 *       for s, (c1, c2, _) in enumerate(sch, 1):
 *           rows.append([last.get(c1, 0), last.get(c2, 0), 0])
 *           for c in (c1, c2):
 *               if last.get(c): rows[last[c] - 1][2] = s
 *           last[c1] = s
 *       return rows
 *
 *   def renumber(lab):
 *       m = {}; return [m.setdefault(x, len(m) + 1) for x in lab]
 *
 *   def replay(Z, k):  # state after n-k merges, in merge order (cut_tree mishandles inversions)
 *       n = len(Z) + 1; members = {i: [i] for i in range(n)}
 *       for s in range(n - k):
 *           a, b = int(Z[s, 0]), int(Z[s, 1]); members[n + s] = members.pop(a) + members.pop(b)
 *       lab = [0] * n
 *       for c, ms in members.items():
 *           for i in ms: lab[i] = c
 *       return lab
 *
 *   def members(Z, k, monotone):
 *       lab = fcluster(Z, k, 'maxclust') if monotone else replay(Z, k)
 *       return renumber(list(lab))
 *
 *   def waverage(D):  # definition: merge the pair whose union has the smallest mean within proximity
 *       n = D.shape[0]; cl = [[i] for i in range(n)]; out = []
 *       while len(cl) > 1:
 *           best = None
 *           for a in range(len(cl)):
 *               for b in range(a + 1, len(cl)):
 *                   u = cl[a] + cl[b]
 *                   v = np.mean([D[i, j] for x, i in enumerate(u) for j in u[x + 1:]])
 *                   key = (v, min(cl[a]), min(cl[b]))
 *                   if best is None or key < best[0]: best = (key, a, b)
 *           (v, _, _), a, b = best
 *           c1, c2 = sorted((min(cl[a]) + 1, min(cl[b]) + 1))
 *           out.append([c1, c2, round(float(v), 6)])
 *           cl[a] = cl[a] + cl[b]; del cl[b]
 *       return out
 *
 *   def run(X, cases):
 *       n = len(X); res = {}
 *       for metric, kw, mm in [('sqeuclidean', {}, 'SEUCLID'), ('euclidean', {}, 'EUCLID'), ('cityblock', {}, 'BLOCK'),
 *                              ('chebyshev', {}, 'CHEBYCHEV'), ('minkowski', {'p': 3}, 'MINKOWSKI(3)'),
 *                              ('cosine', {}, 'COSINE'), ('correlation', {}, 'PEARSON')]:
 *           d = pdist(X, metric, **kw)
 *           sim = metric in ('cosine', 'correlation')
 *           for method, sp in [('single', 'SINGLE'), ('complete', 'COMPLETE'), ('average', 'BAVERAGE')]:
 *               Z = linkage(d, method)
 *               res[f'{mm} {sp}'] = schedule(Z, n, (lambda s, h: 1 - h) if sim else (lambda s, h: h))
 *           if not sim:
 *               res[f'{mm} WAVERAGE'] = waverage(squareform(d))
 *       # centroid / median / ward on squared Euclidean distances: scipy works on Euclidean distances
 *       # and squares them inside the Lance-Williams update, so SPSS's SEUCLID coefficient = height².
 *       de = pdist(X, 'euclidean')
 *       for method, sp in [('centroid', 'CENTROID'), ('median', 'MEDIAN')]:
 *           Z = linkage(de, method); res[f'SEUCLID {sp}'] = schedule(Z, n, lambda s, h: h * h)
 *       Zw = linkage(de, 'ward')
 *       ess = np.cumsum(Zw[:, 2] ** 2 / 2)  # Ward: ΔESS = height²/2, SPSS reports the running total
 *       res['SEUCLID WARD'] = schedule(Zw, n, lambda s, h: ess[s])
 *       # Lance-Williams applied to plain Euclidean distances (SPSS MEASURE=EUCLID): feed sqrt(d).
 *       Zc = linkage(np.sqrt(de), 'centroid'); res['EUCLID CENTROID'] = schedule(Zc, n, lambda s, h: h * h)
 *       Zw2 = linkage(np.sqrt(de), 'ward'); e2 = np.cumsum(Zw2[:, 2] ** 2 / 2)
 *       res['EUCLID WARD'] = schedule(Zw2, n, lambda s, h: e2[s])
 *       mem = {}
 *       for method, mono in [('ward', True), ('average', True), ('single', True), ('complete', True), ('centroid', False)]:
 *           Z = linkage(de if method in ('ward', 'centroid') else pdist(X, 'sqeuclidean'), method)
 *           mem[method] = {k: members(Z, k, mono) for k in cases}
 *       return res, mem
 *
 *   hand = np.array([[5.12, 9.5, 1.44], [9.49, 3.12, 4.23], [8.28, 4.09, 5.5], [0.28, 7.54, 5.38], [3.3, 7.88, 3.03],
 *                    [4.53, 1.34, 4.03], [2.03, 2.62, 7.5], [2.8, 4.85, 9.81], [9.62, 7.25, 5.41], [2.77, 1.61, 9.7]])
 *   d = json.load(open('/home/user/PSPP/web/src/samples/students.json'))
 *   col = {v['name']: d['columns'][i] for i, v in enumerate(d['variables'])}
 *   stud = np.array([[col['hours'][r], col['sleep'][r], col['gpa'][r]] for r in range(30)], float)
 *   # no tied proximities, so the merge order is unique (scipy and SPSS break ties differently)
 *   for name, X, ms in [('hand', hand, ['euclidean', 'chebyshev', 'cityblock', 'cosine', 'correlation', 'minkowski']), ('students', stud, ['euclidean', 'cosine'])]:
 *       for m in ms:
 *           dd = pdist(X, m); assert len(np.unique(np.round(dd, 9))) == len(dd), (name, m)
 *   hres, hmem = run(hand, [2, 3, 4])
 *   sres, smem = run(stud, [2, 3, 5])
 *   print(json.dumps({'hand': hres, 'handFirstNext': first_next(hres['SEUCLID WARD']), 'handMem': hmem,
 *                     'students': {k: v for k, v in sres.items() if k.split()[0] in ('SEUCLID', 'EUCLID', 'COSINE')}, 'studentsMem': smem}, separators=(',', ':')))
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import students from '../../samples/students.json';
import type { Cell, Dataset, OutputItem } from '../../engine/types';
import { makeVariable } from '../../lib/variables';
import { parseChart } from '../../charts/types';
import { runExtCommandFull } from '../runner';
import { ctxFor, errorsOf, flatItems, haveEngine, runExt, runMixed, tables } from '../testing';
import { agglomerate, membership, proximityMatrix, rescale, type Measure, type Method } from './cluster';

// [cluster 1, cluster 2, coefficient] per stage, keyed "MEASURE METHOD"
const HAND: Record<string, number[][]> = {
  "SEUCLID SINGLE": [[2,3,4.0179],[7,10,6.4077],[1,5,8.4649],[7,8,10.5106],[2,9,11.7893],[1,4,14.7585],[6,7,19.9293],[2,6,23.7859],[1,2,31.7633]],
  "SEUCLID COMPLETE": [[2,3,4.0179],[7,10,6.4077],[1,5,8.4649],[7,8,10.9019],[2,9,18.4662],[1,4,42.7908],[6,7,48.7214],[2,6,97.1362],[1,2,136.0022]],
  "SEUCLID BAVERAGE": [[2,3,4.0179],[7,10,6.4077],[1,5,8.4649],[7,8,10.70625],[2,9,15.12775],[1,4,28.77465],[6,7,34.6567],[2,6,61.492958],[1,2,66.888871]],
  "SEUCLID WAVERAGE": [[2,3,4.0179],[7,10,6.4077],[1,5,8.4649],[7,8,9.2734],[2,9,11.424467],[6,7,21.96505],[1,4,22.004733],[2,6,43.046629],[1,2,52.770216]],
  "EUCLID SINGLE": [[2,3,2.00447],[7,10,2.531344],[1,5,2.90945],[7,8,3.242006],[2,9,3.433555],[1,4,3.841679],[6,7,4.464224],[2,6,4.877079],[1,2,5.635894]],
  "EUCLID COMPLETE": [[2,3,2.00447],[7,10,2.531344],[1,5,2.90945],[7,8,3.301803],[2,9,4.297232],[1,4,6.541468],[6,7,6.980072],[2,6,9.85577],[1,2,11.661998]],
  "EUCLID BAVERAGE": [[2,3,2.00447],[7,10,2.531344],[1,5,2.90945],[7,8,3.271904],[2,9,3.865393],[1,4,5.191574],[6,7,5.79577],[2,6,7.70486],[1,2,8.036149]],
  "EUCLID WAVERAGE": [[2,3,2.00447],[7,10,2.531344],[1,5,2.90945],[7,8,3.025051],[2,9,3.245086],[6,7,4.41041],[1,4,4.430866],[2,6,6.126478],[1,2,6.904617]],
  "BLOCK SINGLE": [[8,10,3.38],[2,3,3.45],[7,8,3.95],[2,9,4.59],[1,5,5.03],[1,4,5.71],[2,6,6.94],[2,7,7.25],[1,2,8.77]],
  "BLOCK COMPLETE": [[8,10,3.38],[2,3,3.45],[1,5,5.03],[7,8,5.31],[2,9,5.44],[1,4,10.74],[6,7,11.02],[1,2,14.78],[1,6,18.5]],
  "BLOCK BAVERAGE": [[8,10,3.38],[2,3,3.45],[7,8,4.63],[2,9,5.015],[1,5,5.03],[1,4,8.225],[6,7,8.656667],[1,2,11.735556],[1,6,12.13]],
  "BLOCK WAVERAGE": [[8,10,3.38],[2,3,3.45],[7,8,4.213333],[2,9,4.493333],[1,5,5.03],[6,7,6.435],[1,4,7.16],[2,6,9.308571],[1,2,10.451333]],
  "CHEBYCHEV SINGLE": [[2,3,1.27],[1,5,1.82],[7,10,2.2],[7,8,2.31],[1,4,3.02],[2,9,3.16],[6,7,3.47],[2,6,3.75],[1,2,4.43]],
  "CHEBYCHEV COMPLETE": [[2,3,1.27],[1,5,1.82],[7,10,2.2],[7,8,3.24],[2,9,4.13],[1,4,4.84],[6,7,5.78],[2,6,7.59],[1,2,9.34]],
  "CHEBYCHEV BAVERAGE": [[2,3,1.27],[1,5,1.82],[7,10,2.2],[7,8,2.775],[2,9,3.645],[1,4,3.93],[2,6,4.873333],[2,7,6.190833],[1,2,6.60619]],
  "CHEBYCHEV WAVERAGE": [[2,3,1.27],[1,5,1.82],[7,10,2.2],[7,8,2.583333],[2,9,2.853333],[1,4,3.226667],[6,7,3.778333],[2,6,5.010476],[1,2,5.636222]],
  "MINKOWSKI(3) SINGLE": [[2,3,1.678935],[7,10,2.294728],[1,5,2.427223],[7,8,2.879382],[2,9,3.238383],[1,4,3.43586],[6,7,3.904052],[2,6,4.248932],[1,2,4.965177]],
  "MINKOWSKI(3) COMPLETE": [[2,3,1.678935],[7,10,2.294728],[1,5,2.427223],[7,8,3.240043],[2,9,4.161905],[1,4,5.667803],[6,7,6.227572],[2,6,8.338491],[1,2,10.22078]],
  "MINKOWSKI(3) BAVERAGE": [[2,3,1.678935],[7,10,2.294728],[1,5,2.427223],[7,8,3.059712],[2,9,3.700144],[1,4,4.551831],[6,7,5.285932],[2,6,6.872203],[1,2,7.262347]],
  "MINKOWSKI(3) WAVERAGE": [[2,3,1.678935],[7,10,2.294728],[1,5,2.427223],[7,8,2.804718],[2,9,3.026407],[1,4,3.843629],[6,7,4.045325],[2,6,5.515124],[1,2,6.219062]],
  "COSINE SINGLE": [[7,8,0.9929],[7,10,0.986005],[2,3,0.982814],[2,9,0.979724],[2,6,0.976175],[1,5,0.973951],[1,4,0.912395],[1,2,0.87945],[1,7,0.86103]],
  "COSINE COMPLETE": [[7,8,0.9929],[2,3,0.982814],[1,5,0.973951],[7,10,0.959516],[2,9,0.954933],[2,6,0.915841],[1,4,0.800956],[2,7,0.652779],[1,2,0.390624]],
  "COSINE BAVERAGE": [[7,8,0.9929],[2,3,0.982814],[1,5,0.973951],[7,10,0.972761],[2,9,0.967329],[2,6,0.948442],[1,4,0.856675],[2,7,0.752889],[1,2,0.678]],
  "PEARSON SINGLE": [[2,3,0.98504],[7,8,0.982014],[7,10,0.973348],[1,5,0.911472],[2,6,0.845152],[2,9,0.816846],[1,4,0.694676],[1,7,0.495181],[1,2,0.488478]],
  "PEARSON COMPLETE": [[2,3,0.98504],[7,8,0.982014],[7,10,0.91254],[1,5,0.911472],[2,6,0.740397],[1,4,0.337276],[2,9,0.217046],[1,7,-0.904444],[1,2,-0.999071]],
  "PEARSON BAVERAGE": [[2,3,0.98504],[7,8,0.982014],[7,10,0.942944],[1,5,0.911472],[2,6,0.792775],[2,9,0.579704],[1,4,0.515976],[1,7,-0.312311],[1,2,-0.444694]],
  "SEUCLID CENTROID": [[2,3,4.0179],[7,10,6.4077],[1,5,8.4649],[7,8,9.104325],[2,9,14.123275],[1,4,26.658425],[6,7,31.565567],[2,6,49.447909],[1,2,41.105405]],
  "SEUCLID MEDIAN": [[2,3,4.0179],[7,10,6.4077],[1,5,8.4649],[7,8,9.104325],[2,9,14.123275],[1,4,26.658425],[6,7,35.095831],[1,6,42.171264],[1,2,40.3234]],
  "SEUCLID WARD": [[2,3,2.00895],[7,10,5.2128],[1,5,9.44525],[7,8,15.5148],[2,9,24.930317],[1,4,42.7026],[6,7,66.376775],[1,2,147.495408],[1,6,237.46597]],
  "EUCLID CENTROID": [[2,3,2.00447],[7,10,2.531344],[7,8,2.639068],[1,5,2.90945],[2,9,3.364276],[1,4,4.464211],[6,7,4.787419],[1,6,4.945382],[1,2,3.953053]],
  "EUCLID WARD": [[2,3,1.002235],[7,10,2.267907],[1,5,3.722632],[7,8,5.482011],[2,9,7.724861],[1,4,10.701002],[6,7,14.291566],[1,2,22.427628],[1,6,31.070775]],
};
const STUDENTS: Record<string, number[][]> = {
  "SEUCLID SINGLE": [[3,4,0.2],[7,21,0.2161],[1,8,0.4325],[7,13,0.4925],[6,19,0.5025],[6,15,0.5225],[17,26,0.6464],[7,24,0.75],[7,10,0.7569],[7,18,1.1525],[3,5,1.5384],[11,29,1.5444],[11,25,1.6025],[3,11,1.6281],[17,27,1.6361],[3,20,1.7261],[7,23,1.7421],[12,30,1.7489],[1,6,1.8056],[14,16,1.9829],[2,7,2.2629],[2,3,2.6024],[17,22,2.6329],[1,2,3.1016],[1,28,6.9349],[1,14,7.2344],[1,12,8.2676],[9,17,12.8729],[1,9,25.8164]],
  "SEUCLID COMPLETE": [[3,4,0.2],[7,21,0.2161],[1,8,0.4325],[6,19,0.5025],[17,26,0.6464],[6,15,0.69],[7,10,0.8036],[13,24,1.1476],[11,29,1.5444],[3,5,1.7144],[12,30,1.7489],[14,16,1.9829],[7,18,2.5224],[22,27,2.6329],[2,23,3.0936],[7,13,3.4901],[3,25,3.6841],[11,20,3.6949],[1,6,5.7176],[2,7,8.2589],[3,11,8.7869],[17,22,8.9744],[12,28,13.7225],[12,14,14.7521],[1,2,36.7241],[9,17,37.7529],[1,3,110.54],[1,12,265.8621],[1,9,752.2676]],
  "SEUCLID BAVERAGE": [[3,4,0.2],[7,21,0.2161],[1,8,0.4325],[6,19,0.5025],[6,15,0.60625],[17,26,0.6464],[7,13,0.72505],[7,24,1.0179],[10,18,1.1525],[11,29,1.5444],[3,5,1.6264],[12,30,1.7489],[14,16,1.9829],[7,10,2.09025],[17,27,2.2241],[3,25,2.417433],[11,20,2.7105],[2,23,3.0936],[1,6,3.519183],[2,7,4.345467],[3,11,5.751008],[17,22,6.482967],[14,28,10.99325],[12,14,12.308183],[1,2,17.8545],[9,17,21.072475],[1,3,36.986149],[1,12,97.258168],[1,9,240.323575]],
  "SEUCLID WAVERAGE": [[3,4,0.2],[7,21,0.2161],[1,8,0.4325],[6,19,0.5025],[7,13,0.5554],[6,15,0.571667],[17,26,0.6464],[7,24,0.78665],[7,10,1.07264],[3,5,1.150933],[7,18,1.506293],[11,29,1.5444],[17,27,1.6982],[12,30,1.7489],[3,25,1.784183],[14,16,1.9829],[2,7,2.184724],[11,20,2.3218],[1,6,2.32626],[2,23,2.779771],[17,22,4.090583],[3,11,4.127743],[1,28,6.203067],[12,14,8.414667],[9,17,10.88334],[2,3,11.653747],[1,12,18.621724],[1,2,46.976942],[1,9,101.706581]],
  "EUCLID SINGLE": [[3,4,0.447214],[7,21,0.464866],[1,8,0.657647],[7,13,0.701783],[6,19,0.708872],[6,15,0.722842],[17,26,0.80399],[7,24,0.866025],[7,10,0.87],[7,18,1.073546],[3,5,1.240323],[11,29,1.242739],[11,25,1.265899],[3,11,1.27597],[17,27,1.279101],[3,20,1.313811],[7,23,1.319886],[12,30,1.32246],[1,6,1.343726],[14,16,1.408155],[2,7,1.504294],[2,3,1.613196],[17,22,1.622621],[1,2,1.761136],[1,28,2.63342],[1,14,2.689684],[1,12,2.875343],[9,17,3.587882],[1,9,5.080984]],
  "EUCLID COMPLETE": [[3,4,0.447214],[7,21,0.464866],[1,8,0.657647],[6,19,0.708872],[17,26,0.80399],[6,15,0.830662],[7,10,0.896437],[13,24,1.071261],[11,29,1.242739],[3,5,1.309351],[12,30,1.32246],[14,16,1.408155],[7,18,1.588207],[22,27,1.622621],[2,23,1.758863],[7,13,1.868181],[3,25,1.919401],[11,20,1.922212],[1,6,2.39115],[2,7,2.87383],[3,11,2.964271],[17,22,2.99573],[12,28,3.704389],[12,14,3.840846],[1,2,6.060041],[9,17,6.144339],[1,3,10.5138],[1,12,16.305278],[1,9,27.427497]],
  "EUCLID BAVERAGE": [[3,4,0.447214],[7,21,0.464866],[1,8,0.657647],[6,19,0.708872],[6,15,0.776752],[17,26,0.80399],[7,13,0.840177],[7,24,1.004169],[10,18,1.073546],[11,29,1.242739],[3,5,1.274837],[12,30,1.32246],[7,10,1.405469],[14,16,1.408155],[17,27,1.478016],[3,25,1.529415],[11,20,1.618012],[2,23,1.758863],[1,6,1.845669],[2,7,2.040784],[3,11,2.329797],[17,22,2.472879],[14,28,3.265265],[12,14,3.493335],[1,2,4.070858],[9,17,4.470326],[1,3,5.6185],[1,12,9.266292],[1,9,14.654513]],
  "EUCLID WAVERAGE": [[3,4,0.447214],[7,21,0.464866],[1,8,0.657647],[6,19,0.708872],[7,13,0.715073],[6,15,0.754125],[17,26,0.80399],[7,24,0.859621],[7,10,0.98792],[3,5,0.998962],[7,18,1.165002],[11,29,1.242739],[17,27,1.253341],[3,25,1.264189],[12,30,1.32246],[2,7,1.387685],[1,6,1.399404],[14,16,1.408155],[11,20,1.492921],[2,23,1.561547],[17,22,1.86311],[3,11,1.905784],[1,28,2.141666],[12,14,2.721613],[9,17,2.905996],[2,3,3.003694],[1,12,3.821755],[1,2,5.762356],[1,9,8.25191]],
  "COSINE SINGLE": [[3,20,0.99997],[10,13,0.999968],[22,27,0.999955],[1,6,0.99995],[3,5,0.999891],[7,10,0.99989],[3,4,0.999857],[3,7,0.999845],[8,24,0.99984],[11,25,0.999839],[3,21,0.999836],[3,23,0.999808],[3,8,0.999757],[17,26,0.999755],[3,14,0.999744],[17,22,0.999728],[9,17,0.999683],[28,30,0.999678],[11,29,0.999655],[1,3,0.999635],[9,11,0.999622],[1,2,0.999569],[16,18,0.999568],[15,19,0.999432],[1,15,0.999402],[1,16,0.999255],[1,9,0.999095],[12,28,0.995959],[1,12,0.994995]],
  "COSINE COMPLETE": [[3,20,0.99997],[10,13,0.999968],[22,27,0.999955],[1,6,0.99995],[4,5,0.999857],[8,24,0.99984],[11,25,0.999839],[7,21,0.999836],[17,26,0.999755],[3,4,0.999701],[28,30,0.999678],[16,18,0.999568],[10,23,0.999554],[1,14,0.999433],[15,19,0.999432],[9,17,0.999393],[2,8,0.999379],[22,29,0.999288],[7,10,0.999282],[11,22,0.999012],[1,2,0.998604],[3,7,0.997886],[9,11,0.996745],[1,15,0.996186],[3,16,0.995538],[12,28,0.995352],[1,3,0.98587],[1,9,0.96106],[1,12,0.919197]],
  "COSINE BAVERAGE": [[3,20,0.99997],[10,13,0.999968],[22,27,0.999955],[1,6,0.99995],[4,5,0.999857],[8,24,0.99984],[11,25,0.999839],[7,21,0.999836],[3,4,0.999808],[17,26,0.999755],[7,10,0.9997],[28,30,0.999678],[7,23,0.999596],[16,18,0.999568],[9,17,0.999538],[1,14,0.999523],[22,29,0.999443],[2,8,0.999435],[15,19,0.999432],[11,22,0.999319],[3,7,0.999264],[1,2,0.999261],[9,11,0.998323],[1,15,0.997973],[3,16,0.997671],[12,28,0.995656],[1,3,0.994903],[1,9,0.988114],[1,12,0.967711]],
  "SEUCLID CENTROID": [[3,4,0.2],[7,21,0.2161],[1,8,0.4325],[6,19,0.5025],[6,15,0.480625],[17,26,0.6464],[7,13,0.671025],[7,24,0.832767],[10,18,1.1525],[7,10,1.507131],[11,29,1.5444],[3,5,1.5764],[12,30,1.7489],[14,16,1.9829],[3,25,2.033789],[17,27,2.0625],[11,20,2.3244],[2,23,3.0936],[2,7,2.944444],[1,6,3.220503],[3,11,4.308006],[17,22,5.9169],[14,28,10.497525],[12,14,9.207692],[1,2,15.707846],[9,17,19.538506],[1,3,30.392997],[1,12,82.606226],[1,9,213.421307]],
  "SEUCLID MEDIAN": [[3,4,0.2],[7,21,0.2161],[1,8,0.4325],[6,19,0.5025],[6,15,0.480625],[17,26,0.6464],[7,13,0.671025],[7,24,0.855556],[10,18,1.1525],[11,29,1.5444],[3,5,1.5764],[12,30,1.7489],[7,10,1.884252],[14,16,1.9829],[17,27,2.0625],[3,25,2.315],[11,20,2.3244],[2,23,3.0936],[2,7,2.846182],[1,6,3.217506],[3,11,4.30965],[17,22,4.924025],[14,28,10.497525],[12,14,9.308281],[1,2,11.252307],[9,17,25.757056],[1,3,40.538913],[1,12,100.507358],[1,9,328.414869]],
  "SEUCLID WARD": [[3,4,0.1],[7,21,0.20805],[1,8,0.4243],[6,19,0.67555],[6,15,0.995967],[17,26,1.319167],[7,13,1.766517],[10,18,2.342767],[7,24,2.967342],[11,29,3.739542],[12,30,4.613992],[14,16,5.605442],[3,5,6.656375],[22,27,7.972825],[3,25,9.498167],[2,23,11.044967],[11,20,12.594567],[7,10,14.604075],[1,2,17.9226],[17,22,22.418825],[6,28,28.742333],[3,11,36.127487],[12,14,46.883587],[1,7,61.316969],[9,17,76.947774],[6,12,111.030386],[1,3,196.913891],[1,6,585.489984],[1,9,1474.74543]],
  "EUCLID CENTROID": [[3,4,0.447214],[7,21,0.464866],[1,8,0.657647],[6,19,0.708872],[6,15,0.599534],[7,13,0.723961],[7,24,0.765811],[17,26,0.80399],[7,10,0.85801],[7,18,1.123998],[3,5,1.163033],[3,25,1.196428],[11,29,1.242739],[17,27,1.277019],[11,20,1.307327],[12,30,1.32246],[3,11,1.358085],[14,16,1.408155],[1,6,1.429883],[2,7,1.458975],[2,23,1.48841],[17,22,2.055099],[2,3,2.636543],[12,14,2.717112],[12,28,2.452264],[1,12,3.341944],[9,17,3.77166],[1,2,5.154087],[1,9,10.726183]],
  "EUCLID WARD": [[3,4,0.223607],[7,21,0.45604],[1,8,0.784863],[6,19,1.139299],[6,15,1.538989],[17,26,1.940984],[7,13,2.423624],[10,18,2.960397],[7,24,3.534755],[11,29,4.156125],[12,30,4.817355],[14,16,5.521432],[3,5,6.296788],[22,27,7.108098],[11,20,7.97965],[2,23,8.859081],[3,25,9.756402],[2,10,10.810731],[17,22,12.39209],[2,7,14.097538],[1,6,15.813397],[14,28,17.755548],[3,11,20.083695],[12,14,22.820467],[9,17,25.837795],[1,12,34.192655],[2,3,44.035748],[1,2,74.96027],[1,9,119.652699]],
};
// [first appears 1, first appears 2, next stage] of HAND "SEUCLID WARD"
const HAND_FIRST_NEXT = [[0,0,5],[0,0,4],[0,0,6],[2,0,7],[1,0,8],[3,0,8],[0,4,9],[6,5,9],[8,7,0]];
// memberships by linkage (SEUCLID) and number of clusters
const HAND_MEM: Record<string, Record<string, number[]>> = {
  ward: {
    2: [1,1,1,1,1,2,2,2,1,2],
    3: [1,2,2,1,1,3,3,3,2,3],
    4: [1,2,2,1,1,3,4,4,2,4],
  },
  average: {
    2: [1,2,2,1,1,2,2,2,2,2],
    3: [1,2,2,1,1,3,3,3,2,3],
    4: [1,2,2,1,1,3,4,4,2,4],
  },
  single: {
    2: [1,2,2,1,1,2,2,2,2,2],
    3: [1,2,2,1,1,3,3,3,2,3],
    4: [1,2,2,1,1,3,4,4,2,4],
  },
  complete: {
    2: [1,2,2,1,1,2,2,2,2,2],
    3: [1,2,2,1,1,3,3,3,2,3],
    4: [1,2,2,1,1,3,4,4,2,4],
  },
  centroid: {
    2: [1,2,2,1,1,2,2,2,2,2],
    3: [1,2,2,1,1,3,3,3,2,3],
    4: [1,2,2,1,1,3,4,4,2,4],
  },
};
const STUDENTS_MEM: Record<string, Record<string, number[]>> = {
  ward: {
    2: [1,1,1,1,1,1,1,1,2,1,1,1,1,1,1,1,2,1,1,1,1,2,1,1,1,2,2,1,1,1],
    3: [1,1,1,1,1,2,1,1,3,1,1,2,1,2,2,2,3,1,2,1,1,3,1,1,1,3,3,2,1,2],
    5: [1,1,2,2,2,3,1,1,4,1,2,5,1,5,3,5,4,1,3,2,1,4,1,1,2,4,4,3,2,5],
  },
  average: {
    2: [1,1,1,1,1,1,1,1,2,1,1,1,1,1,1,1,2,1,1,1,1,2,1,1,1,2,2,1,1,1],
    3: [1,1,1,1,1,1,1,1,2,1,1,3,1,3,1,3,2,1,1,1,1,2,1,1,1,2,2,3,1,3],
    5: [1,1,2,2,2,1,1,1,3,1,2,4,1,4,1,4,5,1,1,2,1,5,1,1,2,5,5,4,2,4],
  },
  single: {
    2: [1,1,1,1,1,1,1,1,2,1,1,1,1,1,1,1,2,1,1,1,1,2,1,1,1,2,2,1,1,1],
    3: [1,1,1,1,1,1,1,1,2,1,1,1,1,1,1,1,3,1,1,1,1,3,1,1,1,3,3,1,1,1],
    5: [1,1,1,1,1,1,1,1,2,1,1,3,1,4,1,4,5,1,1,1,1,5,1,1,1,5,5,1,1,3],
  },
  complete: {
    2: [1,1,1,1,1,1,1,1,2,1,1,1,1,1,1,1,2,1,1,1,1,2,1,1,1,2,2,1,1,1],
    3: [1,1,1,1,1,1,1,1,2,1,1,3,1,3,1,3,2,1,1,1,1,2,1,1,1,2,2,3,1,3],
    5: [1,1,2,2,2,1,1,1,3,1,2,4,1,4,1,4,5,1,1,2,1,5,1,1,2,5,5,4,2,4],
  },
  centroid: {
    2: [1,1,1,1,1,1,1,1,2,1,1,1,1,1,1,1,2,1,1,1,1,2,1,1,1,2,2,1,1,1],
    3: [1,1,1,1,1,1,1,1,2,1,1,3,1,3,1,3,2,1,1,1,1,2,1,1,1,2,2,3,1,3],
    5: [1,1,2,2,2,1,1,1,3,1,2,4,1,4,1,4,5,1,1,2,1,5,1,1,2,5,5,4,2,4],
  },
};

const HAND_X = [
  [5.12, 9.5, 1.44], [9.49, 3.12, 4.23], [8.28, 4.09, 5.5], [0.28, 7.54, 5.38], [3.3, 7.88, 3.03],
  [4.53, 1.34, 4.03], [2.03, 2.62, 7.5], [2.8, 4.85, 9.81], [9.62, 7.25, 5.41], [2.77, 1.61, 9.7],
];

function mk(cols: Record<string, Cell[]>, extra: Partial<Dataset> = {}): Dataset {
  const names = Object.keys(cols);
  return {
    name: 't',
    variables: names.map((n) => makeVariable(n, typeof cols[n].find((x) => x !== null) === 'string' ? { type: 'string', width: 8 } : {})),
    columns: names.map((n) => cols[n]),
    ...extra,
  };
}
const handDs = () => mk({ x: HAND_X.map((r) => r[0]), y: HAND_X.map((r) => r[1]), z: HAND_X.map((r) => r[2]) });

function measureOf(s: string): Measure {
  const m = /^(\w+)(?:\((\d+)\))?$/.exec(s)!;
  return { kind: m[1] as Measure['kind'], p: m[2] ? Number(m[2]) : undefined };
}
function compute(X: number[][], key: string) {
  const [ms, method] = key.split(' ');
  const m = measureOf(ms);
  return agglomerate(proximityMatrix(X, m), X.length, method as Method, m.kind === 'COSINE' || m.kind === 'PEARSON');
}
function expectSchedule(got: { c1: number; c2: number; coef: number }[], ref: number[][], key: string) {
  expect(got.length, key).toBe(ref.length);
  ref.forEach(([c1, c2, coef], i) => {
    expect([got[i].c1, got[i].c2], `${key} stage ${i + 1}`).toEqual([c1, c2]);
    expect(got[i].coef, `${key} stage ${i + 1}`).toBeCloseTo(coef, 5);
  });
}
/** Agglomeration schedule body rows as numbers [stage, c1, c2, coef, first1, first2, next]. */
function scheduleRows(items: OutputItem[], which = 0): number[][] {
  const t = tables(items).filter((x) => x.caption === 'Agglomeration Schedule')[which];
  return t.rows.filter((r) => r[0].header && /^\d+$/.test(r[0].text) && !r[1].header).map((r) => r.map((c) => c.num ?? NaN));
}
const messages = (items: OutputItem[], sev: string) => flatItems(items).flatMap((i) => (i.kind === 'message' && i.severity === sev ? [i.text] : []));

describe('CLUSTER algorithm vs scipy', () => {
  it('hand data: every measure × method', () => {
    for (const [key, ref] of Object.entries(HAND)) expectSchedule(compute(HAND_X, key), ref, key);
  });

  it('students (first 30 cases: hours, sleep, gpa)', () => {
    const ds = students as unknown as Dataset;
    const col = (n: string) => ds.columns[ds.variables.findIndex((v) => v.name === n)] as number[];
    const X = Array.from({ length: 30 }, (_, r) => [col('hours')[r], col('sleep')[r], col('gpa')[r]]);
    for (const [key, ref] of Object.entries(STUDENTS)) expectSchedule(compute(X, key), ref, key);
    for (const [method, byK] of Object.entries(STUDENTS_MEM)) {
      const st = compute(X, method === 'average' ? 'SEUCLID BAVERAGE' : `SEUCLID ${method.toUpperCase()}`);
      for (const [k, ref] of Object.entries(byK)) expect(membership(st, 30, Number(k)), `${method} ${k}`).toEqual(ref);
    }
  });

  it('stage cluster first appears / next stage', () => {
    const st = compute(HAND_X, 'SEUCLID WARD');
    expect(st.map((s) => [s.first1, s.first2, s.next])).toEqual(HAND_FIRST_NEXT);
  });

  it('memberships (fcluster / merge replay)', () => {
    for (const [method, byK] of Object.entries(HAND_MEM)) {
      const st = compute(HAND_X, method === 'average' ? 'SEUCLID BAVERAGE' : `SEUCLID ${method.toUpperCase()}`);
      for (const [k, ref] of Object.entries(byK)) expect(membership(st, 10, Number(k)), `${method} ${k}`).toEqual(ref);
    }
  });

  it('ties: the lowest cluster pair merges first', () => {
    // 1-D points 0 1 2 3: squared distances 1 (three times), 4, 9
    const X = [[0], [1], [2], [3]];
    const D = proximityMatrix(X, { kind: 'SEUCLID' });
    const pairs = (m: Method) => agglomerate(D, 4, m).map((s) => [s.c1, s.c2, s.coef]);
    expect(pairs('SINGLE')).toEqual([[1, 2, 1], [1, 3, 1], [1, 4, 1]]);
    expect(pairs('COMPLETE')).toEqual([[1, 2, 1], [3, 4, 1], [1, 3, 9]]);
    // Ward: ESS 0.5, 1.0, then merging {1,2} and {3,4}: 2·2/4·(2)² = 4 → total 5
    expect(pairs('WARD')).toEqual([[1, 2, 0.5], [3, 4, 1], [1, 3, 5]]);
  });

  it('identical cases merge first at coefficient 0', () => {
    const st = agglomerate(proximityMatrix([[1, 2], [5, 5], [1, 2], [5, 5.5]], { kind: 'EUCLID' }), 4, 'BAVERAGE');
    expect(st[0]).toMatchObject({ c1: 1, c2: 3, coef: 0 });
    expect(st[1]).toMatchObject({ c1: 2, c2: 4, coef: 0.5 });
  });

  it('rescaled distances run from 1 to 25', () => {
    const st = compute(HAND_X, 'SEUCLID WARD');
    const r = rescale(st, false);
    expect(r[0]).toBe(1);
    expect(r[r.length - 1]).toBe(25);
    expect(rescale(compute(HAND_X, 'COSINE BAVERAGE'), true).at(-1)).toBe(25);
  });
});

describe('CLUSTER command', () => {
  it('SPSS output: case summary, schedule, membership, dendrogram', () => {
    const items = runExt('CLUSTER x y z /METHOD=WARD /MEASURE=SEUCLID /PRINT=SCHEDULE CLUSTER(2,4) /PLOT=DENDROGRAM.', handDs());
    expect(errorsOf(items)).toEqual([]);
    const ts = tables(items);
    expect(ts.map((t) => t.caption)).toEqual(['Case Processing Summary', 'Agglomeration Schedule', 'Cluster Membership']);
    const cps = ts[0].rows.at(-1)!.slice(1).map((c) => c.text);
    expect(cps).toEqual(['10', '100.0%', '0', '.0%', '10', '100.0%']);
    expect(ts[0].footnotes.join(' ')).toContain('Squared Euclidean Distance used');
    const rows = scheduleRows(items);
    expect(rows.length).toBe(9);
    rows.forEach((r, i) => {
      expect(r.slice(0, 3)).toEqual([i + 1, HAND['SEUCLID WARD'][i][0], HAND['SEUCLID WARD'][i][1]]);
      expect(r[3]).toBeCloseTo(HAND['SEUCLID WARD'][i][2], 3);
      expect(r.slice(4)).toEqual(HAND_FIRST_NEXT[i]);
    });
    const mem = ts[2];
    expect(mem.rows[0].map((c) => c.text)).toEqual(['Case', '4 Clusters', '3 Clusters', '2 Clusters']);
    expect(mem.rows.slice(1).map((r) => r[3].num)).toEqual(HAND_MEM.ward['2']);
    expect(mem.rows.slice(1).map((r) => r[1].num)).toEqual(HAND_MEM.ward['4']);
    const chart = flatItems(items).find((i) => i.kind === 'chart');
    expect(chart).toBeDefined();
    const spec = parseChart(chart);
    expect(spec.type).toBe('dendrogram');
    if (spec.type === 'dendrogram') {
      expect(spec.merges.length).toBe(9);
      expect(spec.merges[8].h).toBe(25);
      expect(spec.leaves.length).toBe(10);
    }
  });

  it('proximity matrix, cosine similarity, ID labels', () => {
    const ds = handDs();
    ds.variables.push(makeVariable('name', { type: 'string', width: 8 }));
    ds.columns.push(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
    const items = runExt('CLUSTER x y z /MEASURE=COSINE /ID=name /PRINT=DISTANCE SCHEDULE CLUSTER(3).', ds);
    const prox = tables(items).find((t) => t.caption === 'Proximity Matrix')!;
    expect(prox.footnotes).toEqual(['This is a similarity matrix']);
    expect(prox.rows[2][0].text).toBe('1:a');
    const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0) / Math.hypot(...a) / Math.hypot(...b);
    expect(prox.rows[2][2].num).toBeCloseTo(cos(HAND_X[0], HAND_X[1]), 3);
    expect(prox.rows[2][1].num).toBe(1);
    const rows = scheduleRows(items);
    HAND['COSINE BAVERAGE'].forEach(([c1, c2, coef], i) => {
      expect(rows[i].slice(1, 3)).toEqual([c1, c2]);
      expect(rows[i][3]).toBeCloseTo(coef, 3);
    });
    const mem = tables(items).find((t) => t.caption === 'Cluster Membership')!;
    expect(mem.rows[1][0].text).toBe('1:a');
  });

  it('MINKOWSKI(p), POWER(p,r) and abbreviations', () => {
    const r1 = scheduleRows(runExt('CLUSTER x y z /MEAS=MINKOWSKI(3) /METH=COMPLETE.', handDs()));
    HAND['MINKOWSKI(3) COMPLETE'].forEach(([c1, c2, coef], i) => expect([r1[i][1], r1[i][2], Math.round(r1[i][3] * 1000)]).toEqual([c1, c2, Math.round(coef * 1000)]));
    // POWER(2,1) = squared Euclidean
    const r2 = scheduleRows(runExt('CLUSTER x y z /MEASURE=POWER(2,1) /METHOD=SINGLE.', handDs()));
    HAND['SEUCLID SINGLE'].forEach(([c1, c2], i) => expect([r2[i][1], r2[i][2]]).toEqual([c1, c2]));
  });

  it('missing values are excluded listwise; MISSING=INCLUDE keeps user-missing', () => {
    const ds = handDs();
    ds.columns[0] = [...ds.columns[0]];
    ds.columns[0][3] = null;
    ds.columns[1] = [...ds.columns[1]];
    ds.columns[1][5] = 99;
    ds.variables[1] = { ...ds.variables[1], missing: { values: [99] } };
    let items = runExt('CLUSTER x y z.', ds);
    expect(tables(items)[0].rows.at(-1)!.slice(1).map((c) => c.text)).toEqual(['8', '80.0%', '2', '20.0%', '10', '100.0%']);
    // reference: the 8 remaining cases clustered alone
    const keep = [0, 1, 2, 4, 6, 7, 8, 9];
    const ref = compute(keep.map((r) => HAND_X[r]), 'SEUCLID BAVERAGE');
    const rows = scheduleRows(items);
    ref.forEach((s, i) => expect([rows[i][1], rows[i][2], rows[i][3]]).toEqual([s.c1, s.c2, Number(s.coef.toFixed(3))]));
    items = runExt('CLUSTER x y z /MISSING=INCLUDE.', ds);
    expect(tables(items)[0].rows.at(-1)![1].text).toBe('9');
  });

  it('n = 2 gives one stage; n = 1 warns', () => {
    const two = mk({ a: [1, 4], b: [2, 6] });
    const rows = scheduleRows(runExt('CLUSTER a b /PLOT=DENDROGRAM.', two));
    expect(rows).toEqual([[1, 1, 2, 25, 0, 0, 0]]);
    const one = runExt('CLUSTER a b.', mk({ a: [1, null], b: [2, 6] }));
    expect(errorsOf(one)).toEqual([]);
    expect(messages(one, 'warning').join(' ')).toMatch(/two cases/);
  });

  it('FILTER and SPLIT FILE', () => {
    const ds = handDs();
    ds.variables.push(makeVariable('f'), makeVariable('g'));
    ds.columns.push([1, 1, 1, 1, 1, 0, 1, 1, 1, 1], [1, 1, 1, 1, 1, 2, 2, 2, 2, 2]);
    // filter drops case 6
    let items = runExt('CLUSTER x y z /METHOD=SINGLE.', { ...ds, filter: 'f' });
    expect(tables(items)[0].rows.at(-1)![5].text).toBe('9');
    const ref = compute([0, 1, 2, 3, 4, 6, 7, 8, 9].map((r) => HAND_X[r]), 'SEUCLID SINGLE');
    expect(scheduleRows(items).map((r) => [r[1], r[2]])).toEqual(ref.map((s) => [s.c1, s.c2]));
    // split by g: two schedules of 4 stages each
    items = runExt('CLUSTER x y z /METHOD=SINGLE.', { ...ds, split: ['g'] });
    const texts = flatItems(items).flatMap((i) => (i.kind === 'text' ? [i.text] : []));
    expect(texts).toContain('g = 1');
    expect(texts).toContain('g = 2');
    const g2 = compute(HAND_X.slice(5), 'SEUCLID SINGLE');
    expect(scheduleRows(items, 1).map((r) => [r[1], r[2], r[3]])).toEqual(g2.map((s) => [s.c1, s.c2, Number(s.coef.toFixed(3))]));
  });

  it('WEIGHT is ignored with a warning; icicle plots warn', () => {
    const ds = handDs();
    ds.variables.push(makeVariable('w'));
    ds.columns.push([2, 1, 1, 1, 1, 1, 1, 1, 1, 3]);
    const items = runExt('CLUSTER x y z /PLOT=VICICLE.', { ...ds, weight: 'w' });
    expect(messages(items, 'warning').join(' ')).toMatch(/ignores case weights/);
    expect(messages(items, 'warning').join(' ')).toMatch(/Icicle/);
    expect(tables(items)[0].rows.at(-1)![1].text).toBe('10');
  });

  it('SAVE=CLUSTER adds CLUk_m variables (system-missing for unused cases)', () => {
    const ds = handDs();
    ds.columns[0] = [...ds.columns[0]];
    ds.columns[0][2] = null;
    const r = runExtCommandFull('CLUSTER', 'CLUSTER x y z /METHOD=WARD /SAVE=CLUSTER(2,3).', ctxFor(ds));
    expect(errorsOf(r.items)).toEqual([]);
    const out = r.dataset!;
    expect(out.variables.map((v) => v.name)).toEqual(['x', 'y', 'z', 'CLU3_1', 'CLU2_1']);
    const v = out.variables[3];
    expect(v.label).toBe('Ward Method');
    expect(v.print).toEqual({ type: 'F', w: 8, d: 0 });
    const keep = [0, 1, 3, 4, 5, 6, 7, 8, 9];
    const st = compute(keep.map((i) => HAND_X[i]), 'SEUCLID WARD');
    const m2 = membership(st, 9, 2);
    expect(out.columns[4]).toEqual([m2[0], m2[1], null, ...m2.slice(2)]);
    expect(ds.variables.length).toBe(3); // input untouched
    // a second run picks the next free suffix; a single solution saves one variable
    const r2 = runExtCommandFull('CLUSTER', 'CLUSTER x y z /SAVE=CLUSTER(3).', ctxFor(out));
    expect(r2.dataset!.variables.map((x) => x.name).slice(5)).toEqual(['CLU3_2']);
    expect(r2.dataset!.variables[5].label).toBe('Average Linkage (Between Groups)');
  });

  it('several methods with rootnames', () => {
    const r = runExtCommandFull('CLUSTER', 'CLUSTER x y z /METHOD=SINGLE(sing) WARD /SAVE=CLUSTER(2).', ctxFor(handDs()));
    expect(r.dataset!.variables.map((v) => v.name).slice(3)).toEqual(['sing2', 'CLU2_1']);
    expect(tables(r.items).filter((t) => t.caption === 'Agglomeration Schedule').length).toBe(2);
  });

  it('errors', () => {
    expect(errorsOf(runExt('CLUSTER x y z /MEASURE=FOO.', handDs()))[0]).toMatch(/Unknown measure/);
    expect(errorsOf(runExt('CLUSTER x y z /METHOD=FOO.', handDs()))[0]).toMatch(/Unknown method/);
    expect(errorsOf(runExt('CLUSTER x y z /PRINT=CLUSTER(4,2).', handDs()))[0]).toMatch(/PRINT=CLUSTER/);
    expect(errorsOf(runExt('CLUSTER x /MEASURE=PEARSON.', handDs()))[0]).toMatch(/two variables/);
    expect(errorsOf(runExt('CLUSTER x y z /MATRIX=IN(*).', handDs()))[0]).toMatch(/MATRIX/);
    expect(errorsOf(runExt('CLUSTER nope.', handDs()))[0]).toMatch(/not a variable/);
    const big = mk({ a: Array.from({ length: 5001 }, (_, i) => i) });
    expect(errorsOf(runExt('CLUSTER a.', big))[0]).toMatch(/too many/);
  });

  it('Czech output with decimal comma', () => {
    const items = runExt('CLUSTER x y z /METHOD=WARD /PRINT=SCHEDULE CLUSTER(2).', handDs(), 'cs', ',');
    const ts = tables(items);
    expect(ts.map((t) => t.caption)).toEqual(['Souhrn zpracování případů', 'Průběh shlukování', 'Příslušnost ke shlukům']);
    expect(ts[1].rows[2][3].text).toBe('2,009');
    expect(flatItems(items).some((i) => i.kind === 'text' && i.text === 'Wardova metoda')).toBe(true);
  });

  it('larger sample stays fast (1500 cases)', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const ds = mk({ a: Array.from({ length: 1500 }, rnd), b: Array.from({ length: 1500 }, rnd) });
    const t0 = Date.now();
    const items = runExt('CLUSTER a b /METHOD=WARD /PRINT=NONE /PLOT=DENDROGRAM.', ds);
    expect(errorsOf(items)).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(15000);
  }, 30000);

  it.skipIf(!haveEngine)('saved variables reach the engine (CLUSTER then DESCRIPTIVES)', async () => {
    const ds = students as unknown as Dataset;
    const r = await runMixed('CLUSTER hours sleep gpa /METHOD=WARD /SAVE=CLUSTER(3).\nFREQUENCIES CLU3_1.', ds);
    expect(errorsOf(r.items)).toEqual([]);
    expect(r.dataset!.variables.some((v) => v.name === 'CLU3_1')).toBe(true);
    const freq = tables(r.items).find((t) => /CLU3_1|Ward/.test(t.caption) || t.rows.some((row) => row.some((c) => c.text === 'Ward Method')));
    expect(freq).toBeDefined();
    expect(r.engineStale).toBe(false);
    const r2 = await runMixed('CLUSTER hours sleep gpa /METHOD=WARD /SAVE=CLUSTER(3).', ds);
    expect(r2.engineStale).toBe(true);
  }, 60000);
});
