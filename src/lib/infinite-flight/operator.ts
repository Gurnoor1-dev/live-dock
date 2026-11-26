import "server-only";
import { desc,eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { adminOperatorCredentials } from "@/lib/db/schema";
import { ifFetch,ORGANIZATION_ID } from "@/lib/infinite-flight/server";
import { getIFIdentityFromToken,type IFSession } from "@/lib/infinite-flight/session";
import { openSecret,sealSecret } from "@/lib/security/secret-box";
const AUTH_TOKEN_URL="https://api.infiniteflight.com/auth/v2/connect/token";
type TokenPayload={access_token?:string;refresh_token?:string;expires_in?:number};
async function refreshStoredSession(ifcUserId:string,session:IFSession):Promise<IFSession|null>{
 if(!session.refreshToken)return null;
 const clientId=process.env.IF_OAUTH_CLIENT_ID,clientSecret=process.env.IF_OAUTH_CLIENT_SECRET;
 if(!clientId||!clientSecret)return null;
 const body=new URLSearchParams({grant_type:"refresh_token",client_id:clientId,client_secret:clientSecret,refresh_token:session.refreshToken});
 const response=await fetch(AUTH_TOKEN_URL,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body,cache:"no-store",signal:AbortSignal.timeout(15000)});
 const payload=await response.json().catch(()=>({})) as TokenPayload;
 if(!response.ok||!payload.access_token)return null;
 const identity=getIFIdentityFromToken(payload.access_token,clientId);
 const next:IFSession={accessToken:payload.access_token,refreshToken:payload.refresh_token||session.refreshToken,expiresAt:Date.now()+Math.max(60,Number(payload.expires_in||1800))*1000,identity};
 await getDb().update(adminOperatorCredentials).set({encryptedSession:sealSecret(JSON.stringify(next)),updatedAt:new Date()}).where(eq(adminOperatorCredentials.ifcUserId,ifcUserId));
 return next;
}
export async function getScheduleWriterSession(pilotSession:IFSession):Promise<IFSession|null>{
 try{
  const org=await ifFetch<{role:number}>("/live/organizations/"+ORGANIZATION_ID,pilotSession);
  if(org.role===1||org.role===2)return pilotSession;
 }catch{}
 const [row]=await getDb().select().from(adminOperatorCredentials).orderBy(desc(adminOperatorCredentials.updatedAt)).limit(1);
 if(!row)return null;
 try{
  let session=JSON.parse(openSecret(row.encryptedSession)) as IFSession;
  if(!session.accessToken||typeof session.expiresAt!=="number")return null;
  if(session.expiresAt<Date.now()+60000){const refreshed=await refreshStoredSession(row.ifcUserId,session);if(!refreshed)return null;session=refreshed;}
  const org=await ifFetch<{role:number}>("/live/organizations/"+ORGANIZATION_ID,session);
  return org.role===1||org.role===2?session:null;
 }catch{return null;}
}