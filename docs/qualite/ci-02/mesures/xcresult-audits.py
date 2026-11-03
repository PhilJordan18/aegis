#!/usr/bin/env python3
# Evidence tool for docs/qualite/ci-02/diagnostic-duree-ios.md; not run by CI.
# Usage: python3 -I <this> <bundle>.xcresult/database.sqlite3
"""Audit windows: from the last pre-audit query of the navigation bar to the next screenshot attachment (or test end)."""
import sqlite3,sys,re
db=sqlite3.connect(sys.argv[1]);q=db.execute
rows=q("""select r.rowid,ts.name,tc.name,r.result from TestCaseRuns r join TestCases tc on tc.rowid=r.testCase_fk join TestSuites ts on ts.rowid=tc.testSuite_fk where ts.name like '%UITests'""").fetchall()
tot=0;n=0
for rid,s,t,res in rows:
    acts=q("select title,startTime,finishTime from Activities where testCaseRun_fk=? and parent_fk is null order by startTime",(rid,)).fetchall()
    start=None; out=[]
    for title,a,b in acts:
        if re.match(r'(Find|Checking existence of `)(the )?NavigationBar \(First Match\)',title): start=b or a; continue
        if start and (title.startswith('Added attachment') or title.startswith('Tear Down')):
            handler=sum((y or x)-x for tt,x,y in acts if start<=x<=a and tt.startswith('Find the'))
            out.append((title[25:60] if title.startswith('Added') else 'TEARDOWN', round(a-start,1), round(handler,1))); start=None
    if out:
        print(t[:55], res[:4]); [print('   ',o) for o in out]
        tot+=sum(o[1] for o in out if o[0]!='TEARDOWN'); n+=sum(1 for o in out if o[0]!='TEARDOWN')
print('audits',n,'total s',round(tot,1))
