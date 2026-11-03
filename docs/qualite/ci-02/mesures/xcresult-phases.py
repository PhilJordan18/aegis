#!/usr/bin/env python3
# Evidence tool for docs/qualite/ci-02/diagnostic-duree-ios.md; not run by CI.
# Needs the zstandard package (pip install --target <dir> zstandard).
"""Phase profile of one standalone.xcresult: python3 -I phases.py <bundle> <pyz dir>"""
import os,re,sys,sqlite3,datetime
bundle,pyz=sys.argv[1:3]
sys.path.insert(0,pyz); import zstandard
D=zstandard.ZstdDecompressor()
def T(s): h,m,x=s.split(':'); return int(h)*3600+int(m)*60+float(x)
marks={}
pats={'session':r'Beginning test session','booted':r'state changed to 3','socket':r'has testmanagerd socket',
 'install0':r'Installing app at path','install1':r'Installed app at path','launch0':r'Launching app with identifier',
 'launch1':r'Launched app with identifier','runnable':r'Test process runnable PID','unitrun':r'AegisMobile\[\d+:\d+\] Running tests with active',
 'uirun':r'AegisMobileUITests-Runner\[\d+:\d+\] Running tests with active'}
for f in os.listdir(bundle+'/Data'):
    if not f.startswith('data'): continue
    b=open(bundle+'/Data/'+f,'rb').read()
    if b[:4]==b'\x28\xb5\x2f\xfd':
        try: b=D.decompressobj().decompress(b)
        except Exception: continue
    if b'Beginning test session' not in b and b'Running tests with active' not in b: continue
    for line in b.decode('utf-8','replace').splitlines():
        m=re.match(r'(\d\d:\d\d:\d\d\.\d+) ',line)
        if not m: continue
        for k,p in pats.items():
            if re.search(p,line):
                marks.setdefault(k,[]).append(T(m.group(1)))
db=sqlite3.connect(bundle+'/database.sqlite3');q=db.execute
ep=978307200
def tod(x): d=datetime.datetime.fromtimestamp(x+ep,datetime.timezone.utc); return d.hour*3600+d.minute*60+d.second+d.microsecond/1e6
a0,a1=q("select started,finished from Actions").fetchone(); a0,a1=tod(a0),tod(a1)
ui0=tod(q("select min(startTime) from Activities").fetchone()[0]); ui1=tod(q("select max(finishTime) from Activities").fetchone()[0])
rows=q("""select tb.name,ts.name||'/'||tc.name,r.duration,r.result from TestCaseRuns r join TestCases tc on tc.rowid=r.testCase_fk join TestSuites ts on ts.rowid=tc.testSuite_fk
 join TestSuiteRuns sr on sr.rowid=r.testSuiteRun_fk join TestableRuns tr on tr.rowid=sr.testableRun_fk join Testables tb on tb.rowid=tr.testable_fk""").fetchall()
unit=sum(r[2] for r in rows if r[0]=='AegisMobileTests'); ui=sum(r[2] for r in rows if r[0]=='AegisMobileUITests')
launches=q("select count(*), sum(finishTime-startTime) from Activities where title like 'Launch com.example%'").fetchone()
for k in marks: marks[k]=sorted(set(marks[k]))
f=lambda k,i=0: marks[k][i] if len(marks.get(k,[]))>i else None
def d(a,b): return round(b-a,1) if a is not None and b is not None else None
out={'action_total':round(a1-a0,1),'pre_session(build)':d(a0,min(marks.get('session',[a0]))),
 'boot':d(f('session'),f('socket')),'session->install':d(f('socket'),f('install0')),'install':d(f('install0'),f('install1')),
 'host_launch':d(f('launch0'),f('launch1')),'launched->runnable':d(f('launch1'),f('runnable')),'runnable->unit_start':d(f('runnable'),f('unitrun')),
 'unit_sum':round(unit,1),'unit_end->ui_first_test':d(f('unitrun')+unit if f('unitrun') else None,ui0),'ui_window':d(ui0,ui1),'ui_sum':round(ui,1),
 'after_last_test':d(ui1,a1),'ui_launches':launches[0],'ui_launch_s':round(launches[1] or 0,1),
 'failed':[r[1] for r in rows if r[3]!='Success'],'top':[(r[1].split('/')[1][:40],round(r[2],1)) for r in sorted(rows,key=lambda r:-r[2])[:5]]}
for k,v in out.items(): print(f"{k:26} {v}")
