import argparse,csv,json,math
from pathlib import Path
import cv2
import numpy as np

p=argparse.ArgumentParser();p.add_argument('video');p.add_argument('--pose-log',required=True);p.add_argument('--output-dir',required=True);p.add_argument('--height',type=float,required=True);p.add_argument('--dataset-name');p.add_argument('--start',type=float,default=14);p.add_argument('--end',type=float,default=24);args=p.parse_args()
video=Path(args.video)
assert .03<=args.height<=.5
output=Path(args.output_dir);output.mkdir(parents=True,exist_ok=True)
native=[json.loads(x) for x in Path(args.pose_log).read_text(encoding='utf-8',errors='replace').splitlines()]
record=[r for r in native if r.get('frameTimestampNs') and r.get('arDataset',{}).get('file')==(args.dataset_name or video.name) and r.get('arDataset',{}).get('recording')]
assert record,'Need dataset-start metadata'
t0=record[0]['frameTimestampNs']/1e9
poses=[r for r in native if r.get('quaternion') and r.get('frameTimestampNs')]
times=np.array([r['frameTimestampNs']/1e9 for r in poses]);qs=np.array([r['quaternion'] for r in poses],float)
assert np.all(np.diff(times)>0)
meta=record[0];fx,fy=meta['imageFocalLength'];cx,cy=meta['imagePrincipalPoint'];iw,ih=meta['imageDimensions']

def rotation(t):
    i=int(np.searchsorted(times,t));i=max(1,min(len(times)-1,i))
    a,b=qs[i-1],qs[i]
    if a@b<0:b=-b
    w=np.clip((t-times[i-1])/(times[i]-times[i-1]),0,1);q=(1-w)*a+w*b;q/=np.linalg.norm(q)
    x,y,z,w=q
    return np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],
                     [2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],
                     [2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])

def ground(points,t):
    rays=np.column_stack(((points[:,0]-cx)/fx,-(points[:,1]-cy)/fy,-np.ones(len(points))))
    world=rays@rotation(t).T
    valid=world[:,1]<-.08
    scales=-args.height/np.minimum(world[:,1],-1e-8)
    points=world[:,[0,2]]*scales[:,None]
    distance=np.linalg.norm(points,axis=1)
    return points,valid & (distance>=.10) & (distance<=.85)

cap=cv2.VideoCapture(str(video));assert cap.isOpened()
assert int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))==iw and int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))==ih
cap.set(cv2.CAP_PROP_POS_MSEC,args.start*1000)
ok,frame=cap.read();assert ok
start=cap.get(cv2.CAP_PROP_POS_MSEC)/1000;prev=cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY)
mask=np.zeros(prev.shape,np.uint8);mask[int(.67*ih):int(.95*ih),int(.05*iw):int(.88*iw)]=255
pts=cv2.goodFeaturesToTrack(prev,maxCorners=600,qualityLevel=.004,minDistance=5,mask=mask)
assert pts is not None and len(pts)>=12,'Insufficient visible floor features'
original=pts.reshape(-1,2).copy();ref=original.copy();refground,refvalid=ground(ref,t0+start)
pts=pts[refvalid];refground=refground[refvalid]
initial=len(pts);results=[];frame_no=0
while True:
    ok,frame=cap.read()
    if not ok:break
    t=cap.get(cv2.CAP_PROP_POS_MSEC)/1000
    if t>args.end:break
    frame_no+=1
    if frame_no%3:continue
    gray=cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY)
    nxt,status,error=cv2.calcOpticalFlowPyrLK(prev,gray,pts,None,winSize=(21,21),maxLevel=3,
      criteria=(cv2.TERM_CRITERIA_EPS|cv2.TERM_CRITERIA_COUNT,40,.01))
    back,backstatus,_=cv2.calcOpticalFlowPyrLK(gray,prev,nxt,None,winSize=(21,21),maxLevel=3)
    good=(status.ravel()==1)&(backstatus.ravel()==1)&(np.linalg.norm(back-pts,axis=2).ravel()<.6)
    pts=nxt[good];refground=refground[good];prev=gray
    if len(pts)<12:break
    current,valid=ground(pts.reshape(-1,2),t0+t)
    a=refground[valid].astype(np.float32);b=current[valid].astype(np.float32)
    if len(a)<12:continue
    affine,inliers=cv2.estimateAffinePartial2D(a,b,method=cv2.RANSAC,ransacReprojThreshold=.004,maxIters=3000,confidence=.995,refineIters=10)
    if affine is None:continue
    good=inliers.ravel().astype(bool);scale=float(np.hypot(affine[0,0],affine[1,0]));angle=math.degrees(math.atan2(affine[1,0],affine[0,0]))
    residual=np.linalg.norm(a@affine[:,:2].T+affine[:,2]-b,axis=1)
    translation=-(affine[:,:2].T@affine[:,2])/(scale*scale)
    accepted=bool(int(good.sum())>=12 and good.mean()>=.65 and abs(scale-1)<.06 and abs(angle)<3)
    results.append(dict(seconds=t,inliers=int(good.sum()),tracks=len(a),inlierRatio=float(good.mean()),scale=scale,
      residualMedianMeters=float(np.median(residual[good])),xMeters=float(translation[0]),zMeters=float(translation[1]),
      orientationCorrectionDegrees=angle,accepted=accepted))

cap.release()
assert results,'No floor flow estimates'
prefix=output/(video.stem+'-floor-flow')
with prefix.with_suffix('.csv').open('w',newline='',encoding='utf-8') as f:
    w=csv.DictWriter(f,fieldnames=list(results[0]));w.writeheader();w.writerows(results)
accepted=[r for r in results if r['accepted']]
summary=dict(video=video.name,referenceSeconds=start,startFrameTimestampSeconds=t0,initialFloorFeatures=initial,results=len(results),accepted=len(accepted),
  first=results[0],last=results[-1],samples=[r for i,r in enumerate(results) if i%10==0],
  opencvVersion=cv2.__version__,measuredHeightMeters=args.height,hypothesis='known fixed height, manually restricted visible floor ROI; offline only, no obstacle-free or autonomous claim')
prefix.with_suffix('.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
print(json.dumps(summary,indent=2))
