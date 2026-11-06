"""Explain candidate deficits from audit_replay output; all counterfactuals are offline."""
import argparse,collections,json,math
from pathlib import Path

MASK=[(x,z) for x in range(-2,3) for z in range(-2,3)
      if math.hypot(max(0,(abs(x)-.5)*.1),max(0,(abs(z)-.5)*.1))<=math.hypot(.15,.10)/2+.05]
def components(cells):
    cells=set(cells);sizes=[]
    while cells:
        seen={cells.pop()};todo=list(seen)
        while todo:
            x,z=todo.pop()
            for key in [(x-1,z),(x+1,z),(x,z-1),(x,z+1)]:
                if key in cells:cells.remove(key);seen.add(key);todo.append(key)
        sizes.append(len(seen))
    return sorted(sizes,reverse=True)
def inspect(frame):
    kinds={(x,z):kind for x,z,kind,_ in frame['cells']}
    ground={key for key,value in kinds.items() if value=='GROUND'}
    choices=[]
    for x,z in ground:
        counts=collections.Counter(kinds.get((x+dx,z+dz),'UNOBSERVED') for dx,dz in MASK)
        choices.append({'center':[x,z],'ground':counts['GROUND'],'missing':dict(counts)})
    choices.sort(key=lambda c:(-c['ground'],sum(c['missing'].get(k,0) for k in ['OBSTACLE','DROP']),c['center']))
    return {'frame':frame['frame'],'timeNs':frame['timeNs'],'ground':len(ground),
      'kindCounts':dict(collections.Counter(kinds.values())),'candidates':sum(c[3] for c in frame['cells']),
      'components4':components(ground),'bestFootprint':choices[0] if choices else None}
def main():
    p=argparse.ArgumentParser();p.add_argument('frames',type=Path);p.add_argument('--output',required=True,type=Path)
    p.add_argument('--recording',type=Path,help='Original NDJSON, used only to verify camera heading')
    a=p.parse_args();frames=json.loads(a.frames.read_text(encoding='utf-8'));stats=[inspect(f) for f in frames]
    union={(x,z) for f in frames for x,z,kind,_ in f['cells'] if kind=='GROUND'}
    union_best=max((sum((x+dx,z+dz) in union for dx,dz in MASK) for x,z in union),default=0)
    peak=max(stats,key=lambda s:s['ground']);best=max(stats,key=lambda s:(s['bestFootprint'] or {}).get('ground',0))
    heights=[p[3] for f in frames for p in f['points']]
    recorded=[json.loads(x) for x in a.recording.read_text(encoding='utf-8').splitlines() if x.strip()] if a.recording else None
    if recorded:assert len(recorded)==len(frames) and all(r['frameNs']==f['timeNs'] for r,f in zip(recorded,frames))
    summaries=[]
    for i,(f,s) in enumerate(zip(frames,stats)):
        # Approximate camera-centered sweep, zero mount offset, matching the
        # currently uncalibrated mount. This is a coverage audit, not clearance.
        points=f['points']
        if len(points)==0:continue
        camera=f['camera']
        # Recorded pose quaternion is loaded separately by caller if needed;
        # coverage below is isotropic near-body, no invented forward direction.
        low=lambda p:-.04<=p[3]<=.19
        near=lambda p:math.hypot(p[0]-camera[0],p[2]-camera[2])<=.5
        s['points']=len(points);s['nearBodyPoints']=sum(near(p) for p in points);s['nearBodyLowPoints']=sum(near(p) and low(p) for p in points)
        s['routeClearance']=f.get('routeClearance')
        if recorded:
            qx,qy,qz,qw=recorded[i]['cameraQuaternion']
            dx=-2*(qx*qz+qw*qy);dz=-1+2*(qx*qx+qy*qy);length=math.hypot(dx,dz);dx/=length;dz/=length
            def sweep(p):
                x=p[0]-camera[0];z=p[2]-camera[2];along=x*dx+z*dz;across=abs(x*dz-z*dx)
                return math.hypot(x,z)<=math.hypot(.15,.10)/2+.10+.12 or (0<=along<=.50 and across<=.175)
            s['sweepLowPoints']=sum(sweep(p) and low(p) for p in points);s['sweepPoints']=sum(sweep(p) for p in points)
        summaries.append(s)
    fused=collections.Counter(f['fusion'] for f in frames)
    result={'frames':len(frames),'spanSeconds':(frames[-1]['timeNs']-frames[0]['timeNs'])/1e9,
      'requiredFootprintCells':len(MASK),'footprintOffsets':MASK,'peak':peak,'bestSupportedFootprint':best,
      'peakGround':max(s['ground'] for s in stats),'peakCandidates':max(s['candidates'] for s in stats),
      'peak4ConnectedGround':max((s['components4'] or [0])[0] for s in stats),
      'unionEverGroundUpperBound':{'cells':len(union),'components4':components(union),'bestFootprintGround':union_best,
        'note':'Ignores expiry AND conflicts; diagnostic upper bound only, never a motion map.'},
      'fusion':dict(fused),'addedPointsSum':sum(f['added'] for f in frames),
      'routeClearance':dict(collections.Counter(f.get('routeClearance','unavailable') for f in frames)),
      'clearWithoutLocalLowPoints':sum(s.get('routeClearance')=='CLEAR' and s.get('sweepLowPoints')==0 for s in summaries) if recorded else None,
      'heightBandCounts':{'floor':sum(abs(h)<=.025 for h in heights),'obstacle':sum(.03<h<=.16 for h in heights),
        'aboveRobotBand':sum(h>.16 for h in heights),'drop':sum(h<-.04 for h in heights)},
      'frameMetrics':summaries}
    a.output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in result.items() if k!='frameMetrics'},ensure_ascii=False))
if __name__=='__main__':main()
