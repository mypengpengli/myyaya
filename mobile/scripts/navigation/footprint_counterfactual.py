"""Geometry-only experiment on confirmed cells, never an executable movement plan."""
import argparse,json,math
from pathlib import Path

def touched(cx,cz,yaw,width,length):
    right=(math.cos(yaw),math.sin(yaw));forward=(math.sin(yaw),-math.cos(yaw))
    hw=width/2;hl=length/2
    corners=[(cx+a*hw*right[0]+b*hl*forward[0],cz+a*hw*right[1]+b*hl*forward[1]) for a in [-1,1] for b in [-1,1]]
    xmin,xmax=min(p[0] for p in corners),max(p[0] for p in corners)
    zmin,zmax=min(p[1] for p in corners),max(p[1] for p in corners)
    cells=[]
    for x in range(math.floor(xmin/.1),math.floor(xmax/.1)+1):
        for z in range(math.floor(zmin/.1),math.floor(zmax/.1)+1):
            dx=(x+.5)*.1-cx;dz=(z+.5)*.1-cz
            # Separating-axis test. Merely touching a grid line is not positive
            # overlap. The physical margin is already in width and length.
            if abs(dx)>=hw*abs(right[0])+hl*abs(forward[0])+.05-1e-7:continue
            if abs(dz)>=hw*abs(right[1])+hl*abs(forward[1])+.05-1e-7:continue
            if abs(dx*right[0]+dz*right[1])>=hw+.05*(abs(right[0])+abs(right[1]))-1e-7:continue
            if abs(dx*forward[0]+dz*forward[1])>=hl+.05*(abs(forward[0])+abs(forward[1]))-1e-7:continue
            cells.append((x,z))
    return cells

def search(frame,margin,step):
    ground={(x,z) for x,z,kind,_ in frame['cells'] if kind=='GROUND'}
    hits=[]
    for x,z in sorted(ground):
        for ox in [0,.025,.05,.075]:
            for oz in [0,.025,.05,.075]:
                for deg in range(0,180,15):
                    cx=x*.1+ox;cz=z*.1+oz;yaw=math.radians(deg)
                    cells=touched(cx,cz,yaw,.15+2*margin,.10+2*margin+step)
                    if cells and all(c in ground for c in cells):
                        hits.append({'sweptCenter':[round(cx,4),round(cz,4)],'headingDegrees':deg,'cells':cells})
    return {'marginMeters':margin,'stepMeters':step,'geometricFits':len(hits),'example':hits[0] if hits else None}

def main():
    p=argparse.ArgumentParser();p.add_argument('frames',type=Path);p.add_argument('--frame',type=int,default=21);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();frame=json.loads(a.frames.read_text())[a.frame]
    results=[search(frame,margin,step) for margin in [.05,.03,.02] for step in [0,.02]]
    a.output.write_text(json.dumps({'frame':a.frame,'note':'Remote patch geometry only; no claim of reachability from actual robot pose or motion calibration.','results':results},indent=2))
    print(json.dumps(results))
if __name__=='__main__':main()
