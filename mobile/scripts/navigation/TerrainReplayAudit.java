import java.io.*;
import java.util.*;
import com.myyaya.navigationprobe.*;
import kotlin.Unit;

/** Offline audit of the actual compiled Kotlin pipeline. No Android or motor API. */
public class TerrainReplayAudit {
  static float[] floats(DataInputStream in,int n) throws Exception {
    float[] a=new float[n];for(int i=0;i<n;i++)a[i]=in.readFloat();return a;
  }
  static DepthSamples.Result sample(DataInputStream in) throws Exception {
    int w=in.readInt(),h=in.readInt(),sw=in.readInt(),sh=in.readInt(),step=in.readInt();int[] mm=new int[w*h];
    for(int i=0;i<mm.length;i++)mm[i]=in.readUnsignedShort();
    return new DepthSamples.Result(w,h,mm,0.0,null,null,sw,sh,step);
  }
  public static void main(String[] args) throws Exception {
    TerrainAnalysis terrain=new TerrainAnalysis();
    long slack=args.length>1?Long.parseLong(args[1]):0;
    if(slack<0 || slack>5_000_000L)throw new IllegalArgumentException("Offline slack must be 0..5ms");
    terrain.setEnvelope(new RobotEnvelope(.15f,.10f,.11f,.05f));
    try(DataInputStream in=new DataInputStream(new FileInputStream(args[0]))) {
      int rows=in.readInt();
      for(int row=0;row<rows;row++) {
        long now=in.readLong(),rawNs=in.readLong(),denseNs=in.readLong();
        RigidPose camera=new RigidPose(floats(in,3),floats(in,4));GroundPlane plane=new GroundPlane(floats(in,3),floats(in,3));
        float[] k=floats(in,4);int tw=in.readInt(),th=in.readInt();DepthSamples.Result raw=sample(in),dense=in.readBoolean()?sample(in):null;
        if(row==0) terrain.selectGround(plane,true);
        // Controlled offline counterfactual only. Terrain still uses the original
        // timestamps; no image timestamp or motor authorization is rewritten.
        long deadline=now;
        if(slack>0 && denseNs>now) {
          if(now-rawNs>250_000_000L-slack)throw new IllegalArgumentException("Raw near age boundary: cannot isolate future-time gate");
          deadline+=slack;
        }
        HybridDepth.Result fusion=HybridDepth.INSTANCE.fuse(raw,dense,camera,plane,k[0],k[1],k[2],k[3],tw,th,rawNs,denseNs,deadline);
        List<float[]> points=new ArrayList<>();
        DepthProjection.INSTANCE.points(fusion.getSample(),camera,k[0],k[1],k[2],k[3],tw,th,p->{points.add(p);return Unit.INSTANCE;});
        TerrainSnapshot snap=terrain.update(camera,plane,now,rawNs,points);
        System.out.println("FRAME,"+row+","+now+","+fusion.getStatus()+","+fusion.getAdded()+","+snap.getDepthEvidence().getBlockingReason());
        List<float[]> rawPoints=new ArrayList<>();
        DepthProjection.INSTANCE.points(raw,camera,k[0],k[1],k[2],k[3],tw,th,p->{rawPoints.add(p);return Unit.INSTANCE;});
        try {
          RoutePose pose=RoutePose.Companion.fromCamera(camera,0f,0f);
          boolean fresh=rawNs>0 && rawNs<=now && now-rawNs<=250_000_000L;
          RouteClearance clearance=RoutePerception.INSTANCE.evaluate(rawPoints,plane,pose,fresh,.15f,.10f,.11f,.10f,true);
          System.out.println("ROUTE,"+row+","+clearance);
        } catch(IllegalArgumentException e) {System.out.println("ROUTE,"+row+",INVALID_POSE");}
        for(TerrainCell c:snap.getCells()) System.out.println("CELL,"+row+","+c.getX()+","+c.getZ()+","+c.getKind()+","+c.getCandidate());
        for(float[] p:points) System.out.println("POINT,"+row+","+p[0]+","+p[1]+","+p[2]+","+plane.distance(p));
      }
    }
  }
}
