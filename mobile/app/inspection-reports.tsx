import {useEffect,useState} from "react";
import {Alert,Pressable,ScrollView,Text,View} from "react-native";
import {SafeAreaView} from "react-native-safe-area-context";
import {useRouter} from "expo-router";
import {getInspectionService} from "@/src/inspection/inspection-runtime";
import {presentArtifact} from "@/src/artifacts/artifact-store";
import {looiTheme as theme} from "@/src/ui/looi-theme";

export default function InspectionReports(){
  const router=useRouter();const [,refresh]=useState(0);
  useEffect(()=>{const timer=setInterval(()=>refresh(v=>v+1),3000);return()=>clearInterval(timer);},[]);
  let tasks:ReturnType<ReturnType<typeof getInspectionService>["summaries"]>=[];let error="";
  try{tasks=getInspectionService().summaries();}catch{error="巡查记录暂时无法读取";}
  return <SafeAreaView style={{flex:1,backgroundColor:theme.bg,padding:18}}>
    <View style={{flexDirection:"row",justifyContent:"space-between"}}><Text style={{color:theme.text,fontSize:23}}>巡查见闻</Text><Pressable onPress={()=>router.back()}><Text style={{color:theme.cyan,fontSize:20}}>返回</Text></Pressable></View>
    <ScrollView>
      {!tasks.length?<Text style={{color:theme.muted,marginTop:20}}>{error||"还没有巡查记录。可以说：去厨房拍照再回来。"}</Text>:null}
      {tasks.map(task=><View key={task.id} style={{padding:16,marginTop:12,borderRadius:14,backgroundColor:theme.rail}}>
        <Text style={{color:theme.text,fontSize:17}}>{new Date(task.createdAt).toLocaleString()} · {task.returned?"已返回出发位置":"未确认返回"}</Text>
        <Text style={{color:theme.cyan,marginVertical:6}}>{task.notice}</Text>
        {task.observations.map(o=><View key={o.id} style={{marginTop:10}}><Text style={{color:theme.text}}>{o.room} · {new Date(o.at).toLocaleString()}（当时观察）</Text>
          <Text selectable style={{color:theme.muted,marginVertical:5}}>{o.summary}</Text>
          {o.artifactId?<Pressable onPress={()=>{try{presentArtifact(o.artifactId);router.navigate("/");}catch{Alert.alert("照片不可用","文件可能已被删除");}}}><Text style={{color:theme.cyan}}>查看这张照片</Text></Pressable>:null}
        </View>)}
      </View>)}
    </ScrollView>
  </SafeAreaView>;
}
