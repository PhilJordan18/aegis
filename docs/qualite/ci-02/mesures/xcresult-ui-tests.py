#!/usr/bin/env python3
# Evidence tool for docs/qualite/ci-02/diagnostic-duree-ios.md; not run by CI.
# Usage: python3 -I <this> <bundle>.xcresult/database.sqlite3
"""Per UI test: top-level activity time by kind and uncovered time (audit, sleeps)."""
import sqlite3,sys,re,collections
db=sqlite3.connect(sys.argv[1]);q=db.execute
rows=q("""select r.rowid,ts.name||'/'||tc.name,r.duration,r.result from TestCaseRuns r join TestCases tc on tc.rowid=r.testCase_fk join TestSuites ts on ts.rowid=tc.testSuite_fk
 where ts.name like '%UITests' order by r.duration desc""").fetchall()
def kind(t):
    for k,p in [('launch',r'^Open |^Launch '),('terminate',r'^Terminate'),('appearance',r'^Setting appearance'),('wait',r'^Waiting |to not exist'),
                ('teardown',r'^Tear Down'),('start',r'^Start Test'),('tap/type',r'^(Tap|Type|Swipe|Press|Pull|Drag)'),('attach',r'^Added attachment')]:
        if re.search(p,t): return k
    return 'query'
T=collections.Counter()
print(f"{'test':58} {'dur':>6} {'launch':>6} {'wait':>6} {'query':>6} {'tap':>5} {'tdown':>5} {'gap':>6} {'gap>3s':>6} nAud")
for rid,name,dur,res in rows:
    acts=q("select title,startTime,finishTime from Activities where testCaseRun_fk=? and parent_fk is null order by startTime",(rid,)).fetchall()
    if not acts: print(f"{name[:58]:58} {dur:6.1f} (no activities) {res}"); continue
    c=collections.Counter(); gap=0; big=0; end=acts[0][1]
    for t,s,f in acts:
        f=f or s
        if s>end: g=s-end; gap+=g; big+= g if g>3 else 0
        c[kind(t)]+=f-s; end=max(end,f)
    naud=len([1 for t,s,f in acts if t.startswith('Added attachment') and 'audit' not in t])
    for k,v in c.items(): T[k]+=v
    T['gap']+=gap; T['big']+=big; T['dur']+=dur
    print(f"{name.split('/')[1][:58]:58} {dur:6.1f} {c['launch']:6.1f} {c['wait']:6.1f} {c['query']:6.1f} {c['tap/type']:5.1f} {c['teardown']:5.1f} {gap:6.1f} {big:6.1f} {naud} {res[:4]}")
print({k:round(v,1) for k,v in T.items()})
