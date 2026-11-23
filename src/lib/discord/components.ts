import "server-only";
type MessageResponse={id:string;channel_id:string};
const API="https://discord.com/api/v10";
function token(){const value=process.env.DISCORD_BOT_TOKEN;if(!value)throw new Error("DISCORD_BOT_TOKEN is not configured.");return value;}
export async function sendDiscordMessage(channelId:string,payload:Record<string,unknown>):Promise<MessageResponse>{const response=await fetch(`${API}/channels/${channelId}/messages`,{method:"POST",headers:{Authorization:"Bot "+token(),"Content-Type":"application/json"},body:JSON.stringify(payload),cache:"no-store"});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error("Discord message failed ("+response.status+"): "+String(data.message||"unknown error"));return data as MessageResponse;}
export async function editDiscordMessage(channelId:string,messageId:string,payload:Record<string,unknown>){const response=await fetch(`${API}/channels/${channelId}/messages/${messageId}`,{method:"PATCH",headers:{Authorization:"Bot "+token(),"Content-Type":"application/json"},body:JSON.stringify(payload),cache:"no-store"});if(!response.ok)throw new Error("Discord message update failed.");return response.json();}
export function v2Container(children:unknown[],accentColor?:number){return{type:17,components:children,...(accentColor?{accent_color:accentColor}:{})};}
export function textDisplay(content:string){return{type:10,content};}
export function separator(){return{type:14,divider:true,spacing:1};}
export function actionButton(label:string,customId:string,style:number){return{type:2,style,label,custom_id:customId};}
export function crewRequestMessage(data:{discordUserId:string;requestId:string;pilot:string;registration:string;role:string;origin:string;destination:string;departure:string}){
 return{flags:32768,allowed_mentions:{parse:[],users:[data.discordUserId]},components:[textDisplay(`<@${data.discordUserId}> has requested a leg for **${data.registration}**.`),v2Container([textDisplay(`**Pilot:** ${data.pilot}\n**Aircraft:** ${data.registration}\n**Role:** ${data.role}\n**Route:** ${data.origin} → ${data.destination}\n**Departure:** ${data.departure}`),separator(),{type:1,components:[actionButton("Approve",`crew:approve:${data.requestId}`,3),actionButton("Reject",`crew:reject:${data.requestId}`,4)]}])]};
}
export function autoCrewMessage(roleId:string,alertId:string,registration:string,details:string){
 return{flags:32768,allowed_mentions:{parse:[],roles:roleId?[roleId]:[]},components:[textDisplay(roleId?`<@&${roleId}>`:"**Auto-Crew**"),textDisplay(`**${registration}** is parked for more than 12 hours and is free for anyone to fly.`),v2Container([textDisplay(details),separator(),{type:1,components:[actionButton("Assign to Yourself",`auto:claim:${alertId}`,3)]}])]};
}
export function reviserMessage(roleId:string,alertId:string,registration:string,arrival:string,details:string){
 return{flags:32768,allowed_mentions:{parse:[],roles:roleId?[roleId]:[]},components:[textDisplay(roleId?`<@&${roleId}>`:"**Waitlist**"),textDisplay(`**${registration}** is stopped for landing at **${arrival}** for more than 18 hours. Anyone may claim a seat to finish the flight.`),v2Container([textDisplay(details),separator(),{type:1,components:[actionButton("Claim Captain Seat",`reviser:captain:${alertId}`,1),actionButton("Claim First Officer Seat",`reviser:first_officer:${alertId}`,1)]}])]};
}
export function notifierMessage(previous:string,registration:string,airport:string,origin:string,destination:string,discordUserId:string){
 return{content:`**${previous}** has landed **${registration}** at **${airport}**. You're on the next leg (${origin} → ${destination}), <@${discordUserId}>`,allowed_mentions:{parse:[],users:[discordUserId]}};
}
