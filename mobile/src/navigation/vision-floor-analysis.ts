/** Experimental known-height floor geometry. Independent of model/network/motor runtimes. */
export type FloorCamera = { width: number; height: number; fx: number; fy: number; cx: number; cy: number; q: number[] };
export type FloorRegion = { left: number; top: number; right: number; bottom: number };
const median = (a: number[]) => { const s = [...a].sort((a,b) => a-b); return s[Math.floor(s.length/2)]; };

export function analyzeFloorDepth(depth: Uint8Array, width: number, height: number, camera: FloorCamera,
  cameraHeight: number, roi: FloorRegion) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 32 || height < 32 || width*height > 262144 || depth.length !== width*height) throw new Error("无效深度栅格");
  const numeric = [camera.width,camera.height,camera.fx,camera.fy,camera.cx,camera.cy,cameraHeight,...camera.q,...Object.values(roi)];
  if (!numeric.every(Number.isFinite) || camera.q.length !== 4 || camera.fx <= 0 || camera.fy <= 0 || camera.width <= 0 || camera.height <= 0
    || cameraHeight < .03 || cameraHeight > .5 || roi.left < 0 || roi.top < 0 || roi.right > 1 || roi.bottom > 1 || roi.right-roi.left < .1 || roi.bottom-roi.top < .08) throw new Error("无效相机或实测地板区域");
  const norm = Math.hypot(...camera.q); if (Math.abs(norm-1) > .01) throw new Error("无效相机姿态");
  const [x,y,z,w] = camera.q.map(v => v/norm);
  // Relative-depth discontinuities previously produced impossible object widths.
  // Keep a small band unknown; it must never become measured floor or a metric drop.
  const uncertainEdge=new Uint8Array(depth.length);
  for(let j=1;j<height-1;j++) for(let i=1;i<width-1;i++) {
    const n=j*width+i,v=depth[n];
    if(Math.max(Math.abs(v-depth[n-1]),Math.abs(v-depth[n+1]),Math.abs(v-depth[n-width]),Math.abs(v-depth[n+width]))>10) {
      for(let yy=Math.max(0,j-2);yy<=Math.min(height-1,j+2);yy++) for(let xx=Math.max(0,i-2);xx<=Math.min(width-1,i+2);xx++) uncertainEdge[yy*width+xx]=1;
    }
  }
  const r = [1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w),2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w),2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)];
  const rayY = new Float64Array(depth.length), rayRight = new Float64Array(depth.length), rayForward = new Float64Array(depth.length);
  const forwardLength = Math.hypot(r[2],r[8]); if (forwardLength < .4) throw new Error("镜头过于俯仰");
  const train: Array<[number,number]> = [], holdout: Array<[number,number]> = [];
  for (let j=0;j<height;j++) for (let i=0;i<width;i++) {
    const n=j*width+i, u=(i+.5)/width, v=(j+.5)/height;
    const a=(u*camera.width-camera.cx)/camera.fx, b=(camera.cy-v*camera.height)/camera.fy;
    const rx=r[0]*a+r[1]*b-r[2], ry=r[3]*a+r[4]*b-r[5], rz=r[6]*a+r[7]*b-r[8];
    rayY[n]=ry; rayRight[n]=(rx*r[8]-rz*r[2])/forwardLength; rayForward[n]=(-rx*r[2]-rz*r[8])/forwardLength;
    if (!uncertainEdge[n] && u>=roi.left && u<=roi.right && v>=roi.top && v<=roi.bottom && ry<-.08 && (i+j)%3===0) {
      ((i+j)%2 ? train : holdout).push([depth[n],-ry/cameraHeight]);
    }
  }
  if (train.length<48 || holdout.length<48 || Math.max(...train.map(p=>p[0]))-Math.min(...train.map(p=>p[0]))<12) throw new Error("地板取样不足或深度变化太小");
  let seed=197, best: Array<[number,number]> = [];
  const random=()=> { seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; };
  for(let k=0;k<120;k++) {
    const a=train[Math.floor(random()*train.length)];
    const b=train[Math.floor(random()*train.length)];
    if(Math.abs(a[0]-b[0])<12) continue;
    const scale=(a[1]-b[1])/(a[0]-b[0]), bias=a[1]-scale*a[0]; if(scale<=0) continue;
    const inliers=train.filter(p=>Math.abs(scale*p[0]+bias-p[1])<.15);if(inliers.length>best.length) best=inliers;
  }
  if(best.length<48 || best.length/train.length<.65) throw new Error("地板比例拟合未通过");
  const mx=best.reduce((s,p)=>s+p[0],0)/best.length, my=best.reduce((s,p)=>s+p[1],0)/best.length;
  const den=best.reduce((s,p)=>s+(p[0]-mx)**2,0);if(den<1) throw new Error("地板尺度退化");
  const scale=best.reduce((s,p)=>s+(p[0]-mx)*(p[1]-my),0)/den, bias=my-scale*mx;
  const errors=holdout.map(p=>Math.abs(cameraHeight-cameraHeight*p[1]/(scale*p[0]+bias))).sort((a,b)=>a-b);
  const validationMedian=median(errors), validationP90=errors[Math.floor(errors.length*.9)];
  if(!Number.isFinite(validationP90) || scale<=0 || validationMedian>.015 || validationP90>.03) throw new Error("保留地板取样验证未通过");
  const labels=new Uint8Array(depth.length), sectors=Array.from({length:6},()=>({floor:0,other:0}));
  let floorPixels=0, obstaclePixels=0, dropPixels=0, nearestObstacle=Infinity, corridorDropPixels=0;
  const obstacleCandidates: number[]=[];
  for(let n=0;n<depth.length;n++) {
    const inv=scale*depth[n]+bias;if(inv<=.1 || rayY[n]>=-.02) continue;
    const distance=1/inv, h=cameraHeight+rayY[n]*distance;
    const right=rayRight[n]*distance, forward=rayForward[n]*distance;
    const groundDistance=-cameraHeight/rayY[n], groundRight=rayRight[n]*groundDistance, groundForward=rayForward[n]*groundDistance;
    if(forward<=0 || distance>20) continue;
    if(!uncertainEdge[n]) {
      if(Math.abs(h)<=.015) { labels[n]=1;floorPixels++; }
      else if(h>=.03 && h<.6) { labels[n]=2;obstaclePixels++; }
      else if(h<=-.035) { labels[n]=3;dropPixels++; }
    }
    // Sampling ahead of the robot is evidence only; its unseen footprint is not filled in.
    if(groundForward>=.15 && groundForward<.5 && groundRight>=-.055 && groundRight<=.195) {
      const column=Math.min(2,Math.floor((groundRight+.055)/.25*3)), row=groundForward<.3?0:1;
      sectors[row*3+column][labels[n]===1 ? "floor" : "other"]++;
      if(labels[n]===3) corridorDropPixels++;
    }
    if(labels[n]===2 && right>=-.055 && right<=.195 && forward<2) obstacleCandidates.push(forward);
  }
  if(obstacleCandidates.length>=12) nearestObstacle=obstacleCandidates.sort((a,b)=>a-b)[Math.floor(obstacleCandidates.length*.1)];
  const coverage=sectors.map(s=>({ ...s, ratio:s.floor/(s.floor+s.other || 1) }));
  const nearFloorObserved=coverage.slice(0,3).every(s=>s.floor>=12 && s.ratio>=.8);
  const reason=corridorDropPixels>=12 ? "POSSIBLE_DROP_IN_CORRIDOR" : nearestObstacle<.35 ? "OBSTACLE_IN_VIEW_CORRIDOR" : coverage.every(s=>s.floor>=12 && s.ratio>=.8) ? "FLOOR_STRIP_OBSERVED" : nearFloorObserved ? "NEAR_FLOOR_OBSERVED_FAR_UNKNOWN" : "INCOMPLETE_FLOOR_COVERAGE";
  return { labels, report:{ reason, cameraHeightMeters:cameraHeight, scale,bias,fitInlierRatio:best.length/train.length,
    heldoutFloorMedianHeightErrorMeters:validationMedian,heldoutFloorP90HeightErrorMeters:validationP90,
    floorPixels,obstaclePixels,dropPixels,uncertainEdgePixels:uncertainEdge.reduce((a,b)=>a+b,0),corridorDropPixels,sectors:coverage,corridorCenterRightMeters:.07,corridorWidthMeters:.25,
    nearestObstacleEstimateMeters:Number.isFinite(nearestObstacle)?nearestObstacle:null,nearFloorObserved,
    manualFloorAssumption:true,metricNavigationValidated:false,autonomousMotionAuthorized:false } };
}
