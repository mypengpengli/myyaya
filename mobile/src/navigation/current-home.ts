/** The last explicitly opened location is a hint, never proof that localization succeeded. */
export function currentHomeId(homes:Array<{mapId:string;active?:boolean}>):string|undefined{
  if(homes.length===0)return;
  if(homes.length===1)return homes[0].mapId;
  const selected=homes.filter(h=>h.active);
  if(selected.length!==1)throw new Error("请在家庭地图选择当前地点，再安排行驶");
  return selected[0].mapId;
}
