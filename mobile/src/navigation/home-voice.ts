import {compactChinese} from "../voice/chinese-command";

/** Offline commands available while the mapping camera owns the normal conversation runtime. */
export function parseHomeVoice(text:string):Record<string,string>|null {
  const s=compactChinese(text).replace(/^(?:小丫小丫|小丫)/u,"").replace(/^请/u,"");
  if(/^(?:暂停|暂停导航|停下|停止|停一下|别走了)$/u.test(s))return {op:"pause"};
  if(/^(?:继续|继续导航|继续走)$/u.test(s))return {op:"resume"};
  if(/^(?:取消|取消导航|结束导航)$/u.test(s))return {op:"cancel"};
  if(/^(?:恢复定位|重新定位)$/u.test(s))return {op:"relocalize"};
  if(/^(?:已经最低|已最低|确认最低姿态)$/u.test(s))return {op:"confirm"};
  if(/^(?:这里禁止通行|这里设为禁行区)$/u.test(s))return {op:"zone",name:"禁行区"};
  if(/^(?:结束带领|结束路线)$/u.test(s))return {op:"finish",name:""};
  let m=s.match(/^(?:去|前往)(.{1,40}?)吧?$/u);if(m)return {op:"go",target:m[1]};
  m=s.match(/^(?:这里是|这是)(.{1,40})$/u);if(m)return {op:"remember",name:m[1],room:m[1],kind:"room"};
  m=s.match(/^(?:把这里记为|这里记为|记住这里叫)(.{1,40})$/u);if(m)return {op:"remember",name:m[1],kind:/门口$/u.test(m[1])?"door":"point"};
  m=s.match(/^记住门口(.{1,40})$/u);if(m)return {op:"remember",name:m[1],kind:"door"};
  m=s.match(/^(?:把)?(.{1,40})改名(?:为|叫)(.{1,40})$/u);if(m)return {op:"rename",id:m[1],name:m[2]};
  m=s.match(/^开始带领(?:从)?(.{1,40})$/u);if(m)return {op:"teach",name:m[1]};
  m=s.match(/^(?:结束带领|结束路线)(?:到)?(.{1,40})$/u);if(m)return {op:"finish",name:m[1]};
  return null;
}
