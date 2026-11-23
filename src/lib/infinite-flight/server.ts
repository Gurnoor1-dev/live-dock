import "server-only";
import { getIFSession,type IFSession } from "@/lib/infinite-flight/session";
export const ORGANIZATION_ID="d50dcc80-8dac-4608-970c-61d6a4739488";
type Discovery={userinfo_endpoint:string};
type Identity={id:string;username:string|null;displayName:string|null};
let discovery:Discovery|null=null;
const rateLimits=new Map<string,{isPro:boolean;remaining:number}>();
export function getIFRateLimit(session:IFSession){return rateLimits.get(session.accessToken)||{isPro:false,remaining:4};}
async function getDiscovery(){if(discovery)return discovery;const response=await fetch("https://auth.infiniteflight.com/.well-known/openid-configuration",{cache:"force-cache"});if(!response.ok)throw new Error("Infinite Flight OpenID discovery is unavailable.");const value=await response.json() as Discovery;if(!value.userinfo_endpoint)throw new Error("Infinite Flight did not publish a user-info endpoint.");discovery=value;return value;}
export async function getIFIdentity(session:IFSession):Promise<Identity>{
 const config=await getDiscovery();const response=await fetch(config.userinfo_endpoint,{headers:{Authorization:"Bearer "+session.accessToken},cache:"no-store"});if(!response.ok)throw new Error("Infinite Flight could not verify the signed-in account.");const value=await response.json() as {sub?:string;preferred_username?:string;nickname?:string;name?:string};
 if(!value.sub||!/^[0-9a-f-]{36}$/i.test(value.sub))throw new Error("Infinite Flight returned an invalid account identifier.");
 return{id:value.sub,username:value.preferred_username||value.nickname||null,displayName:value.name||null};
}
export async function requireIFSession(){const session=await getIFSession();if(!session)throw Object.assign(new Error("Sign in with Infinite Flight to continue."),{status:401});return{session,identity:await getIFIdentity(session)};}
export async function ifFetch<T=unknown>(path:string,session:IFSession,init:RequestInit={}):Promise<T>{
 const response=await fetch("https://api.infiniteflight.com/public/v3"+path,{...init,headers:{Authorization:"Bearer "+session.accessToken,...(init.body?{"Content-Type":"application/json"}:{}),...(init.headers||{})},cache:"no-store"});
 const remainingHeader=response.headers.get("x-rate-limit-remaining");const remaining=remainingHeader===null?4:Number(remainingHeader);rateLimits.set(session.accessToken,{isPro:(response.headers.get("x-user-pro")||"").toLowerCase()==="true",remaining:Number.isFinite(remaining)?remaining:5});
 const payload=await response.json().catch(()=>({})) as {errorCode?:number;message?:string;result?:T};
 if(!response.ok||typeof payload.errorCode==="number"&&payload.errorCode!==0)throw Object.assign(new Error(payload.message||"Infinite Flight API request failed ("+response.status+")."),{status:response.status});
 return payload.result as T;
}
export async function requireOrganizationAdmin(session:IFSession){const org=await ifFetch<{role:number}>(`/live/organizations/${ORGANIZATION_ID}`,session);if(org.role!==1&&org.role!==2)throw Object.assign(new Error("Organisation administrator access is required."),{status:403});return org;}
