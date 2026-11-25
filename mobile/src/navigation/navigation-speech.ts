let speaker:((text:string)=>Promise<boolean>)|undefined;
/** Navigation stages share the listening session's echo/interrupt guard and never talk over a user turn. */
export function bindNavigationSpeaker(next:(text:string)=>Promise<boolean>){
  speaker=next;return ()=>{if(speaker===next)speaker=undefined;};
}
export async function announceNavigation(text:string):Promise<boolean>{return speaker?await speaker(text):false;}
