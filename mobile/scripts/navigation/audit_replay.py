"""Replay recorded NDJSON through compiled production Kotlin classes, never a phone.

Requires JDK 17, compiled navigation-probe Kotlin classes and Kotlin stdlib.
python audit_replay.py INPUT --classes DIR --stdlib JAR --jdk DIR --output DIR
Environment captures remain local; this tool does not authorize or emit movement.
"""
import argparse,base64,csv,json,struct,subprocess
from pathlib import Path

def convert(rows,target):
    with target.open('wb') as out:
        def pack(fmt,*v): out.write(struct.pack('>'+fmt,*v))
        pack('i',len(rows))
        for r in rows:
            pack('qqq',r['frameNs'],r['rawNs'],r['denseNs'])
            for key in ['cameraTranslation','cameraQuaternion','planeOrigin','planeNormal','intrinsics']:
                pack('f'*len(r[key]),*r[key])
            pack('ii',*r['textureDimensions'])
            for key in ['raw','dense']:
                s=r.get(key)
                if key=='dense':pack('?',s is not None)
                if s is None:continue
                pack('iiiii',s['width'],s['height'],s['sourceWidth'],s['sourceHeight'],s['step'])
                mm=base64.b64decode(s['u16leBase64'])
                assert len(mm)==2*s['width']*s['height']
                pack('H'*(len(mm)//2),*struct.unpack('<'+'H'*(len(mm)//2),mm))

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('input',type=Path);p.add_argument('--classes',required=True,type=Path)
    p.add_argument('--stdlib',required=True,type=Path);p.add_argument('--jdk',required=True,type=Path)
    p.add_argument('--output',required=True,type=Path)
    p.add_argument('--fusion-slack-ms',type=float,default=0,help='OFFLINE ONLY: fuse gate counterfactual; does not change recorded timestamps')
    a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
    rows=[json.loads(x) for x in a.input.read_text(encoding='utf-8').splitlines() if x.strip()]
    if not 1<=len(rows)<=360 or any(r.get('schemaVersion') not in (1,2) for r in rows):
        raise ValueError('Expected 1..360 bounded schemaVersion 1 or 2 depth records')
    # Missing inputs/planes remain useful diagnostics but cannot enter metric replay.
    original_count=len(rows)
    rows=[r for r in rows if r.get('raw') is not None and r.get('planeOrigin') is not None and r.get('planeNormal') is not None]
    if not rows:
        raise ValueError('No raw+plane records for metric replay; use summarize_depth_capture.py for availability diagnostics')
    binary=a.output/'replay.bin';convert(rows,binary)
    import os
    cp=os.pathsep.join([str(a.classes.resolve()),str(a.stdlib.resolve())])
    exe=lambda n:str(a.jdk/'bin'/(n+('.exe' if os.name=='nt' else '')))
    source=Path(__file__).with_name('TerrainReplayAudit.java')
    subprocess.run([exe('javac'),'-cp',cp,'-d',str(a.output),str(source)],check=True)
    raw=a.output/'production.csv'
    with raw.open('w',encoding='utf-8') as out:
        subprocess.run([exe('java'),'-cp',str(a.output.resolve())+os.pathsep+cp,'TerrainReplayAudit',str(binary),str(int(a.fusion_slack_ms*1e6))],stdout=out,check=True)
    frames=[{'frame':i,'timeNs':r['frameNs'],'camera':r['cameraTranslation'],'plane':r['planeOrigin'],'cells':[],'points':[]} for i,r in enumerate(rows)]
    with raw.open(encoding='utf-8') as inp:
        for row in csv.reader(inp):
            f=frames[int(row[1])]
            if row[0]=='FRAME':f.update(fusion=row[3],added=int(row[4]),reason=row[5])
            elif row[0]=='CELL':f['cells'].append([int(row[2]),int(row[3]),row[4],row[5]=='true'])
            elif row[0]=='POINT':f['points'].append(list(map(float,row[2:])))
            elif row[0]=='ROUTE':f['routeClearance']=row[2]
            elif row[0]=='LOCAL':f['localMap']=dict(zip(
                ['retainedFloorTiles','recentFreeTiles','weakObstacleTiles','obstacleTiles','dropTiles'],map(int,row[2:7])),
                stepState=row[7],unknown=int(row[8]),stale=int(row[9]),obstacles=int(row[10]),drops=int(row[11]),initialUnknown=int(row[12]))
    (a.output/'frames.json').write_text(json.dumps(frames,separators=(',',':')),encoding='utf-8')
    print(json.dumps({'frames':len(frames),'diagnosticRecordsSkipped':original_count-len(rows),'peakGround':max(sum(c[2]=='GROUND' for c in f['cells']) for f in frames),
      'peakCandidates':max(sum(c[3] for c in f['cells']) for f in frames),'points':sum(len(f['points']) for f in frames)}))

if __name__=='__main__':main()
